#!/usr/bin/env bash
#
# ABW Arcade - Installation und Update unter Linux (Debian/Ubuntu) und macOS.
# Im entpackten Projektordner ausfuehren:
#
#     sudo ./install.sh                  Standard-Port (Linux 5000, macOS 5050)
#     sudo ./install.sh --port 8080      anderer Port
#     sudo ./install.sh --threads 16     mehr gleichzeitige Anfragen
#     sudo ./install.sh --yes            ohne Rueckfrage
#
# Idempotent: Ein erneuter Lauf aktualisiert Code und Abhaengigkeiten. Die
# Datenbank (arcade.db), der Sitzungsschluessel, arcade.conf, das Virtualenv
# und eigene DOOM-WADs bleiben dabei unangetastet; die vollstaendige Liste
# steht in installer/sync.py, das auch die Windows-Installation benutzt.
#
# Der Port eines bestehenden Servers bleibt bei Updates erhalten: Ohne
# --port gilt, was in arcade.conf steht; bei Linux-Installationen von
# Version 1.0 ohne arcade.conf das, was in der bisherigen Dienstdatei steht.
#
# Laeuft mit dem bash 3.2 von macOS. Deshalb hier nichts aus bash 4
# (keine assoziativen Arrays, kein ${x,,}, kein mapfile) und keine Werkzeuge,
# die es nur in der GNU-Fassung gibt (sed -i, readlink -f, stat -c, date -d,
# grep -P, timeout).
set -euo pipefail
umask 022

APP_DIR="/opt/arcade"
LABEL="io.github.utmwzar.abw-arcade"
LINUX_UNIT="/etc/systemd/system/arcade.service"
MAC_PLIST="/Library/LaunchDaemons/${LABEL}.plist"

# Quellen der Werte (auch in der Zusammenfassung zu sehen)
Q_AUFRUF="angegeben"
Q_CONF="aus arcade.conf"
Q_UNIT="aus der bisherigen Dienstdatei"
Q_STANDARD="Standard"

info()    { printf '>> %s\n' "$*"; }
hinweis() { printf '!! %s\n' "$*"; }
fehler()  { printf '\n!! FEHLER: %s\n' "$*" >&2; exit 1; }

hilfe() {
  cat <<'EOF'
ABW Arcade installieren oder aktualisieren (Linux und macOS).

  sudo ./install.sh [--port N] [--threads N] [--python PFAD] [--yes]

  --port N       TCP-Port der Seite. Ohne Angabe bleibt der bisherige;
                 bei einer Neuinstallation 5000 (Linux) bzw. 5050 (macOS).
  --threads N    gleichzeitig bearbeitete Anfragen (Standard 8)
  --python PFAD  nur macOS: dieses Python (3.10 oder neuer) benutzen
  --yes          keine Rueckfrage vor der Installation

Statt --port/--threads gehen in einer Root-Shell auch die Umgebungsvariablen
PORT und THREADS. sudo verwirft Umgebungsvariablen, deshalb mit sudo immer
die Schalter benutzen.
EOF
}

# ---------------------------------------------------------------------------
# Werte pruefen und ermitteln
# ---------------------------------------------------------------------------
ganzzahl() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "${#1}" -le 6 ]
}
port_gueltig()    { ganzzahl "$1" && [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le 65535 ]; }
threads_gueltig() { ganzzahl "$1" && [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le 1000 ]; }

# Wert eines Schluessels aus arcade.conf ausgeben (nichts, wenn nicht
# gesetzt). Liest wie run.py: BOM und CR werden ignoriert, Kommentare mit #,
# Schluessel ohne Ruecksicht auf Gross-/Kleinschreibung, Anfuehrungszeichen
# um den Wert werden entfernt, die letzte Zeile gilt.
conf_lesen() {  # DATEI SCHLUESSEL
  [ -r "$1" ] || return 0
  LC_ALL=C awk -v k="$2" -v bom="$(printf '\357\273\277')" -v q="'" '
    NR == 1 && index($0, bom) == 1 { $0 = substr($0, 4) }
    { sub(/\r$/, "") }
    /^[ \t]*#/ { next }
    {
      i = index($0, "=")
      if (i == 0) next
      key = substr($0, 1, i - 1); val = substr($0, i + 1)
      gsub(/^[ \t]+|[ \t]+$/, "", key); gsub(/^[ \t]+|[ \t]+$/, "", val)
      if (length(val) >= 2 && substr(val, 1, 1) == substr(val, length(val), 1) &&
          (substr(val, 1, 1) == "\"" || substr(val, 1, 1) == q))
        val = substr(val, 2, length(val) - 2)
      if (toupper(key) == k) wert = val
    }
    END { if (wert != "") print wert }
  ' "$1"
}

