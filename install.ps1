#Requires -Version 5.1
<#
ABW Arcade - Installation und Update unter Windows (als Dienst).

Gestartet wird ueber install.cmd im selben Ordner:

    install.cmd                      installieren bzw. aktualisieren
    install.cmd -Port 8080           anderer Port (Standard 5000; ein Update
                                     behaelt sonst den bisherigen)
    install.cmd -Threads 16          mehr gleichzeitige Anfragen (Standard 8)
    install.cmd -Python "C:\Program Files\Python312\python.exe"
    install.cmd -WinSWExe D:\WinSW.NET461.exe     ohne Download (offline)
    install.cmd -AllowPublic         Firewall auch fuer "Oeffentliche" Netzwerke
    install.cmd -Uninstall           Dienst entfernen, Daten behalten
    install.cmd -Uninstall -RemoveData   alles entfernen
    install.cmd -NonInteractive      keine Rueckfragen, kein Warten am Ende

Ergebnis: der Windows-Dienst "ABW Arcade" (abw-arcade). Er wird von WinSW
gestartet und laeuft unter dem virtuellen Konto NT SERVICE\abw-arcade, das
den Programmordner nur lesen und nur data\ und logs\ beschreiben darf.

    C:\ProgramData\ABW-Arcade\         Programm, .venv, arcade.conf
    C:\ProgramData\ABW-Arcade\data\    arcade.db, secret_key
    C:\ProgramData\ABW-Arcade\logs\    Logs des Dienstes
    C:\ProgramData\ABW-Arcade\service\ abw-arcade.exe (WinSW) und .xml

Dieses Skript muss mit Windows PowerShell 5.1 laufen und enthaelt nur
ASCII: Ohne BOM liest PowerShell 5.1 Skripte in der ANSI-Codepage, Umlaute
waeren dann Zeichensalat. Deshalb auch: kein ??, kein &&, Join-Path nur mit
zwei Argumenten, und immer sc.exe statt sc (sc ist in PowerShell
Set-Content).
#>
[CmdletBinding()]
param(
    [int]$Port = 0,
    [int]$Threads = 0,
    [string]$Python = '',
    [string]$WinSWExe = '',
    [switch]$NonInteractive,
    [switch]$Uninstall,
    [switch]$RemoveData,
    [switch]$AllowPublic
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$ServiceName = 'abw-arcade'
$ServiceDisplayName = 'ABW Arcade'
$VirtualAccount = 'NT SERVICE\abw-arcade'
$LocalServiceAccount = 'NT AUTHORITY\LocalService'
$FirewallRuleName = 'ABW-Arcade-HTTP'
$Root = Join-Path $env:ProgramData 'ABW-Arcade'
$Src = $PSScriptRoot
$DefaultPort = 5000
$DefaultThreads = 8
# WinSW 2.12.0, Variante fuer .NET Framework 4.6.1 (in Windows 10/11 enthalten).
$WinSWUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe'
$WinSWSha256 = 'B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F'

# ---------------------------------------------------------------------------
# Ausgabe und Hilfsfunktionen
# ---------------------------------------------------------------------------
function Write-Step([string]$Text) { Write-Host ">> $Text" }
function Write-Note([string]$Text) { Write-Host "!! $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { throw $Text }

function Exit-Script([int]$Code) {
    if (-not $NonInteractive) {
        Write-Host ''
        [void](Read-Host 'Zum Schliessen Enter druecken')
    }
    exit $Code
}

# Native Programme aufrufen. Windows PowerShell 5.1 macht aus jeder Zeile,
# die ein Programm nach stderr schreibt, einen Fehler - mit
# ErrorActionPreference=Stop bricht dann schon eine pip-Warnung alles ab.
# Deshalb hier kurz auf Continue, und entscheidend ist der Exit-Code.
function Invoke-Captured([string]$Exe, [string[]]$ArgList) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = @(& $Exe @ArgList 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
    } catch {
        $out = @($_.Exception.Message)
        $code = 1
    } finally {
        $ErrorActionPreference = $old
    }
    return [pscustomobject]@{ Code = $code; Output = $out }
}

function Invoke-Shown([string]$Exe, [string[]]$ArgList) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @ArgList 2>&1 | ForEach-Object { Write-Host "     $_" }
        $code = $LASTEXITCODE
    } catch {
        Write-Host "     $($_.Exception.Message)"
        $code = 1
    } finally {
        $ErrorActionPreference = $old
    }
    return $code
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ForwardArguments {
    $list = New-Object System.Collections.Generic.List[string]
    if ($Port -gt 0) { $list.Add('-Port'); $list.Add([string]$Port) }
    if ($Threads -gt 0) { $list.Add('-Threads'); $list.Add([string]$Threads) }
    if ($Python) { $list.Add('-Python'); $list.Add(('"{0}"' -f $Python)) }
    if ($WinSWExe) { $list.Add('-WinSWExe'); $list.Add(('"{0}"' -f $WinSWExe)) }
    if ($Uninstall) { $list.Add('-Uninstall') }
    if ($RemoveData) { $list.Add('-RemoveData') }
    if ($AllowPublic) { $list.Add('-AllowPublic') }
    return $list.ToArray()
}

