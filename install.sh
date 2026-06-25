#!/usr/bin/env bash
#
# ABW Arcade — Installation/Update in einem frischen Debian/Ubuntu-System
# (LXC, VM oder Container). Im entpackten Projektordner ausführen:
#
#     sudo ./install.sh
#
# Idempotent: erneut ausführen aktualisiert Code + Dependencies. Die Datenbank
# (arcade.db) wird NIE angefasst — sie entsteht beim ersten Start automatisch.
# Für einen kompletten Neuanfang ohne alte Accounts/Scores siehe README
# ("Frischer Reset").
set -euo pipefail

APP_USER="arcade"
APP_DIR="/opt/arcade"
PORT="${PORT:-5000}"
THREADS="${THREADS:-8}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Hinweis auf die alte Installation (gleicher Standard-Port!)
if [ -f /etc/systemd/system/tetris.service ] || [ -d /opt/tetris ]; then
  echo "!! Alte 'tetris'-Installation gefunden (/opt/tetris bzw. tetris.service)."
  echo "!! Sie belegt vermutlich Port ${PORT}. Entfernen mit:"
  echo "     sudo systemctl disable --now tetris.service 2>/dev/null"
  echo "     sudo rm -rf /opt/tetris /etc/systemd/system/tetris.service"
  echo "     sudo userdel tetris 2>/dev/null"
  echo ""
fi

echo ">> Pakete installieren ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip rsync >/dev/null

echo ">> App-User & Zielverzeichnis ..."
id -u "$APP_USER" &>/dev/null || \
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a \
  "$SRC_DIR/app.py" \
  "$SRC_DIR/engine.py" \
  "$SRC_DIR/snake_engine.py" \
  "$SRC_DIR/breakout_engine.py" \
  "$SRC_DIR/chess_engine.py" \
  "$SRC_DIR/chess_bot.py" \
  "$SRC_DIR/requirements.txt" \
  "$SRC_DIR/README.md" \
  "$SRC_DIR/templates" \
  "$SRC_DIR/static" \
  "$APP_DIR/"

echo ">> Virtualenv & Dependencies ..."
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo ">> systemd-Service schreiben ..."
cat > /etc/systemd/system/arcade.service <<EOF
[Unit]
Description=ABW Arcade (Flask + waitress)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/.venv/bin/waitress-serve --host=0.0.0.0 --port=${PORT} --threads=${THREADS} app:app
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable --now arcade.service
  systemctl restart arcade.service
  echo ""
  echo ">> Status:"
  systemctl --no-pager --full status arcade.service | head -n 6 || true
else
  echo ""
  echo ">> Kein systemd in dieser Umgebung — Service-Datei liegt bereit."
  echo ">> Manueller Start:"
  echo "     sudo -u ${APP_USER} ${APP_DIR}/.venv/bin/waitress-serve --host=0.0.0.0 --port=${PORT} --threads=${THREADS} app:app"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo ">> Fertig! ABW Arcade:  http://${IP:-<server-ip>}:${PORT}"
echo ">> Ersten Admin ernennen (nach der Registrierung im Browser):"
echo "     cd ${APP_DIR} && sudo -u ${APP_USER} .venv/bin/flask --app app make-admin DEIN_NAME"