# Option aus der ExecStart-Zeile einer alten systemd-Unit ausgeben, etwa 5077
# aus "waitress-serve --host=0.0.0.0 --port=5077 --threads=8 app:app".
unit_lesen() {  # DATEI OPTION (port|threads)
  [ -r "$1" ] || return 0
  LC_ALL=C awk -v opt="--$2" '
    /^[ \t]*ExecStart=/ {
      n = split($0, t, /[ \t]+/)
      for (i = 1; i <= n; i++) {
        if (index(t[i], opt "=") == 1) wert = substr(t[i], length(opt) + 2)
        else if (t[i] == opt && i < n) wert = t[i + 1]
      }
    }
    END { if (wert != "") print wert }
  ' "$1"
}

# Einen Wert bestimmen. Reihenfolge: Aufruf, arcade.conf, alte Dienstdatei,
# Standard. Setzt ERG_WERT und ERG_QUELLE.
wert_ermitteln() {  # NAME AUFRUF CONF SCHLUESSEL UNIT OPTION STANDARD PRUEFFUNKTION
  local name="$1" aufruf="$2" conf="$3" key="$4" unit="$5" opt="$6" std="$7" pruef="$8" v
  if [ -n "$aufruf" ]; then
    "$pruef" "$aufruf" || fehler "$name '$aufruf' ist ungueltig."
    ERG_WERT=$((10#$aufruf)); ERG_QUELLE="$Q_AUFRUF"
    return 0
  fi
  v="$(conf_lesen "$conf" "$key")"
  if [ -n "$v" ]; then
    "$pruef" "$v" || fehler "$name '$v' in $conf ist ungueltig. Bitte dort korrigieren oder --$opt angeben."
    ERG_WERT=$((10#$v)); ERG_QUELLE="$Q_CONF"
    return 0
  fi
  if [ -n "$unit" ]; then
    v="$(unit_lesen "$unit" "$opt")"
    if [ -n "$v" ] && "$pruef" "$v"; then
      ERG_WERT=$((10#$v)); ERG_QUELLE="$Q_UNIT"
      return 0
    fi
  fi
  ERG_WERT="$std"; ERG_QUELLE="$Q_STANDARD"
}

# Zeile KEY=WERT in arcade.conf ersetzen oder anhaengen; alles andere bleibt.
conf_setzen() {  # DATEI SCHLUESSEL WERT
  local tmp="$1.neu.$$"
  if [ -f "$1" ]; then
    LC_ALL=C awk -v k="$2" -v v="$3" -v bom="$(printf '\357\273\277')" '
      NR == 1 && index($0, bom) == 1 { $0 = substr($0, 4) }
      { sub(/\r$/, "") }
      !/^[ \t]*#/ && index($0, "=") > 0 {
        key = substr($0, 1, index($0, "=") - 1)
        gsub(/^[ \t]+|[ \t]+$/, "", key)
        if (toupper(key) == k) {
          if (!fertig) print k "=" v
          fertig = 1
          next
        }
      }
      { print }
      END { if (!fertig) print k "=" v }
    ' "$1" > "$tmp"
  else
    printf '%s=%s\n' "$2" "$3" > "$tmp"
  fi
  mv -f "$tmp" "$1"
}

conf_vorlage() {
  cat <<'EOF'
# ABW Arcade - Einstellungen
#
# Der Dienst liest diese Datei bei jedem Start. Nach einer Aenderung den
# Dienst neu starten (README, Abschnitt "Betrieb"). Ein erneuter Lauf des
# Installers behaelt die Werte; einen anderen Port setzt auch
# "sudo ./install.sh --port 8080".
#
#   PORT      TCP-Port der Seite
#   THREADS   gleichzeitig bearbeitete Anfragen
#   HOST      Adresse, an die gebunden wird (Standard 0.0.0.0 = alle)
#   DATA_DIR  Ordner fuer arcade.db und secret_key
#             (nicht gesetzt = Programmordner)
EOF
}

# arcade.conf anlegen, falls sie fehlt, und nur die Werte eintragen, die
# angegeben wurden oder dort noch fehlen. Von Hand gesetzte Werte bleiben.
conf_pflegen() {  # DATA_DIR-Wert fuer eine neue Datei (leer: keiner)
  local conf="$APP_DIR/arcade.conf" neu=0
  if [ ! -f "$conf" ]; then
    conf_vorlage > "$conf"
    neu=1
  fi
  if [ "$PORT_QUELLE" != "$Q_CONF" ]; then
    conf_setzen "$conf" PORT "$PORT_WERT"
  fi
  if [ "$neu" = 1 ] || [ "$THREADS_QUELLE" = "$Q_AUFRUF" ] || [ "$THREADS_QUELLE" = "$Q_UNIT" ]; then
    conf_setzen "$conf" THREADS "$THREADS_WERT"
  fi
  if [ -n "$1" ] && [ -z "$(conf_lesen "$conf" DATA_DIR)" ]; then
    conf_setzen "$conf" DATA_DIR "$1"
  fi
}

# Adresse fuer die Proben: 127.0.0.1, ausser HOST bindet an eine bestimmte.
probe_host() {
  local h
  h="$(conf_lesen "$APP_DIR/arcade.conf" HOST)"
  case "$h" in
    ""|0.0.0.0|::|"[::]") echo "127.0.0.1" ;;
    *:*) echo "[$h]" ;;
    *) echo "$h" ;;
  esac
}

# ---------------------------------------------------------------------------
# Port, HTTP, Ausgabe
# ---------------------------------------------------------------------------
port_pids() {  # PORT - PIDs, die dort lauschen (leer: frei oder unbekannt)
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
  fi
}

dienst_pid() {
  if [ "$(uname -s)" = Darwin ]; then
    launchctl print "system/$LABEL" 2>/dev/null | awk '$1 == "pid" && $2 == "=" { print $3; exit }' || true
  else
    systemctl show -p MainPID arcade.service 2>/dev/null | cut -d= -f2 || true
  fi
}

port_belegt_melden() {  # PORT PIDS
  local pid
  hinweis "Port $1 ist belegt von:"
  for pid in $2; do
    ps -o pid=,comm= -p "$pid" 2>/dev/null | sed 's/^/     /' || true
  done
  if [ "$(uname -s)" = Darwin ] && [ "$1" = 5000 ]; then
    hinweis "Unter macOS belegt der AirPlay-Empfaenger Port 5000"
    hinweis "(Systemeinstellungen > Allgemein > AirDrop & Handoff)."
  fi
  fehler "Port $1 ist belegt. Anderen Port waehlen, z. B.:  sudo ./install.sh --port 8080"
}

# Vor dem Anhalten des Dienstes: Ist der Port von einem FREMDEN Programm
# belegt, wird abgebrochen, bevor sich irgendetwas aendert. Eigen ist der
# Hauptprozess des Dienstes und alles, was aus dem Programmordner laeuft.
port_vorab_pruefen() {  # PORT
  local pids eigen pid fremd=""
  pids="$(port_pids "$1")"
  [ -n "$pids" ] || return 0
  eigen="$(dienst_pid)"
  for pid in $pids; do
    [ "$pid" = "$eigen" ] && continue
    case "$(ps -o command= -p "$pid" 2>/dev/null || true)" in
      *"$APP_DIR/"*) continue ;;
    esac
    fremd="$fremd $pid"
  done
  [ -z "$fremd" ] || port_belegt_melden "$1" "$fremd"
}

# Nach dem Anhalten: bis zu 10 Sekunden warten, bis der Port frei ist.
port_freigabe_abwarten() {  # PORT
  local pids i=0
  while [ "$i" -lt 10 ]; do
    pids="$(port_pids "$1")"
    [ -n "$pids" ] || return 0
    sleep 1
    i=$((i + 1))
  done
  port_belegt_melden "$1" "$pids"
}

# Nach dem Anhalten, vor dem Start: run.py bindet den Port testweise, genau
# wie der Dienst es gleich tun wird (Exit 78 = belegt).
port_frei_vor_start() {
  local ausgabe pids
  if ausgabe="$("$VENV_PY" "$APP_DIR/run.py" check 2>&1)"; then
    return 0
  fi
  printf '%s\n' "$ausgabe" | sed 's/^/     /'
  pids="$(port_pids "$PORT_WERT")"
  if [ -n "$pids" ]; then
    port_belegt_melden "$PORT_WERT" "$pids"
  fi
  fehler "run.py check meldet ein Problem (siehe oben)."
}

# "STATUS CONTENT-TYPE" einer URL ausgeben, z. B. "200 text/javascript".
http_abfrage() {  # URL
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null --noproxy '*' --max-time 3 -w '%{http_code} %{content_type}' "$1" 2>/dev/null || true
  else
    "$VENV_PY" - "$1" 2>/dev/null <<'PY' || true
import sys
import urllib.request
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    with opener.open(sys.argv[1], timeout=3) as r:
        print(r.status, r.headers.get("Content-Type", ""))
except Exception:
    print("000")
PY
  fi
}

seite_abwarten() {  # SEKUNDEN
  local ende url
  ende=$((SECONDS + $1))
  url="http://$(probe_host):$PORT_WERT/healthz"
  while [ "$SECONDS" -lt "$ende" ]; do
    case "$(http_abfrage "$url")" in
      200*) return 0 ;;
    esac
    sleep 1
  done
  return 1
}