# ---------------------------------------------------------------------------
# Python finden (nur systemweit installierte; der Dienst muss es lesen koennen)
# ---------------------------------------------------------------------------
function Get-PythonInfo([string]$Exe) {
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe -PathType Leaf)) { return $null }
    $code = "import sys,struct;print(sys.version_info[0],sys.version_info[1],sys.version_info[2],struct.calcsize('P')*8)"
    $r = Invoke-Captured $Exe @('-c', $code)
    if ($r.Code -ne 0 -or $r.Output.Count -eq 0) { return $null }
    $parts = @(([string]$r.Output[-1]).Trim() -split '\s+')
    if ($parts.Count -lt 4) { return $null }
    return [pscustomobject]@{
        Path = $Exe; Major = [int]$parts[0]; Minor = [int]$parts[1]
        Micro = [int]$parts[2]; Bits = [int]$parts[3]
    }
}

# Gibt den Grund zurueck, warum dieses Python nicht taugt, sonst $null.
function Get-PythonProblem($Info) {
    if (-not $Info) { return 'laesst sich nicht starten' }
    $path = [string]$Info.Path
    if ($path -like '*\WindowsApps\*') {
        return 'ist das Python aus dem Microsoft Store; das kann ein Dienst nicht benutzen'
    }
    $userDirs = @((Join-Path $env:SystemDrive 'Users'))
    if ($env:USERPROFILE) { $userDirs += (Split-Path -Parent $env:USERPROFILE) }
    foreach ($dir in $userDirs) {
        if ($path -like ('{0}\*' -f [Management.Automation.WildcardPattern]::Escape($dir))) {
            return 'ist nur fuer einen Benutzer installiert (liegt unter Users); der Dienst darf dort nicht lesen'
        }
    }
    if ($Info.Major -lt 3 -or ($Info.Major -eq 3 -and $Info.Minor -lt 10)) {
        return ('ist Python {0}.{1}; gebraucht wird 3.10 oder neuer' -f $Info.Major, $Info.Minor)
    }
    if ((Invoke-Captured $path @('-c', 'import venv,ensurepip')).Code -ne 0) {
        return 'hat kein venv-Modul'
    }
    return $null
}

function Find-RegisteredPython {
    $found = @()
    foreach ($base in @('HKLM:\SOFTWARE\Python\PythonCore', 'HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore')) {
        if (-not (Test-Path -Path $base)) { continue }
        foreach ($key in @(Get-ChildItem -Path $base -ErrorAction SilentlyContinue)) {
            $installKey = Join-Path $key.PSPath 'InstallPath'
            if (-not (Test-Path -Path $installKey)) { continue }
            $props = Get-ItemProperty -Path $installKey -ErrorAction SilentlyContinue
            if (-not $props) { continue }
            $exe = $null
            if ($props.PSObject.Properties['ExecutablePath']) { $exe = [string]$props.ExecutablePath }
            if (-not $exe -and $props.PSObject.Properties['(default)']) {
                $exe = Join-Path ([string]$props.'(default)') 'python.exe'
            }
            if (-not $exe) { continue }
            $info = Get-PythonInfo $exe
            if ($info -and -not (Get-PythonProblem $info)) { $found += $info }
        }
    }
    if ($found.Count -eq 0) { return $null }
    # 64 Bit zuerst, dann die hoechste Version
    return $found | Sort-Object -Property @{ Expression = 'Bits'; Descending = $true },
        @{ Expression = 'Major'; Descending = $true },
        @{ Expression = 'Minor'; Descending = $true },
        @{ Expression = 'Micro'; Descending = $true } | Select-Object -First 1
}

