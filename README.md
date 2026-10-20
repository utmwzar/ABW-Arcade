# ABW Arcade

Selbstgehostete Spiele-Website für den Homelab-Container. Ein Account, sieben
Spiele, server-geprüfte Bestenlisten.

**Tetris · Snake · Breakout · 2048 · Geometry Dash · Schach · DOOM**

Flask + SQLite + waitress, als Systemdienst unter Linux, macOS oder Windows.
Keine Datenbank aufzusetzen, kein Reverse Proxy nötig, kein Docker, keine
externen Dienste.

---

## Installation

ABW Arcade läuft als Dienst, der beim Hochfahren von selbst startet und im
lokalen Netz erreichbar ist. Für jedes System gibt es ein Installations-
skript; es braucht Administratorrechte und Internet für die Python-Pakete.
Mehr nicht — alles Weitere richtet das Skript ein.

Die Download-Links zeigen immer auf das neueste Release; es ist keine
Versionsnummer nachzuschlagen. Das `.tar.gz` ist für Linux und macOS, das
`.zip` für Windows; der Inhalt ist derselbe.

### Linux (Debian, Ubuntu)

Vorausgesetzt wird Debian oder Ubuntu (LXC, VM, Container) mit Root-Zugang.

```bash
curl -fsSL -o abw-arcade.tar.gz \
  https://github.com/utmwzar/ABW-Arcade/releases/latest/download/abw-arcade.tar.gz
tar -xzf abw-arcade.tar.gz
cd abw-arcade
sudo ./install.sh
```

Wo `curl` fehlt, tut `wget -O abw-arcade.tar.gz <URL>` dasselbe.

Danach läuft die Seite auf Port **5000**. Ein anderer Port geht über
`sudo ./install.sh --port 8080`. Den Port als Schalter angeben, nicht als
Umgebungsvariable: `sudo` verwirft Umgebungsvariablen, ein vorangestelltes
`PORT=8080` käme im Skript gar nicht an. Nur in einer Root-Shell geht auch
`PORT=8080 ./install.sh`.

### macOS