# JavaScript muss als text/javascript kommen, sonst laden Browser die Spiele
# (ES-Module) nicht.
js_pruefen() {
  local antwort
  antwort="$(http_abfrage "http://$(probe_host):$PORT_WERT/static/tetris.js")"
  case "$antwort" in
    "200 text/javascript"*) return 0 ;;
  esac
  fehler "Die Seite laeuft, liefert JavaScript aber als '$antwort' statt '200 text/javascript' aus. Browser laden die Spiele dann nicht."
}

zusammenfassung() {  # SYSTEM DIENST DATEN
  echo ""
  info "ABW Arcade installieren bzw. aktualisieren:"
  printf '     %-9s %s\n' "System:" "$1"
  printf '     %-9s %s\n' "Ordner:" "$APP_DIR"
  printf '     %-9s %s (%s)\n' "Port:" "$PORT_WERT" "$PORT_QUELLE"
  printf '     %-9s %s (%s)\n' "Threads:" "$THREADS_WERT" "$THREADS_QUELLE"
  printf '     %-9s %s\n' "Dienst:" "$2"
  printf '     %-9s %s\n' "Daten:" "$3"
  echo ""
}

bestaetigen() {
  local antwort=""
  [ "$ASSUME_YES" = 1 ] && return 0
  [ -t 0 ] || return 0
  printf 'Fortfahren? [J/n] '
  read -r antwort || antwort=""
  case "$antwort" in
    ""|j|J|ja|Ja|JA|y|Y|yes|Yes) return 0 ;;
  esac
  echo "Abgebrochen, nichts geaendert."
  exit 1
}