function Show-PythonHelp {
    Write-Host ''
    Write-Host 'Kein passendes Python gefunden. Gebraucht wird Python 3.10 oder neuer,'
    Write-Host 'installiert fuer alle Benutzer:'
    Write-Host ''
    Write-Host '  1. https://www.python.org/downloads/windows/ oeffnen und bei einer'
    Write-Host '     aktuellen Version den "Windows installer (64-bit)" laden.'
    Write-Host '  2. Im Installer "Customize installation" waehlen und auf der zweiten'
    Write-Host '     Seite "Install Python for all users" ankreuzen.'
    Write-Host '  3. install.cmd erneut starten.'
    Write-Host ''
    Write-Host 'Oder in einer Eingabeaufforderung als Administrator:'
    Write-Host '     winget install --id Python.Python.3.12 -e --scope machine'
    Write-Host ''
    Write-Host 'Ein vorhandenes Python laesst sich auch direkt angeben:'
    Write-Host '     install.cmd -Python "C:\Program Files\Python312\python.exe"'
    Write-Host ''
    Write-Host 'Nicht geeignet sind das Python aus dem Microsoft Store und Installationen'
    Write-Host '"nur fuer mich": Der Dienst laeuft unter einem eigenen Konto und darf dort'
    Write-Host 'nicht lesen.'
}

function Resolve-BasePython {
    if ($Python) {
        $info = Get-PythonInfo $Python
        $problem = Get-PythonProblem $info
        if ($problem) { Fail ('{0} {1}.' -f $Python, $problem) }
        return $info.Path
    }
    $best = Find-RegisteredPython
    if ($best) { return $best.Path }

    $winget = Get-Command -Name 'winget.exe' -ErrorAction SilentlyContinue
    if ($winget -and -not $NonInteractive) {
        Write-Host ''
        $answer = Read-Host 'Kein passendes Python gefunden. Python 3.12 jetzt fuer alle Benutzer installieren (winget)? [J/n]'
        if (-not $answer -or $answer -match '^(j|ja|y|yes)$') {
            $code = Invoke-Shown 'winget.exe' @('install', '--id', 'Python.Python.3.12', '-e', '--scope', 'machine',
                '--silent', '--accept-package-agreements', '--accept-source-agreements')
            if ($code -ne 0) { Write-Note ('winget meldet Exit-Code {0}.' -f $code) }
            $best = Find-RegisteredPython
            if ($best) { return $best.Path }
        }
    }
    Show-PythonHelp
    Fail 'Kein passendes Python gefunden (Anleitung siehe oben).'
}

# ---------------------------------------------------------------------------
# arcade.conf
# ---------------------------------------------------------------------------
function Read-Conf([string]$Path) {
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $values }
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $text = $line.Trim()
        if (-not $text -or $text.StartsWith('#')) { continue }
        $i = $text.IndexOf('=')
        if ($i -lt 1) { continue }
        $key = $text.Substring(0, $i).Trim().ToUpperInvariant()
        $value = $text.Substring($i + 1).Trim()
        if ($value.Length -ge 2 -and ($value[0] -eq '"' -or $value[0] -eq "'") -and $value[-1] -eq $value[0]) {
            $value = $value.Substring(1, $value.Length - 2).Trim()
        }
        if ($value) { $values[$key] = $value } else { [void]$values.Remove($key) }
    }
    return $values
}

function Get-ConfTemplate {
    return @(
        '# ABW Arcade - Einstellungen',
        '#',
        '# Der Dienst liest diese Datei bei jedem Start. Nach einer Aenderung in',
        '# einer PowerShell als Administrator:  Restart-Service abw-arcade',
        '# Einen anderen Port besser mit "install.cmd -Port 8080" setzen: Das passt',
        '# auch die Firewall-Freigabe an.',
        '#',
        '#   PORT      TCP-Port der Seite',
        '#   THREADS   gleichzeitig bearbeitete Anfragen',
        '#   HOST      Adresse, an die gebunden wird (Standard 0.0.0.0 = alle)',
        '#   DATA_DIR  Ordner fuer arcade.db und secret_key'
    )
}