Vorausgesetzt wird ein Administratorkonto und Python 3.10 oder neuer, für
alle Benutzer installiert. Am einfachsten ist der „macOS 64-bit universal2
installer“ von [python.org](https://www.python.org/downloads/macos/); ein
Python aus Homebrew geht ebenfalls. Das Python von macOS selbst
(`/usr/bin/python3`) taugt nicht, und eines in einem Benutzerordner auch
nicht: Der Dienst läuft unter einem eigenen Konto und darf dort nicht lesen.

```bash
curl -fsSL -o abw-arcade.tar.gz \
  https://github.com/utmwzar/ABW-Arcade/releases/latest/download/abw-arcade.tar.gz
tar -xzf abw-arcade.tar.gz
cd abw-arcade
sudo ./install.sh
```

Danach läuft die Seite auf Port **5050**. Port 5000 ist auf dem Mac ab
macOS 12 meist schon belegt — vom AirPlay-Empfänger. Ein anderer Port geht
wie unter Linux über `sudo ./install.sh --port 8080`. Findet das Skript
kein passendes Python, sagt es, was zu tun ist; ein bestimmtes lässt sich mit
`--python /pfad/zu/python3` vorgeben.

### Windows

Vorausgesetzt wird Windows 10 oder 11 mit Administratorrechten. Python 3.10
oder neuer muss „für alle Benutzer“ installiert sein; fehlt es, bietet das
Skript an, es über `winget` einzurichten. Wer es selbst installiert, wählt im
Installer von [python.org](https://www.python.org/downloads/windows/)
„Customize installation“ und kreuzt „Install Python for all users“ an. Das
Python aus dem Microsoft Store geht nicht.

1. [`abw-arcade.zip`](https://github.com/utmwzar/ABW-Arcade/releases/latest/download/abw-arcade.zip)
   herunterladen.
2. Rechtsklick auf die Datei → *Eigenschaften* → unten bei „Sicherheit“
   **Zulassen** ankreuzen. Sonst behandelt Windows jede Datei daraus als
   Download aus dem Internet und warnt bei jedem Skript.
3. Rechtsklick → *Alle extrahieren …*. Dabei entsteht ein Ordner
   `abw-arcade`, in dem noch einmal ein Ordner `abw-arcade` liegt —
   `install.cmd` steckt im inneren.
4. `install.cmd` doppelklicken und die Rückfrage nach Administratorrechten
   bestätigen. Meldet sich stattdessen „Der Computer wurde durch Windows
   geschützt“, über *Weitere Informationen* → *Trotzdem ausführen*.

Dasselbe in einer PowerShell:

```powershell
Invoke-WebRequest -OutFile abw-arcade.zip `
  -Uri https://github.com/utmwzar/ABW-Arcade/releases/latest/download/abw-arcade.zip
Unblock-File abw-arcade.zip
Expand-Archive abw-arcade.zip -DestinationPath .
.\abw-arcade\install.cmd
```

Danach läuft die Seite auf Port **5000**. Ein anderer Port geht über
`install.cmd -Port 8080`. Das Fenster bleibt am Ende offen, bis Enter
gedrückt wird; dort stehen die Adresse der Seite und der Befehl für den
ersten Admin.

### Alternative: direkt aus git

Die Skripte laufen in jedem Ordner, in dem das Projekt liegt — ein Archiv
ist nicht nötig:

```bash
git clone --depth 1 https://github.com/utmwzar/ABW-Arcade.git
cd ABW-Arcade
sudo ./install.sh            # Linux, macOS; unter Windows: install.cmd
```

Ein Release ist ein fester, getesteter Stand; der Klon ist der laufende
Entwicklungsstand. Für einen Server, der einfach laufen soll, ist das
Release die richtige Wahl.

### Was die Skripte tun

Alle drei kopieren die Anwendung in einen festen Ordner, bauen dort ein
Python-Virtualenv, schreiben den Port in `arcade.conf` und richten einen
Dienst ein, der unter einem eigenen Konto ohne Anmeldung läuft. Zum Schluss
prüfen sie, ob die Seite antwortet und JavaScript richtig ausliefert.

| | Linux | macOS | Windows |
|---|---|---|---|
| Programm | `/opt/arcade` | `/opt/arcade` | `C:\ProgramData\ABW-Arcade` |
| Accounts, Punktestände | `/opt/arcade` | `/opt/arcade/data` | `C:\ProgramData\ABW-Arcade\data` |
| Dienst | `arcade.service` (systemd) | LaunchDaemon `io.github.utmwzar.abw-arcade` | Windows-Dienst „ABW Arcade“ (`abw-arcade`, über [WinSW](https://github.com/winsw/winsw)) |
| Konto | `arcade` | `_arcade` (versteckt) | `NT SERVICE\abw-arcade` |
| Logs | `journalctl -u arcade` | `/opt/arcade/logs/arcade.log` | `C:\ProgramData\ABW-Arcade\logs` |

Unter Linux installiert `install.sh` dazu `python3`, `python3-venv` und
`python3-pip` per `apt`. Unter macOS und Windows darf das Dienstkonto den
Programmordner nur lesen; schreiben kann es nur in `data` und `logs`.

Die Datenbank `arcade.db` entsteht beim ersten Start leer. Es werden nie
Accounts oder Punktestände mitgeliefert.

Zum Schluss meldet das Skript, welcher Stand installiert wurde. Dieselbe
Angabe liegt danach in `PAKET-INFO` im Programmordner — damit lässt sich auf
einem laufenden Server jederzeit feststellen, welcher Commit dort tatsächlich
läuft.

### Ersten Admin ernennen

Zuerst im Browser registrieren, dann auf dem Server:

```bash
# Linux
cd /opt/arcade && sudo -u arcade .venv/bin/python run.py make-admin NUTZERNAME

# macOS
sudo -u _arcade /opt/arcade/.venv/bin/python /opt/arcade/run.py make-admin NUTZERNAME
```

```powershell
# Windows, in einer PowerShell als Administrator
& "C:\ProgramData\ABW-Arcade\.venv\Scripts\python.exe" "C:\ProgramData\ABW-Arcade\run.py" make-admin NUTZERNAME
```

Wichtig ist `run.py` und das jeweilige Konto: `run.py` liest `arcade.conf`
und trifft damit dieselbe Datenbank wie der Dienst. Unter Linux und macOS
gehörten neu angelegte Dateien sonst `root`, und der Dienst könnte sie nicht
mehr schreiben; `run.py` warnt in diesem Fall.

### Firewall

- **Linux:** Ist `ufw` aktiv, den Port freigeben: `sudo ufw allow 5000/tcp`.
- **macOS:** Ist die Firewall eingeschaltet, trägt `install.sh` Python als
  erlaubtes Programm ein. Steht sie auf „Alle eingehenden Verbindungen
  blockieren“, hilft das nicht.
- **Windows:** `install.cmd` legt die Regel `ABW-Arcade-HTTP` für den Port an,
  gültig in privaten und Domänen-Netzwerken. Ist das Netzwerk als
  *Öffentlich* eingestuft, bleibt die Seite von außen gesperrt — dann das
  Netzwerk in den Windows-Einstellungen auf *Privat* stellen oder
  `install.cmd -AllowPublic` verwenden.

---

## Update

Neues Paket holen, entpacken und das Skript erneut starten — derselbe Ablauf
wie bei der Installation. Die Skripte sind idempotent und lassen sich
beliebig oft ausführen.

**Port, Accounts und Bestenlisten bleiben erhalten.** Ohne `--port` bzw.
`-Port` gilt der Port aus `arcade.conf`. Bei Linux-Installationen von vor
`arcade.conf` übernimmt `install.sh` ihn aus der bisherigen Dienstdatei.

Unangetastet bleiben:

| | |
|---|---|
| `arcade.db` | Accounts, Punktestände, Elo, laufende Partien |
| `secret_key` | Sitzungsschlüssel; ohne ihn müssen sich alle neu anmelden |
| `arcade.conf` | Port, Threads, Datenordner |
| `static/doom/doom1.wad`, `doom2.wad` | selbst hinterlegte DOOM-Daten, in jeder Schreibweise (`DOOM1.WAD`) |
| `.venv/` | das Virtualenv |
| `data/`, `logs/`, `service/` | Daten, Logs und Dienstprogramm unter macOS und Windows |

Alles andere wird ersetzt, überzählige Dateien werden entfernt. Welche
Dateien genau geschützt sind, steht in `installer/sync.py`; alle drei Skripte
kopieren damit.

### Zurücksetzen

Sollen Accounts und Punktestände verschwinden, den Dienst anhalten, beide
Dateien löschen und den Dienst wieder starten. Beides entsteht beim nächsten
Start neu und leer.

```bash
# Linux
sudo systemctl stop arcade
sudo rm -f /opt/arcade/arcade.db /opt/arcade/secret_key
sudo systemctl start arcade

# macOS
sudo launchctl bootout system/io.github.utmwzar.abw-arcade
sudo rm -f /opt/arcade/data/arcade.db /opt/arcade/data/secret_key
sudo launchctl bootstrap system /Library/LaunchDaemons/io.github.utmwzar.abw-arcade.plist
```

```powershell
# Windows, PowerShell als Administrator
Stop-Service abw-arcade
Remove-Item C:\ProgramData\ABW-Arcade\data\arcade.db, C:\ProgramData\ABW-Arcade\data\secret_key
Start-Service abw-arcade
```

### Deinstallieren

Unter Windows erledigt das `install.cmd -Uninstall`: Dienst, Firewall-Regel
und Programm verschwinden, `data\` und `arcade.conf` bleiben für eine
spätere Neuinstallation liegen. `install.cmd -Uninstall -RemoveData` entfernt
alles.

Unter Linux und macOS geht es von Hand; dabei verschwinden auch alle
Accounts und Punktestände:

```bash
# Linux
sudo systemctl disable --now arcade
sudo rm -f /etc/systemd/system/arcade.service
sudo systemctl daemon-reload
sudo rm -rf /opt/arcade
sudo userdel arcade

# macOS
sudo launchctl bootout system/io.github.utmwzar.abw-arcade
sudo rm -f /Library/LaunchDaemons/io.github.utmwzar.abw-arcade.plist
sudo rm -rf /opt/arcade
sudo dscl . -delete /Users/_arcade
sudo dscl . -delete /Groups/_arcade
```

### Umstieg von einer älteren `tetris`-Installation

Ältere Stände liefen unter `/opt/tetris` mit dem Dienst `tetris.service`.
Accounts und Punktestände werden dabei **nicht** übernommen:

```bash
sudo systemctl disable --now tetris.service 2>/dev/null
sudo rm -rf /opt/tetris /etc/systemd/system/tetris.service
sudo userdel tetris 2>/dev/null
sudo ./install.sh
```

`install.sh` weist von selbst darauf hin, falls die alte Installation noch
liegt — sie belegt denselben Port.

---

## Betrieb

**Linux**

```bash
systemctl status arcade        # läuft es?
systemctl restart arcade       # neu starten
journalctl -u arcade -f        # Logs mitlesen
curl localhost:5000/healthz    # {"ok": true}
```

**macOS**

```bash
sudo launchctl print system/io.github.utmwzar.abw-arcade | grep state   # läuft es?
sudo launchctl kickstart -k system/io.github.utmwzar.abw-arcade         # neu starten
sudo tail -f /opt/arcade/logs/arcade.log                                # Logs mitlesen
curl localhost:5050/healthz                                             # {"ok": true}
```

**Windows** (PowerShell als Administrator)

```powershell
Get-Service abw-arcade                                    # läuft es?
Restart-Service abw-arcade                                # neu starten
Get-Content C:\ProgramData\ABW-Arcade\logs\abw-arcade.err.log -Tail 50 -Wait   # Logs mitlesen
curl.exe http://localhost:5000/healthz                    # {"ok": true}
```

In Windows PowerShell ist `curl` nur ein anderer Name für
`Invoke-WebRequest`; deshalb ausdrücklich `curl.exe`. Die Ausgaben der
Anwendung stehen in `abw-arcade.err.log`, die des Dienstprogramms in
`abw-arcade.wrapper.log`.

`/healthz` braucht keinen Login und prüft die Datenbank gleich mit — taugt
also unverändert als Ziel für Uptime Kuma oder einen anderen Monitor.

### Einstellungen

Port, Threads und Datenordner stehen in `arcade.conf` im Programmordner
(`PORT=…`, `THREADS=…`, `HOST=…`, `DATA_DIR=…`). Nach einer Änderung den
Dienst neu starten. Einen anderen Port setzt man am besten über das
Installationsskript (`--port` bzw. `-Port`); unter Windows passt das auch die
Firewall-Regel an.

Was tatsächlich gilt und ob der Port frei ist, zeigt `run.py check`, etwa
unter Linux mit `sudo -u arcade /opt/arcade/.venv/bin/python /opt/arcade/run.py check`.
Ist der Port belegt, startet der Dienst nicht und meldet im Log „Port … ist
belegt oder reserviert“; unter Linux versucht systemd es dann auch nicht
endlos weiter.

Wo kein systemd läuft (etwa in einem Docker-Container), schreibt
`install.sh` die Dienstdatei trotzdem und gibt den passenden manuellen
Startbefehl aus.

Ehrlicher Hinweis: Unter Linux läuft ABW Arcade seit dem ersten Release.
Die Installation unter macOS und Windows ist bisher nur auf den
Testmaschinen von GitHub (CI) geprüft, noch nicht auf echten Rechnern in der
Werkstatt.

---

## Die Spiele & wie sie funktionieren

### Bestenlisten ohne Vertrauen in den Browser

Bei **Tetris, Snake, Breakout, 2048 und Geometry Dash** schickt der Client
nie einen Punktestand. Stattdessen:

1. Der Server vergibt pro Partie einen Zufalls-Seed und eine einmalige
   `game_id`.
2. Der Browser spielt daraus eine vollständig deterministische Partie und
   zeichnet nur die Eingaben auf (`{tick, action}`).
3. Nach Spielende schickt er Seed, `game_id` und das Eingabeprotokoll.
4. Der Server **spielt die Partie mit derselben Engine nach** und rechnet den
   Punktestand selbst aus.

Einen Punktestand zu fälschen hieße damit, ein Eingabeprotokoll einzureichen,
das ihn tatsächlich erreicht — man müsste also wirklich so gut spielen oder
einen Bot schreiben, der es tut.

Damit das aufgeht, müssen die Engines paarweise exakt gleich rechnen:
`tetris_engine.py` gegen `static/tetris_engine.js` und so weiter. Breakout
und Geometry Dash benutzen deshalb reine Integer-Fixed-Point-Physik statt
Fließkomma, 2048 einen geseedeten Tile-Spawn. Bei Geometry Dash hängt das
Level allein am Seed; der Punktestand ist die erreichte Distanz.

Dass die Paare übereinstimmen, ist nicht bloß behauptet, sondern geprüft —
siehe [Gleichlauf der Engines](#gleichlauf-der-engines-prüfen).

### Schach

Spieler gegen Spieler über die Lobby unter `/games/chess`: Partie erstellen,
ein zweiter Account tritt bei. Hier wird nichts nachgespielt, sondern jeder
einzelne Zug direkt vom Server geprüft — `chess_engine.py` beherrscht die
vollen Regeln inklusive Rochade, en passant, Umwandlung, Matt, Patt,
50-Züge-Regel, Stellungswiederholung und totem Material, abgeglichen gegen
Perft-Referenzzahlen.

Dazu Elo-Wertung (K=32, Start 1000), Remisangebot und Aufgabe. Der
**Bot-Modus** (`chess_bot.py`, Negamax mit Alpha-Beta, drei Stärken) ist
bewusst unbewertet und auf drei gleichzeitige Partien begrenzt.

### DOOM

Chocolate Doom als WebAssembly, mit **FreeDoom Phase 1** als freien
Spieldaten. Läuft vollständig im Browser; der Server liefert nur die
statischen Dateien. Deshalb bewusst **ohne Bestenliste** — was im Browser
gerechnet wird, lässt sich nicht überprüfen.

Eigene `doom1.wad` oder `doom2.wad` nach `static/doom/` im Programmordner
legen (unter Linux und macOS `/opt/arcade/static/doom/`, unter Windows
`C:\ProgramData\ABW-Arcade\static\doom\`); sie erscheinen dann als
zusätzliche Startoption und überstehen Updates.

Steuerung: WASD und Maus (zum Aktivieren ins Bild klicken), Leertaste feuert,
E benutzt, Shift rennt. Spielstände leben nur im geöffneten Tab.

### Admin

Unter `/admin`, nur für Accounts mit Adminrecht: Dashboard mit Statistik je
Spiel, Spielerverwaltung (Adminrecht vergeben, Passwort zurücksetzen, Löschen
mit CASCADE), Verwaltung der Punktestände mit Filter je Spiel und Aufräumen
verwaister Replay-Sitzungen.

---

## Mitentwickeln

### Lokal starten, ohne zu installieren

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/flask --app app run --port 5000
```

Oder so, wie der Dienst startet (waitress, Einstellungen aus `arcade.conf`
oder `ARCADE_PORT` usw.): `.venv/bin/python run.py`.

### Tests

```bash
python -m unittest discover -s tests -t .
```

Prüft jede Seite, die Spiel-APIs, die Schachregeln (Perft), die
Content-Types der statischen Dateien und die Installer-Bausteine
(`installer/sync.py`, `run.py`). Die CI installiert das Paket außerdem
als echten Dienst unter Linux, macOS und Windows.

### Gleichlauf der Engines prüfen

```bash
node pruefe-engines.js            # alle Spiele
node pruefe-engines.js snake gd   # nur diese
```

Braucht `node` und `python3`. Läuft in unter einer Sekunde und endet mit
Exit-Code 1, sobald etwas abweicht — eignet sich also für einen
Pre-Commit-Hook oder CI.

Der Test erzeugt Eingabeprotokolle, schickt **jedes davon durch beide
Fassungen** einer Engine und vergleicht die Ergebnisse Feld für Feld. Damit
ist die Annahme abgesichert, auf der die Bestenlisten beruhen. Laufen die
Fassungen auseinander, meldet sich sonst nichts: Es würden nur stillschweigend
ehrliche Partien abgelehnt oder falsche Punktestände eingetragen.

**Nach jeder Änderung an einer Engine ausführen**, und zwar an beiden Seiten
des Paares.

Snake und Tetris bekommen dabei gesteuerte Partien statt Zufallseingaben.
Zufällig gespielt frisst die Schlange nie und Tetris räumt nie eine Reihe —
verglichen würden dann lauter Partien mit Punktestand 0, und ausgerechnet die
Punktetabellen blieben ungeprüft. Die Begründung steht ausführlich im Skript.

Deshalb zeigt die Ausgabe je Spiel mit an, wie viele Fälle überhaupt Punkte
erreicht haben und wie lang die längste Partie war. Stehen dort Nullen, prüft
der Test nichts mehr — unabhängig davon, ob er grün meldet.

Ob er noch Zähne hat, lässt sich jederzeit nachstellen: eine Konstante in
einer der `*_engine.py` verbiegen (etwa `LINE_SCORES` oder `START_LIVES`),
laufen lassen, Abweichung erwarten, Änderung zurücknehmen.

### Ein neues Spiel ergänzen

1. Eintrag in der `GAMES`-Registry in `app.py` (slug, title, endpoint,
   status `"live"`)
2. Route und Template anlegen
3. Falls es eine Bestenliste geben soll: Punktestände mit demselben `slug` in
   die Tabelle `scores` schreiben

Hub, Leaderboard-API und Admin greifen den Eintrag von selbst auf. Auch die
Installationsskripte brauchen keine Anpassung, sie kopieren den ganzen
Ordner.

Soll das Spiel eine server-geprüfte Bestenliste haben, braucht es die Engine
zweimal — als `<spiel>_engine.py` und `static/<spiel>_engine.js` — und einen
Eintrag in `pruefe-engines.js`, damit der Gleichlauf mitgeprüft wird.

### Ein Release-Paket bauen

```bash
./paket-bauen.sh              # aus HEAD
./paket-bauen.sh v1.0         # aus einem Tag oder Commit
```

Das Skript baut `abw-arcade.tar.gz` (Linux, macOS) und `abw-arcade.zip`
(Windows) mit demselben Inhalt. Es liest ausschließlich über `git archive`
aus einem Commit, nie aus dem Arbeitsverzeichnis. Dadurch enthält das Paket
genau den eingecheckten Stand; eine `.venv`, eine `arcade.db` oder
halbfertige Änderungen können gar nicht hineingeraten. Die Zeilenenden
regelt `.gitattributes`: `install.sh` bekommt in beiden Archiven LF,
`install.cmd` und `install.ps1` CRLF.

Veröffentlichen:

```bash
gh release create v1.1 abw-arcade.tar.gz abw-arcade.zip \
  --title "ABW Arcade v1.1" --notes "Was sich geändert hat ..."
```

---

## Struktur

```
abw-arcade/
├── app.py                  Flask: Hub, Auth, Spiel-APIs, Schach, Admin
├── run.py                  Startpunkt für Dienst, check und make-admin;
│                           liest arcade.conf
├── tetris_engine.py        Tetris          ┐
├── snake_engine.py         Snake           │ Server-Replay, je ein
├── breakout_engine.py      Breakout        │ JS-Gegenstueck in static/
├── g2048_engine.py         2048            │
├── gd_engine.py            Geometry Dash   ┘
├── chess_engine.py         Schachregeln, prueft jeden Zug
├── chess_bot.py            Schach-Bot (Negamax, drei Staerken)
├── requirements.txt        Flask, waitress
├── install.sh              Einrichtung und Update fuer Linux und macOS
├── install.cmd             Einrichtung und Update fuer Windows ...
├── install.ps1             ... install.cmd startet dieses Skript
├── installer/sync.py       kopiert das Programm, schont Daten und WADs
├── paket-bauen.sh          baut abw-arcade.tar.gz und .zip aus git
├── pruefe-engines.js       vergleicht die .py- gegen die .js-Engines
├── pruefe_engines.py       Python-Seite dieser Pruefung
├── tests/                  unittest: Seiten, APIs, Perft, Installer
├── templates/              Hub, Spiele, Login/Registrierung, admin/
└── static/
    ├── style.css, chess.css
    ├── *_engine.js         die JS-Gegenstuecke zu den .py-Engines
    ├── tetris.js, snake.js, breakout.js, g2048.js, gd.js, doom.js
    └── doom/               websockets-doom.js/.wasm, freedoom1.wad, Lizenzen
```

Zur Laufzeit kommen `arcade.db`, `secret_key`, `arcade.conf` und `.venv/`
hinzu, unter macOS und Windows außerdem `data/`, `logs/` und (Windows)
`service/`. Die gehören nicht ins Repository und überstehen jedes Update.
Installationsskripte, `installer/` und `tests/` landen nicht im
Programmordner auf dem Server.

---

## Lizenz

MIT, siehe [LICENSE](LICENSE).

DOOM: Chocolate Doom steht unter GPL, FreeDoom unter BSD. Die vollständigen
Lizenztexte liegen in `static/doom/`.