venv_einrichten() {  # BASIS-PYTHON
  local venv="$APP_DIR/.venv"
  VENV_PY="$venv/bin/python"
  if [ -x "$VENV_PY" ] && "$VENV_PY" -c 1 >/dev/null 2>&1; then
    info "Virtualenv vorhanden."
  elif [ -e "$venv" ]; then
    info "Virtualenv laeuft nicht mehr (etwa nach einem Python-Update) - wird neu angelegt ..."
    "$1" -m venv --clear "$venv"
  else
    info "Virtualenv anlegen ..."
    "$1" -m venv "$venv"
  fi
  info "Abhaengigkeiten installieren ..."
  "$VENV_PY" -m pip install --quiet --disable-pip-version-check --upgrade pip \
    || hinweis "pip liess sich nicht aktualisieren - es geht mit der vorhandenen Fassung weiter."
  "$VENV_PY" -m pip install --quiet --disable-pip-version-check -r "$APP_DIR/requirements.txt"
}

programm_abgleichen() {  # PYTHON
  info "Programmdateien abgleichen ..."
  mkdir -p "$APP_DIR"
  "$1" "$SRC_DIR/installer/sync.py" "$SRC_DIR" "$APP_DIR" \
    || fehler "Der Abgleich nach $APP_DIR ist fehlgeschlagen (siehe oben)."
}

abschluss() {  # IP MAKE-ADMIN-BEFEHL
  echo ""
  # Den installierten Stand aus PAKET-INFO zeigen (siehe paket-bauen.sh).
  if [ -f "$APP_DIR/PAKET-INFO" ]; then
    info "Installierter Stand:"
    sed 's/^/     /' "$APP_DIR/PAKET-INFO"
  else
    info "Installierter Stand: ohne PAKET-INFO (Installation aus einem git-Klon?)"
  fi
  echo ""
  info "Fertig! ABW Arcade:  http://${1:-<server-ip>}:$PORT_WERT"
  info "Ersten Admin ernennen (nach der Registrierung im Browser):"
  echo "     $2"
}

# ---------------------------------------------------------------------------
# Linux (Debian/Ubuntu, systemd)
# ---------------------------------------------------------------------------
systemd_laeuft() { [ -d /run/systemd/system ]; }