# Werte setzen oder anhaengen, alles andere unveraendert lassen. Ohne BOM:
# run.py kaeme zwar mit BOM zurecht, andere Werkzeuge nicht unbedingt.
function Set-ConfValues([string]$Path, $Values) {
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $Path) {
        foreach ($l in [IO.File]::ReadAllLines($Path)) { $lines.Add($l) }
    } else {
        foreach ($l in (Get-ConfTemplate)) { $lines.Add($l) }
    }
    foreach ($key in $Values.Keys) {
        $done = $false
        for ($n = 0; $n -lt $lines.Count; $n++) {
            $text = $lines[$n].Trim()
            if ($text.StartsWith('#')) { continue }
            $i = $text.IndexOf('=')
            if ($i -lt 1) { continue }
            if ($text.Substring(0, $i).Trim().ToUpperInvariant() -ne $key) { continue }
            if ($done) {
                $lines.RemoveAt($n)
                $n--
            } else {
                $lines[$n] = ('{0}={1}' -f $key, $Values[$key])
                $done = $true
            }
        }
        if (-not $done) { $lines.Add(('{0}={1}' -f $key, $Values[$key])) }
    }
    $text = ($lines.ToArray() -join "`r`n") + "`r`n"
    [IO.File]::WriteAllText($Path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-Setting([string]$Name, [int]$Given, $Conf, [string]$Key, [int]$Default, [int]$Max) {
    if ($Given -gt 0) {
        if ($Given -gt $Max) { Fail ('{0} {1} ist zu gross (hoechstens {2}).' -f $Name, $Given, $Max) }
        return [pscustomobject]@{ Value = $Given; Source = 'angegeben' }
    }
    if ($Conf.ContainsKey($Key)) {
        $raw = [string]$Conf[$Key]
        $parsed = 0
        if (-not ($raw -match '^[0-9]+$') -or -not [int]::TryParse($raw, [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt $Max) {
            Fail ('{0}={1} in arcade.conf ist ungueltig. Bitte dort korrigieren oder -{2} angeben.' -f $Key, $raw, $Name)
        }
        return [pscustomobject]@{ Value = $parsed; Source = 'aus arcade.conf' }
    }
    return [pscustomobject]@{ Value = $Default; Source = 'Standard' }
}

# ---------------------------------------------------------------------------
# Dienst, Port, Firewall
# ---------------------------------------------------------------------------
function Get-ArcadeService { return Get-Service -Name $ServiceName -ErrorAction SilentlyContinue }

function Get-ArcadeServiceInfo {
    return Get-CimInstance -ClassName Win32_Service -Filter ("Name='{0}'" -f $ServiceName) -ErrorAction SilentlyContinue
}

# Gehoert der Prozess zum laufenden Dienst? WinSW startet das python.exe des
# venv, und das startet das eigentliche Python als Kindprozess.
function Test-OwnProcess([int]$ProcessId) {
    $svc = Get-ArcadeServiceInfo
    if (-not $svc -or -not $svc.ProcessId) { return $false }
    $current = $ProcessId
    for ($depth = 0; $depth -lt 6 -and $current; $depth++) {
        if ($current -eq $svc.ProcessId) { return $true }
        $proc = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId={0}" -f $current) -ErrorAction SilentlyContinue
        if (-not $proc) { return $false }
        $current = [int]$proc.ParentProcessId
    }
    return $false
}

function Stop-LeftoverProcesses {
    $pattern = '{0}\*' -f [Management.Automation.WildcardPattern]::Escape($Root)
    $runPy = '*{0}*' -f [Management.Automation.WildcardPattern]::Escape((Join-Path $Root 'run.py'))
    $procs = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath -like $pattern) -or
        ($_.CommandLine -and $_.CommandLine -like $runPy)
    })
    foreach ($p in $procs) {
        if ($p.ProcessId -eq $PID) { continue }
        Write-Note ('Beende uebrig gebliebenen Prozess {0} ({1}).' -f $p.ProcessId, $p.Name)
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-ArcadeService {
    $svc = Get-ArcadeService
    if ($svc -and $svc.Status -ne 'Stopped') {
        Write-Step 'Dienst anhalten ...'
        [void](Invoke-Captured 'sc.exe' @('stop', $ServiceName))
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline) {
            $svc.Refresh()
            if ($svc.Status -eq 'Stopped') { break }
            Start-Sleep -Milliseconds 500
        }
        $svc.Refresh()
        if ($svc.Status -ne 'Stopped') {
            $info = Get-ArcadeServiceInfo
            if ($info -and $info.ProcessId) {
                Write-Note ('Der Dienst haelt nicht an - Prozess {0} samt Kindprozessen wird beendet.' -f $info.ProcessId)
                [void](Invoke-Captured 'taskkill.exe' @('/PID', [string]$info.ProcessId, '/T', '/F'))
                Start-Sleep -Seconds 2
            }
        }
    }
    Stop-LeftoverProcesses
}

# Bereiche, die Windows fuer sich reserviert (Hyper-V, WSL, Docker). Ein Port
# darin laesst sich nicht binden, obwohl ihn kein Programm benutzt.
function Get-ExcludedRange([int]$P) {
    $r = Invoke-Captured 'netsh.exe' @('interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp')
    foreach ($line in $r.Output) {
        if ($line -match '^\s*(\d+)\s+(\d+)') {
            if ($P -ge [int]$Matches[1] -and $P -le [int]$Matches[2]) {
                return ('{0}-{1}' -f $Matches[1], $Matches[2])
            }
        }
    }
    return $null
}

function Assert-PortUsable([int]$P, [bool]$AllowOwnService) {
    $range = Get-ExcludedRange $P
    if ($range) {
        Fail ('Port {0} liegt in einem von Windows reservierten Bereich ({1}). Bitte einen anderen waehlen, z. B.: install.cmd -Port 8080' -f $P, $range)
    }
    foreach ($conn in @(Get-NetTCPConnection -State Listen -LocalPort $P -ErrorAction SilentlyContinue)) {
        $owner = [int]$conn.OwningProcess
        if ($AllowOwnService -and (Test-OwnProcess $owner)) { continue }
        $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
        $name = '?'
        if ($proc) { $name = $proc.ProcessName }
        Fail ('Port {0} ist belegt von {1} (PID {2}). Anderen Port waehlen, z. B.: install.cmd -Port 8080' -f $P, $name, $owner)
    }
}

function Set-FirewallRule([int]$P) {
    $profiles = 'Domain,Private'
    if ($AllowPublic) { $profiles = 'Domain,Private,Public' }
    try {
        Get-NetFirewallRule -Name $FirewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        [void](New-NetFirewallRule -Name $FirewallRuleName -DisplayName 'ABW Arcade (HTTP)' `
            -Description 'ABW Arcade, eingerichtet von install.ps1' -Direction Inbound -Protocol TCP `
            -LocalPort $P -Action Allow -Profile $profiles)
        Write-Step ('Firewall: Port {0} freigegeben ({1}).' -f $P, $profiles)
    } catch {
        Write-Note ('Die Firewall-Regel liess sich nicht anlegen: {0}' -f $_.Exception.Message)
        return
    }
    if (-not $AllowPublic) {
        foreach ($net in @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)) {
            if ([string]$net.NetworkCategory -eq 'Public') {
                Write-Note ('Das Netzwerk "{0}" ist als Oeffentlich eingestuft; dort bleibt die Seite gesperrt.' -f $net.Name)
                Write-Note 'Netzwerk auf Privat stellen (Einstellungen > Netzwerk) oder install.cmd -AllowPublic.'
            }
        }
    }
}