linux_installieren() {
  local ip

  # Hinweis auf die alte Installation (gleicher Standard-Port!)
  if [ -f /etc/systemd/system/tetris.service ] || [ -d /opt/tetris ]; then
    hinweis "Alte 'tetris'-Installation gefunden (/opt/tetris bzw. tetris.service)."
    hinweis "Sie belegt vermutlich denselben Port. Entfernen mit:"
    echo "     sudo systemctl disable --now tetris.service 2>/dev/null"
    echo "     sudo rm -rf /opt/tetris /etc/systemd/system/tetris.service"
    echo "     sudo userdel tetris 2>/dev/null"
    echo ""
  fi

  wert_ermitteln Port "$ARG_PORT" "$APP_DIR/arcade.conf" PORT "$LINUX_UNIT" port 5000 port_gueltig
  PORT_WERT="$ERG_WERT"; PORT_QUELLE="$ERG_QUELLE"
  wert_ermitteln Threads "$ARG_THREADS" "$APP_DIR/arcade.conf" THREADS "$LINUX_UNIT" threads 8 threads_gueltig
  THREADS_WERT="$ERG_WERT"; THREADS_QUELLE="$ERG_QUELLE"

  zusammenfassung "Linux" "arcade.service (systemd), Benutzer arcade" "$APP_DIR (arcade.db, secret_key)"
  bestaetigen
  if systemd_laeuft; then
    port_vorab_pruefen "$PORT_WERT"
  fi

  if command -v apt-get >/dev/null 2>&1; then
    info "Pakete installieren (python3, python3-venv, python3-pip) ..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq python3 python3-venv python3-pip >/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    hinweis "Kein apt-get gefunden - es wird das vorhandene python3 benutzt."
  else
    fehler "python3 fehlt, und apt-get gibt es hier nicht. Bitte Python 3.9 oder neuer samt venv-Modul installieren."
  fi
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' \
    || fehler "python3 ist zu alt; gebraucht wird 3.9 oder neuer."
  if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
    hinweis "python3 ist 3.8 und wird nicht mehr unterstuetzt; bitte bald auf ein neueres System wechseln."
  fi

  info "App-User & Zielverzeichnis ..."
  if ! id -u arcade >/dev/null 2>&1; then
    useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin arcade
  fi

  if systemd_laeuft && systemctl is-active --quiet arcade.service; then
    info "Dienst anhalten ..."
    systemctl stop arcade.service
    port_freigabe_abwarten "$PORT_WERT"
  fi

  programm_abgleichen python3
  conf_pflegen ""
  venv_einrichten python3
  chown -R arcade:arcade "$APP_DIR"

  info "systemd-Service schreiben ..."
  cat > "$LINUX_UNIT" <<EOF
[Unit]
Description=ABW Arcade (Flask + waitress)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=arcade
WorkingDirectory=${APP_DIR}
Environment=PYTHONUNBUFFERED=1
# Port und Threads stehen in ${APP_DIR}/arcade.conf.
ExecStart=${APP_DIR}/.venv/bin/python ${APP_DIR}/run.py
Restart=on-failure
RestartSec=3
# 78 = Einstellung ungueltig oder Port belegt (siehe run.py). Ein Neustart
# aendert daran nichts, also gar nicht erst versuchen.
RestartPreventExitStatus=78

[Install]
WantedBy=multi-user.target
EOF

  if systemd_laeuft; then
    systemctl daemon-reload
    port_frei_vor_start
    info "Dienst starten ..."
    systemctl enable --quiet arcade.service
    systemctl restart arcade.service
    if ! seite_abwarten 30; then
      journalctl -u arcade -n 50 --no-pager || true
      fehler "Die Seite antwortet nach 30 Sekunden nicht auf Port $PORT_WERT (Log siehe oben)."
    fi
    js_pruefen
    echo ""
    info "Status:"
    systemctl --no-pager --full status arcade.service | head -n 6 || true
  else
    echo ""
    info "Kein systemd in dieser Umgebung - die Dienstdatei liegt trotzdem bereit."
    info "Manueller Start:"
    echo "     sudo -u arcade ${APP_DIR}/.venv/bin/python ${APP_DIR}/run.py"
  fi

  ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  abschluss "$ip" "cd ${APP_DIR} && sudo -u arcade .venv/bin/python run.py make-admin BENUTZERNAME"
}

# ---------------------------------------------------------------------------
# macOS (launchd)
# ---------------------------------------------------------------------------

# Symlinks aufloesen, ohne die Datei auszufuehren (readlink -f gibt es erst
# ab macOS 12.3).
pfad_aufloesen() {  # PFAD
  local p="$1" ziel n=0
  while [ -L "$p" ] && [ "$n" -lt 40 ]; do
    ziel="$(readlink "$p")"
    case "$ziel" in
      /*) p="$ziel" ;;
      *) p="$(dirname "$p")/$ziel" ;;
    esac
    n=$((n + 1))
  done
  if [ -d "$(dirname "$p")" ]; then
    p="$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")"
  fi
  printf '%s\n' "$p"
}

# Taugt dieses Python fuer den Dienst? Setzt sonst PY_GRUND.
python_pruefen_macos() {  # PFAD
  local echt
  PY_GRUND=""
  if [ ! -x "$1" ]; then
    PY_GRUND="$1 gibt es nicht."
    return 1
  fi
  echt="$(pfad_aufloesen "$1")"
  # /usr/bin/python3 ist ohne Command Line Tools nur ein Platzhalter, der ein
  # Installationsfenster oeffnet, und mit ihnen Python 3.9. Nie ausfuehren.
  case "$echt" in
    /usr/bin/*|/System/*)
      PY_GRUND="$1 ist das Python von macOS und taugt nicht fuer den Dienst."
      return 1 ;;
  esac
  case "$1 $echt" in
    /Users/*|*" /Users/"*)
      PY_GRUND="$1 liegt in einem Benutzerordner; der Dienst (_arcade) kann es dort nicht lesen."
      return 1 ;;
  esac
  if ! "$1" -c 'import sys, venv, ensurepip; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
    PY_GRUND="$1 ist aelter als 3.10 oder hat kein venv-Modul."
    return 1
  fi
  return 0
}

# Fuer das Virtualenv einen Pfad nehmen, der bei Updates von Homebrew stabil
# bleibt: python@3.12 statt "das gerade aktuelle python3".
python_stabil() {  # PFAD
  local version prefix
  case "$1" in
    /opt/homebrew/bin/python3|/usr/local/bin/python3) ;;
    *) printf '%s\n' "$1"; return 0 ;;
  esac
  version="$("$1" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true)"
  for prefix in /opt/homebrew /usr/local; do
    if [ -n "$version" ] && [ -x "$prefix/opt/python@$version/bin/python$version" ]; then
      printf '%s\n' "$prefix/opt/python@$version/bin/python$version"
      return 0
    fi
  done
  if [ -n "$version" ] && [ -x "/Library/Frameworks/Python.framework/Versions/$version/bin/python3" ]; then
    printf '%s\n' "/Library/Frameworks/Python.framework/Versions/$version/bin/python3"
    return 0
  fi
  printf '%s\n' "$1"
}

python_finden_macos() {
  local kandidat v
  if [ -n "$ARG_PYTHON" ]; then
    python_pruefen_macos "$ARG_PYTHON" || fehler "$PY_GRUND"
    PY="$ARG_PYTHON"
    return 0
  fi
  # Absolute Pfade: sudo setzt einen eigenen PATH ohne /opt/homebrew/bin.
  for kandidat in \
    /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.10/bin/python3 \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3; do
    if python_pruefen_macos "$kandidat"; then
      PY="$(python_stabil "$kandidat")"
      return 0
    fi
  done
  for v in 3.14 3.13 3.12 3.11 3.10; do
    for kandidat in "/opt/homebrew/opt/python@$v/bin/python$v" "/usr/local/opt/python@$v/bin/python$v"; do
      if python_pruefen_macos "$kandidat"; then
        PY="$kandidat"
        return 0
      fi
    done
  done
  cat >&2 <<'EOF'

!! FEHLER: Kein passendes Python gefunden.

Gebraucht wird Python 3.10 oder neuer, installiert fuer alle Benutzer. So geht es:

  1. https://www.python.org/downloads/macos/ oeffnen und bei einer aktuellen
     Version (etwa 3.12 oder 3.13) den "macOS 64-bit universal2 installer"
     laden.
  2. Die .pkg-Datei oeffnen und die Installation durchklicken.
  3. sudo ./install.sh erneut starten.

Ein vorhandenes Python laesst sich auch direkt angeben:
     sudo ./install.sh --python /pfad/zu/python3

Nicht geeignet sind /usr/bin/python3 (das Python von macOS) und Pythons in
Benutzerordnern (/Users/...): Der Dienst laeuft als _arcade und darf dort
nicht lesen.
EOF
  exit 1
}

# Freie ID im Bereich 200-499, als UID und GID gleichermassen unbenutzt.
freie_id_macos() {
  local belegt i=200
  belegt="$( { dscl . -list /Users UniqueID; dscl . -list /Groups PrimaryGroupID; } 2>/dev/null | awk '{print $2}')"
  while [ "$i" -le 499 ]; do
    if ! printf '%s\n' "$belegt" | grep -qx "$i"; then
      printf '%s\n' "$i"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

konto_macos() {
  local gid uid
  if dscl . -read /Groups/_arcade PrimaryGroupID >/dev/null 2>&1; then
    gid="$(dscl . -read /Groups/_arcade PrimaryGroupID | awk '{print $2}')"
  else
    info "Gruppe _arcade anlegen ..."
    gid="$(freie_id_macos)" || fehler "Keine freie Gruppen-ID zwischen 200 und 499."
    dscl . -create /Groups/_arcade
    dscl . -create /Groups/_arcade PrimaryGroupID "$gid"
    dscl . -create /Groups/_arcade RealName "ABW Arcade"
    dscl . -create /Groups/_arcade Password '*'
  fi
  if ! dscl . -read /Users/_arcade UniqueID >/dev/null 2>&1; then
    info "Verstecktes Dienstkonto _arcade anlegen ..."
    if dscl . -list /Users UniqueID 2>/dev/null | awk '{print $2}' | grep -qx "$gid"; then
      uid="$(freie_id_macos)" || fehler "Keine freie Benutzer-ID zwischen 200 und 499."
    else
      uid="$gid"
    fi
    dscl . -create /Users/_arcade
    dscl . -create /Users/_arcade UniqueID "$uid"
    dscl . -create /Users/_arcade PrimaryGroupID "$gid"
    dscl . -create /Users/_arcade UserShell /usr/bin/false
    dscl . -create /Users/_arcade NFSHomeDirectory /var/empty
    dscl . -create /Users/_arcade RealName "ABW Arcade"
    dscl . -create /Users/_arcade Password '*'
    dscl . -create /Users/_arcade IsHidden 1
    dscacheutil -flushcache 2>/dev/null || true
  fi
  id _arcade >/dev/null 2>&1 || fehler "Das Konto _arcade laesst sich nicht aufloesen."
}

macos_firewall() {
  local fw=/usr/libexec/ApplicationFirewall/socketfilterfw basis bin
  [ -x "$fw" ] || return 0
  if ! "$fw" --getglobalstate 2>/dev/null | grep -q 'State = [12]'; then
    return 0
  fi
  # Freigegeben wird die Python-Datei, die tatsaechlich lauscht. Bei Python
  # aus python.org und Homebrew ist das die Python.app im Framework.
  basis="$("$VENV_PY" -c 'import sys; print(sys.base_prefix)' 2>/dev/null || true)"
  for bin in "$(pfad_aufloesen "$VENV_PY")" "$basis/Resources/Python.app/Contents/MacOS/Python"; do
    [ -x "$bin" ] || continue
    "$fw" --add "$bin" >/dev/null 2>&1 || true
    "$fw" --unblockapp "$bin" >/dev/null 2>&1 || true
    info "Firewall: eingehende Verbindungen fuer $bin erlaubt."
  done
}

macos_ip() {
  local schnittstelle
  schnittstelle="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2; exit }' || true)"
  if [ -n "$schnittstelle" ]; then
    ipconfig getifaddr "$schnittstelle" 2>/dev/null || true
  fi
}

macos_installieren() {
  local daten="$APP_DIR/data" logs="$APP_DIR/logs" i

  python_finden_macos
  info "Python fuer den Dienst: $PY"

  # Standard 5050: Auf macOS ab 12 belegt der AirPlay-Empfaenger Port 5000.
  wert_ermitteln Port "$ARG_PORT" "$APP_DIR/arcade.conf" PORT "" port 5050 port_gueltig
  PORT_WERT="$ERG_WERT"; PORT_QUELLE="$ERG_QUELLE"
  wert_ermitteln Threads "$ARG_THREADS" "$APP_DIR/arcade.conf" THREADS "" threads 8 threads_gueltig
  THREADS_WERT="$ERG_WERT"; THREADS_QUELLE="$ERG_QUELLE"

  zusammenfassung "macOS" "$LABEL (launchd), Konto _arcade" "$daten"
  bestaetigen

  konto_macos
  port_vorab_pruefen "$PORT_WERT"

  info "Dienst anhalten ..."
  launchctl bootout "system/$LABEL" >/dev/null 2>&1 || true
  i=0
  while launchctl print "system/$LABEL" >/dev/null 2>&1; do
    [ "$i" -lt 15 ] || fehler "Der Dienst $LABEL laesst sich nicht anhalten."
    sleep 1
    i=$((i + 1))
  done
  port_freigabe_abwarten "$PORT_WERT"

  mkdir -p "$APP_DIR"
  chown root:wheel "$APP_DIR"
  chmod 755 "$APP_DIR"
  programm_abgleichen "$PY"
  conf_pflegen "$daten"
  venv_einrichten "$PY"

  # Code gehoert root und ist fuer _arcade nur lesbar; Daten und Logs
  # gehoeren _arcade allein. Links werden dabei nie verfolgt.
  find "$APP_DIR" \( -path "$daten" -o -path "$logs" \) -prune -o -exec chown -h root:wheel {} +
  find "$APP_DIR" \( -path "$daten" -o -path "$logs" \) -prune -o ! -type l -exec chmod go+rX,go-w {} +
  mkdir -p "$daten" "$logs"
  chown -R _arcade:_arcade "$daten" "$logs"
  chmod 700 "$daten"
  chmod 750 "$logs"
  if [ "$(conf_lesen "$APP_DIR/arcade.conf" DATA_DIR)" != "$daten" ]; then
    hinweis "arcade.conf nennt einen anderen DATA_DIR; der muss fuer _arcade beschreibbar sein."
  fi

  info "LaunchDaemon schreiben ..."
  cat > "$MAC_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${APP_DIR}/.venv/bin/python</string>
    <string>${APP_DIR}/run.py</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>UserName</key>
  <string>_arcade</string>
  <key>GroupName</key>
  <string>_arcade</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Standard</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONUNBUFFERED</key>
    <string>1</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${logs}/arcade.log</string>
  <key>StandardErrorPath</key>
  <string>${logs}/arcade.log</string>
</dict>
</plist>
EOF
  chown root:wheel "$MAC_PLIST"
  chmod 644 "$MAC_PLIST"
  plutil -lint "$MAC_PLIST" >/dev/null || fehler "$MAC_PLIST ist kein gueltiges plist."

  port_frei_vor_start
  info "Dienst starten ..."
  launchctl enable "system/$LABEL"
  launchctl bootstrap system "$MAC_PLIST" \
    || fehler "launchctl bootstrap ist fehlgeschlagen. Details: sudo launchctl print system/$LABEL"
  macos_firewall

  if ! seite_abwarten 30; then
    tail -n 50 "$logs/arcade.log" 2>/dev/null || true
    fehler "Die Seite antwortet nach 30 Sekunden nicht auf Port $PORT_WERT (Log siehe oben, vollstaendig in $logs/arcade.log)."
  fi
  js_pruefen

  abschluss "$(macos_ip)" "sudo -u _arcade ${APP_DIR}/.venv/bin/python ${APP_DIR}/run.py make-admin BENUTZERNAME"
}

# ---------------------------------------------------------------------------
main() {
  ARG_PORT="${PORT:-}"
  ARG_THREADS="${THREADS:-}"
  ARG_PYTHON="${ARCADE_PYTHON:-}"
  ASSUME_YES=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --port|--threads|--python)
        [ $# -ge 2 ] || fehler "$1 braucht einen Wert (Hilfe: ./install.sh --help)"
        case "$1" in
          --port) ARG_PORT="$2" ;;
          --threads) ARG_THREADS="$2" ;;
          --python) ARG_PYTHON="$2" ;;
        esac
        shift 2 ;;
      --port=*) ARG_PORT="${1#--port=}"; shift ;;
      --threads=*) ARG_THREADS="${1#--threads=}"; shift ;;
      --python=*) ARG_PYTHON="${1#--python=}"; shift ;;
      -y|--yes) ASSUME_YES=1; shift ;;
      -h|--help) hilfe; exit 0 ;;
      *) fehler "Unbekanntes Argument: $1  (Hilfe: ./install.sh --help)" ;;
    esac
  done
  if [ -n "$ARG_PORT" ] && ! port_gueltig "$ARG_PORT"; then
    fehler "Port '$ARG_PORT' ist ungueltig (erlaubt: 1 bis 65535)."
  fi
  if [ -n "$ARG_THREADS" ] && ! threads_gueltig "$ARG_THREADS"; then
    fehler "Threads '$ARG_THREADS' ist ungueltig (erlaubt: 1 bis 1000)."
  fi

  SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "$SRC_DIR/installer/sync.py" ] \
    || fehler "installer/sync.py fehlt neben install.sh. Bitte das vollstaendige Paket entpacken."
  [ "$(id -u)" -eq 0 ] || fehler "Bitte mit Administratorrechten starten:  sudo ./install.sh"

  case "$(uname -s)" in
    Linux) linux_installieren ;;
    Darwin) macos_installieren ;;
    *) fehler "Dieses Skript kennt Linux und macOS. Unter Windows: install.cmd" ;;
  esac
}

# Nur ausfuehren, wenn das Skript gestartet und nicht mit "source" geladen
# wurde (die Funktionen lassen sich so einzeln pruefen).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