function Install-WinSW([string]$Target) {
    if ((Test-Path -LiteralPath $Target) -and (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash -eq $WinSWSha256) {
        return
    }
    $tmp = Join-Path $env:TEMP ('abw-arcade-winsw-{0}.exe' -f [guid]::NewGuid().ToString('N'))
    try {
        if ($WinSWExe) {
            Write-Step ('WinSW aus {0} uebernehmen ...' -f $WinSWExe)
            Copy-Item -LiteralPath $WinSWExe -Destination $tmp
        } else {
            Write-Step 'WinSW 2.12.0 herunterladen ...'
            Invoke-WebRequest -UseBasicParsing -Uri $WinSWUrl -OutFile $tmp
        }
        $hash = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash
        if ($hash -ne $WinSWSha256) {
            Fail ('WinSW hat die falsche Pruefsumme ({0} statt {1}). Abbruch.' -f $hash, $WinSWSha256)
        }
        Move-Item -LiteralPath $tmp -Destination $Target -Force
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}

function Write-WinSWConfig([string]$Path, [string]$VenvPython) {
    $x = { param([string]$s) [Security.SecurityElement]::Escape($s) }
    $lines = @(
        '<service>',
        ('  <id>{0}</id>' -f $ServiceName),
        ('  <name>{0}</name>' -f $ServiceDisplayName),
        '  <description>ABW Arcade Spiele-Server (Flask + waitress). Einstellungen in arcade.conf.</description>',
        ('  <executable>{0}</executable>' -f (& $x $VenvPython)),
        ('  <arguments>"{0}"</arguments>' -f (& $x (Join-Path $Root 'run.py'))),
        ('  <workingdirectory>{0}</workingdirectory>' -f (& $x $Root)),
        '  <env name="PYTHONUNBUFFERED" value="1"/>',
        '  <env name="PYTHONUTF8" value="1"/>',
        '  <startmode>Automatic</startmode>',
        '  <onfailure action="restart" delay="5 sec"/>',
        '  <resetfailure>1 hour</resetfailure>',
        '  <stoptimeout>15 sec</stoptimeout>',
        ('  <logpath>{0}</logpath>' -f (& $x (Join-Path $Root 'logs'))),
        '  <log mode="roll-by-size">',
        '    <sizeThreshold>10240</sizeThreshold>',
        '    <keepFiles>8</keepFiles>',
        '  </log>',
        '</service>'
    )
    [IO.File]::WriteAllText($Path, (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
}

# Das virtuelle Konto NT SERVICE\abw-arcade gibt es nur fuer diesen Dienst;
# es braucht kein Passwort und hat keine Rechte, die ihm nicht ausdruecklich
# gegeben werden. Klappt das nicht, bleibt LocalService.
function Set-ServiceAccount {
    $info = Get-ArcadeServiceInfo
    if ($info -and $info.StartName -eq $VirtualAccount) { return $VirtualAccount }
    [void](Invoke-Captured 'sc.exe' @('sidtype', $ServiceName, 'unrestricted'))
    $r = Invoke-Captured 'sc.exe' @('config', $ServiceName, 'obj=', $VirtualAccount)
    if ($r.Code -eq 0) {
        Write-Step ('Dienstkonto: {0}' -f $VirtualAccount)
        return $VirtualAccount
    }
    Write-Note ('Das Konto {0} liess sich nicht setzen: {1}' -f $VirtualAccount, (($r.Output -join ' ').Trim()))
    # '""' kommt bei sc.exe als leeres Passwort an (PowerShell 5.1 verschluckt '').
    $r = Invoke-Captured 'sc.exe' @('config', $ServiceName, 'obj=', $LocalServiceAccount, 'password=', '""')
    if ($r.Code -ne 0) { Fail ('Das Dienstkonto liess sich nicht setzen: {0}' -f ($r.Output -join ' ')) }
    Write-Note ('Der Dienst laeuft deshalb als {0}.' -f $LocalServiceAccount)
    return $LocalServiceAccount
}

# Rechte ueber SIDs, nicht ueber Namen: Ein deutsches Windows heisst die
# Gruppen "Administratoren" und "SYSTEM" anders als ein englisches.
#   S-1-5-18     SYSTEM               S-1-5-32-544  Administratoren
#   S-1-5-19     LocalService
function Set-Permissions([string]$Account) {
    $who = $Account
    if ($Account -eq $LocalServiceAccount) { $who = '*S-1-5-19' }
    Write-Step 'Zugriffsrechte setzen ...'
    $steps = @(
        # Besitzer: Administratoren (ProgramData erlaubt normalen Benutzern,
        # Ordner anzulegen - ein vorab angelegter Ordner gehoerte sonst ihnen).
        @($Root, '/setowner', '*S-1-5-32-544', '/T', '/C', '/Q'),
        # Alte, ausdrueckliche Rechte weg; alles erbt vom Programmordner.
        @($Root, '/reset', '/T', '/C', '/Q'),
        # Programmordner: nur SYSTEM und Administratoren schreiben, der Dienst liest.
        @($Root, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F',
            ('{0}:(OI)(CI)RX' -f $who), '/C', '/Q'),
        @((Join-Path $Root 'data'), '/grant:r', ('{0}:(OI)(CI)M' -f $who), '/C', '/Q'),
        @((Join-Path $Root 'logs'), '/grant:r', ('{0}:(OI)(CI)M' -f $who), '/C', '/Q')
    )
    foreach ($step in $steps) {
        $r = Invoke-Captured 'icacls.exe' $step
        if ($r.Code -ne 0) {
            Fail ('icacls {0} ist fehlgeschlagen: {1}' -f ($step -join ' '), ($r.Output -join ' '))
        }
    }
}

function Get-VenvHome([string]$Cfg) {
    if (-not (Test-Path -LiteralPath $Cfg)) { return $null }
    foreach ($line in [IO.File]::ReadAllLines($Cfg)) {
        if ($line -match '^\s*home\s*=\s*(.+?)\s*$') { return $Matches[1] }
    }
    return $null
}

function Initialize-Venv([string]$BasePython) {
    $venv = Join-Path $Root '.venv'
    $venvPython = Join-Path $venv 'Scripts\python.exe'
    $reason = $null
    if (-not (Test-Path -LiteralPath $venvPython)) {
        $reason = 'anlegen'
    } else {
        $venvHome = Get-VenvHome (Join-Path $venv 'pyvenv.cfg')
        if (-not $venvHome -or -not (Test-Path -LiteralPath (Join-Path $venvHome 'python.exe'))) {
            $reason = 'neu anlegen (das Python, mit dem es gebaut wurde, ist weg)'
        } elseif ($Python -and ((Split-Path -Parent $BasePython) -ne $venvHome)) {
            $reason = 'mit dem angegebenen Python neu anlegen'
        } elseif ((Invoke-Captured $venvPython @('-c', 'import sys')).Code -ne 0) {
            $reason = 'neu anlegen (startet nicht)'
        }
    }
    if ($reason) {
        Write-Step ('Virtualenv {0} ...' -f $reason)
        $code = Invoke-Shown $BasePython @('-m', 'venv', '--clear', $venv)
        if ($code -ne 0) { Fail 'Das Virtualenv liess sich nicht anlegen.' }
    } else {
        Write-Step 'Virtualenv vorhanden.'
    }
    Write-Step 'Abhaengigkeiten installieren ...'
    $code = Invoke-Shown $venvPython @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--upgrade', 'pip')
    if ($code -ne 0) { Write-Note 'pip liess sich nicht aktualisieren - es geht mit der vorhandenen Fassung weiter.' }
    $code = Invoke-Shown $venvPython @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', (Join-Path $Root 'requirements.txt'))
    if ($code -ne 0) { Fail 'Die Abhaengigkeiten liessen sich nicht installieren (Internet? Proxy?).' }
    return $venvPython
}

function Wait-Healthz([int]$P, [int]$Seconds) {
    $url = 'http://127.0.0.1:{0}/healthz' -f $P
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
            if ($r.StatusCode -eq 200) { return $true }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function Show-ServiceLogs {
    $logs = Join-Path $Root 'logs'
    foreach ($name in @('abw-arcade.err.log', 'abw-arcade.out.log', 'abw-arcade.wrapper.log')) {
        $file = Join-Path $logs $name
        if (Test-Path -LiteralPath $file) {
            Write-Host ('----- {0} (Ende) -----' -f $file)
            Get-Content -LiteralPath $file -Tail 40 | ForEach-Object { Write-Host "     $_" }
        }
    }
}

function Get-LanAddresses {
    return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
        $_.InterfaceAlias -notlike 'vEthernet*' -and $_.InterfaceAlias -notlike 'Loopback*'
    } | ForEach-Object { $_.IPAddress })
}

# ---------------------------------------------------------------------------
# Installieren / Aktualisieren
# ---------------------------------------------------------------------------
function Invoke-Install {
    $syncPy = Join-Path (Join-Path $Src 'installer') 'sync.py'
    if (-not (Test-Path -LiteralPath (Join-Path $Src 'app.py')) -or -not (Test-Path -LiteralPath $syncPy)) {
        Fail ('In {0} fehlen app.py oder installer\sync.py. Bitte das vollstaendige Paket entpacken.' -f $Src)
    }

    $basePython = Resolve-BasePython
    Write-Step ('Python: {0}' -f $basePython)

    $confPath = Join-Path $Root 'arcade.conf'
    $conf = Read-Conf $confPath
    $portSetting = Get-Setting 'Port' $Port $conf 'PORT' $DefaultPort 65535
    $threadSetting = Get-Setting 'Threads' $Threads $conf 'THREADS' $DefaultThreads 1000
    $effPort = [int]$portSetting.Value

    Write-Host ''
    Write-Step 'ABW Arcade installieren bzw. aktualisieren:'
    Write-Host ('     Ordner:   {0}' -f $Root)
    Write-Host ('     Port:     {0} ({1})' -f $effPort, $portSetting.Source)
    Write-Host ('     Threads:  {0} ({1})' -f $threadSetting.Value, $threadSetting.Source)
    Write-Host ('     Dienst:   {0} ({1})' -f $ServiceDisplayName, $ServiceName)
    Write-Host ''

    # Belegt ein FREMDES Programm den Port, abbrechen, bevor sich etwas aendert.
    Assert-PortUsable $effPort $true

    Stop-ArcadeService

    Write-Step 'Programmdateien abgleichen ...'
    [void](New-Item -ItemType Directory -Force -Path $Root)
    $code = Invoke-Shown $basePython @($syncPy, $Src, $Root)
    if ($code -ne 0) { Fail 'Der Abgleich der Programmdateien ist fehlgeschlagen (siehe oben).' }
    foreach ($dir in @('data', 'logs', 'service')) {
        [void](New-Item -ItemType Directory -Force -Path (Join-Path $Root $dir))
    }

    # arcade.conf: neu anlegen oder nur das Angegebene bzw. Fehlende eintragen.
    $isNew = -not (Test-Path -LiteralPath $confPath)
    $updates = [ordered]@{}
    if ($isNew -or $Port -gt 0 -or -not $conf.ContainsKey('PORT')) { $updates['PORT'] = $effPort }
    if ($isNew -or $Threads -gt 0) { $updates['THREADS'] = $threadSetting.Value }
    if (-not $conf.ContainsKey('DATA_DIR')) { $updates['DATA_DIR'] = (Join-Path $Root 'data') }
    if ($updates.Count -gt 0) { Set-ConfValues $confPath $updates }

    $venvPython = Initialize-Venv $basePython

    $serviceDir = Join-Path $Root 'service'
    $winsw = Join-Path $serviceDir 'abw-arcade.exe'
    Install-WinSW $winsw
    Write-WinSWConfig (Join-Path $serviceDir 'abw-arcade.xml') $venvPython
    if (-not (Get-ArcadeService)) {
        Write-Step 'Dienst einrichten ...'
        $code = Invoke-Shown $winsw @('install')
        if ($code -ne 0 -or -not (Get-ArcadeService)) { Fail 'WinSW konnte den Dienst nicht einrichten.' }
    }
    $account = Set-ServiceAccount
    Set-Permissions $account
    Set-FirewallRule $effPort

    Assert-PortUsable $effPort $false
    Write-Step 'Dienst starten ...'
    try {
        Start-Service -Name $ServiceName
    } catch {
        Show-ServiceLogs
        Fail ('Der Dienst startet nicht: {0}' -f $_.Exception.Message)
    }
    if (-not (Wait-Healthz $effPort 60)) {
        Show-ServiceLogs
        Fail ('Die Seite antwortet nach 60 Sekunden nicht auf Port {0} (Logs siehe oben, vollstaendig in {1}).' -f $effPort, (Join-Path $Root 'logs'))
    }
    $js = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:{0}/static/tetris.js' -f $effPort) -TimeoutSec 10
    $type = [string]$js.Headers['Content-Type']
    if (-not $type.StartsWith('text/javascript')) {
        Fail ('Die Seite liefert JavaScript als "{0}" statt text/javascript aus; Browser laden die Spiele dann nicht.' -f $type)
    }

    Write-Host ''
    $paketInfo = Join-Path $Root 'PAKET-INFO'
    if (Test-Path -LiteralPath $paketInfo) {
        Write-Step 'Installierter Stand:'
        Get-Content -LiteralPath $paketInfo | ForEach-Object { Write-Host "     $_" }
    } else {
        Write-Step 'Installierter Stand: ohne PAKET-INFO (Installation aus einem git-Klon?)'
    }
    Write-Host ''
    $addresses = @(Get-LanAddresses)
    if ($addresses.Count -eq 0) { $addresses = @('<dieser-rechner>') }
    foreach ($ip in $addresses) { Write-Step ('Fertig! ABW Arcade:  http://{0}:{1}' -f $ip, $effPort) }
    Write-Step 'Ersten Admin ernennen (nach der Registrierung im Browser), in einer PowerShell als Administrator:'
    Write-Host ('     & "{0}" "{1}" make-admin NUTZERNAME' -f $venvPython, (Join-Path $Root 'run.py'))
}

# ---------------------------------------------------------------------------
# Deinstallieren
# ---------------------------------------------------------------------------
function Invoke-Uninstall {
    Stop-ArcadeService
    if (Get-ArcadeService) {
        Write-Step 'Dienst entfernen ...'
        $winsw = Join-Path (Join-Path $Root 'service') 'abw-arcade.exe'
        if (Test-Path -LiteralPath $winsw) {
            $code = Invoke-Shown $winsw @('uninstall')
        } else {
            $code = Invoke-Shown 'sc.exe' @('delete', $ServiceName)
        }
        if ($code -ne 0) { Fail 'Der Dienst liess sich nicht entfernen.' }
    }
    Get-NetFirewallRule -Name $FirewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (-not (Test-Path -LiteralPath $Root)) {
        Write-Step 'Fertig. Es waren keine Dateien mehr vorhanden.'
        return
    }
    if ($RemoveData) {
        Remove-Item -LiteralPath $Root -Recurse -Force
        Write-Step ('Fertig. {0} ist samt Daten entfernt.' -f $Root)
        return
    }
    foreach ($item in @(Get-ChildItem -LiteralPath $Root -Force)) {
        if (@('data', 'arcade.conf') -contains $item.Name) { continue }
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
    }
    Write-Step ('Fertig. Dienst und Programm sind entfernt; Accounts und Einstellungen liegen weiter in {0} (data\, arcade.conf).' -f $Root)
    Write-Step 'Endgueltig loeschen:  install.cmd -Uninstall -RemoveData'
}

# ---------------------------------------------------------------------------
if (-not (Test-Admin)) {
    if ($NonInteractive) {
        Write-Host 'FEHLER: install.ps1 braucht Administratorrechte. Bitte in einer PowerShell bzw. Eingabeaufforderung "Als Administrator" starten.'
        exit 1
    }
    Write-Step 'Administratorrechte anfordern ...'
    $elevated = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath)) + @(Get-ForwardArguments)
    try {
        $proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $elevated -Wait -PassThru
    } catch {
        Write-Host ('FEHLER: Ohne Administratorrechte geht es nicht ({0}).' -f $_.Exception.Message)
        Exit-Script 1
    }
    exit $proc.ExitCode
}

try {
    if ($Uninstall) { Invoke-Uninstall } else { Invoke-Install }
} catch {
    Write-Host ''
    Write-Host ('FEHLER: {0}' -f $_.Exception.Message) -ForegroundColor Red
    Exit-Script 1
}
Exit-Script 0
