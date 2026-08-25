# ABW Arcade

Selbstgehostete Spiele-Website für den Homelab-Container. Ein Account, sieben
Spiele, server-geprüfte Bestenlisten.

**Tetris · Snake · Breakout · 2048 · Geometry Dash · Schach · DOOM**

Backend: Flask + SQLite + waitress, ein systemd-Dienst, sonst nichts. Keine
Datenbank aufzusetzen, kein Reverse Proxy nötig, kein Docker.

---

## Installation

Voraussetzung: Debian oder Ubuntu (LXC, VM, Container) mit Root-Zugang und
Internet für `apt` und `pip`.

Das hier ist alles — von der leeren Maschine bis zur laufenden Seite:

```bash
curl -fsSL -o abw-arcade.tar.gz \
  https://github.com/utmwzar/ABW-Arcade/releases/latest/download/abw-arcade.tar.gz
tar -xzf abw-arcade.tar.gz
cd abw-arcade
sudo ./install.sh
```

Der Link zeigt immer auf das **neueste** Release — es ist keine
Versionsnummer nachzuschlagen und keine URL anzupassen.

Ohne `curl` tut es `wget` genauso:

```bash
wget -O abw-arcade.tar.gz \
  https://github.com/utmwzar/ABW-Arcade/releases/latest/download/abw-arcade.tar.gz
```

### Alternative: direkt aus git

Wenn git ohnehin da ist, geht es auch ohne Archiv. `install.sh` läuft in
jedem Ordner, in dem das Projekt liegt:

```bash
git clone --depth 1 https://github.com/utmwzar/ABW-Arcade.git
cd ABW-Arcade
sudo ./install.sh
```

Der Unterschied: Das Release ist ein fester, getesteter Stand. `git clone`
holt den aktuellen Entwicklungsstand, der auch mal kaputt sein kann. **Für
den Betrieb ist das Release die richtige Wahl**, zum Mitentwickeln der Klon.

### Was das Skript macht

Es installiert `python3`, `python3-venv`, `python3-pip` und `rsync`, legt den
System-User `arcade` an, kopiert die App nach `/opt/arcade`, baut dort ein
Virtualenv und startet den systemd-Dienst `arcade.service` auf Port **5000**.

Anderer Port:

```bash
PORT=8080 sudo ./install.sh
```

Zum Schluss zeigt es an, welcher Stand installiert wurde. Dieselbe Angabe
liegt danach in `/opt/arcade/PAKET-INFO` — damit lässt sich auf einem
laufenden Server jederzeit nachsehen, welcher Commit dort wirklich läuft.

### Ersten Admin ernennen

Erst im Browser registrieren, dann auf dem Server:

```bash
cd /opt/arcade && sudo -u arcade .venv/bin/flask --app app make-admin DEIN_NAME
```

Falls eine Firewall läuft, muss der Port frei sein: `ufw allow 5000/tcp`.

---

## Update

Dasselbe wie die Installation — neues Paket holen, entpacken, `install.sh`.
Das Skript ist idempotent.

**Accounts und Highscores bleiben erhalten.** Ausdrücklich unangetastet:

| Datei | Inhalt |
|---|---|
| `arcade.db` | Accounts, Scores, Elo, laufende Partien |
| `secret_key` | Sitzungsschlüssel — ohne ihn müssen sich alle neu anmelden |
| `static/doom/doom1.wad`, `doom2.wad` | selbst hinterlegte DOOM-Daten |
| `.venv/` | das Virtualenv |

Alles andere wird ersetzt, veraltete Dateien werden entfernt.

### Frischer Reset

Wenn Accounts und Scores weg sollen:

```bash
sudo systemctl stop arcade
sudo rm -f /opt/arcade/arcade.db /opt/arcade/secret_key
sudo systemctl start arcade
```

Beides entsteht beim nächsten Start neu und leer.

### Umstieg von der alten `tetris`-Installation

Frühere Versionen liefen unter `/opt/tetris` mit dem Dienst `tetris.service`.
Accounts und Scores werden dabei **nicht** übernommen:

```bash
sudo systemctl disable --now tetris.service 2>/dev/null
sudo rm -rf /opt/tetris /etc/systemd/system/tetris.service
sudo userdel tetris 2>/dev/null
sudo ./install.sh
```

`install.sh` warnt von selbst, falls die Alt-Installation noch liegt — sie
belegt denselben Port 5000.

---

## Betrieb

```bash
systemctl status arcade        # läuft es?
systemctl restart arcade       # neu starten
journalctl -u arcade -f        # Logs mitlesen
curl localhost:5000/healthz    # {"ok": true}
```

`/healthz` braucht keinen Login und prüft auch die Datenbank — taugt also
direkt als Uptime-Kuma-Ziel.

In Umgebungen ohne systemd (etwa Docker) schreibt `install.sh` die
Dienstdatei trotzdem und gibt den passenden manuellen Startbefehl aus.

---

## Die Spiele & wie sie funktionieren

**Tetris / Snake / Breakout / 2048 / Geometry Dash** — die Bestenlisten sind
manipulationsarm gebaut: **Der Client schickt nie einen Score.** Der Server
vergibt pro Partie einen Seed und eine einmalige `game_id`, der Client
zeichnet nur Eingaben auf (`{tick, action}`), und der Server **spielt die
Partie mit der identischen Python-Engine nach** und rechnet den Punktestand
selbst aus.

Einen Score zu fälschen heißt damit: ein Eingabeprotokoll einreichen, das ihn
tatsächlich erreicht. Möglich ist das nur, indem man wirklich gut spielt —
oder einen Bot schreibt, der es tut.

Damit das aufgeht, müssen die Engines paarweise bit-identisch rechnen —
`tetris_engine.py` gegen `tetris_engine.js` und so weiter. Breakout und
Geometry Dash benutzen deshalb reine Integer-Fixed-Point-Physik statt
Fließkomma, 2048 einen geseedeten Tile-Spawn. Bei Geometry Dash hängt das
Level nur am Seed, der Score ist die erreichte Distanz.

**Schach** — Spieler gegen Spieler über die Lobby (`/games/chess`): Partie
erstellen, zweiter Account tritt bei. Kein Replay, sondern direkte Autorität:
Der Server validiert **jeden einzelnen Zug** mit `chess_engine.py` —
Vollregeln inklusive Rochade, en passant, Umwandlung, Matt, Patt,
50-Züge-Regel, Stellungswiederholung und totem Material, gegen
Perft-Referenzzahlen geprüft. Dazu Elo (K=32, Start 1000), Remis und
Aufgeben.

Ein **Bot-Modus** (`chess_bot.py`, Negamax mit Alpha-Beta, drei Stärken) ist
bewusst **unbewertet** und auf drei gleichzeitige Partien begrenzt.

**DOOM** — Chocolate Doom als WebAssembly, mit **FreeDoom Phase 1** als
freien Spieldaten. Läuft vollständig im Browser, der Server liefert nur
Statik. Darum bewusst **ohne Bestenliste**: Was im Browser gerechnet wird,
lässt sich nicht überprüfen.

Eigene `doom1.wad`/`doom2.wad` nach `/opt/arcade/static/doom/` legen — sie
erscheinen dann als zusätzliche Startoption und überleben Updates. Steuerung:
WASD + Maus (ins Bild klicken), Space feuert, E benutzt, Shift rennt.
Spielstände leben nur im Tab.

**Admin** (`/admin`) — Dashboard mit Statistik je Spiel, Spielerverwaltung
(Adminrechte, Passwort zurücksetzen, Löschen mit CASCADE), Score-Verwaltung
mit Filter, Aufräumen verwaister Replay-Sitzungen.

---

## Mitentwickeln

### Ein neues Spiel ergänzen

1. Eintrag in der `GAMES`-Registry in `app.py` (slug, title, endpoint,
   status `"live"`)
2. Route + Template
3. Falls es eine Bestenliste hat: Score-Zeilen mit demselben `slug` in die
   Tabelle `scores` schreiben

Hub, Leaderboard-API und Admin greifen den Eintrag automatisch auf. Auch
`install.sh` braucht keine Anpassung — es kopiert den ganzen Ordner.

### Ein Release-Paket bauen

Nur nötig, um ein Release zu veröffentlichen:

```bash
./paket-bauen.sh              # aus HEAD
./paket-bauen.sh v1.1         # aus einem Tag oder Commit
```

Das Skript liest ausschließlich über `git archive` aus einem Commit, nie aus
dem Arbeitsverzeichnis. Dadurch enthält das Paket per Konstruktion genau den
eingecheckten Stand — eine `.venv`, eine `arcade.db` oder halbfertige
Änderungen können gar nicht hineingeraten.

Das Archiv sollte nicht von Hand gepackt werden: Dabei gibt es keine
Zusicherung, dass sein Inhalt zum Code passt.

Veröffentlichen:

```bash
gh release create v1.2 abw-arcade.tar.gz \
  --title "ABW Arcade v1.2" --notes "Was sich geändert hat ..."
```

### Lokal ausprobieren, ohne zu installieren

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/flask --app app run --port 5000
```

---

## Struktur

```
abw-arcade/
├── app.py                  Flask: Hub, Auth, Spiel-APIs, Schach, Admin
├── tetris_engine.py        Tetris (Server-Replay)
├── snake_engine.py         Snake
├── breakout_engine.py      Breakout (Integer-Physik)
├── g2048_engine.py         2048 (geseedeter Spawn)
├── gd_engine.py            Geometry Dash (Integer-Physik)
├── chess_engine.py         Schachregeln, validiert jeden Zug
├── chess_bot.py            Schach-Bot (Negamax, 3 Stärken)
├── requirements.txt        Flask, waitress
├── install.sh              Setup und Update, idempotent
├── paket-bauen.sh          baut abw-arcade.tar.gz aus git
├── templates/              hub, Spiele, login/register, admin/
└── static/
    ├── style.css, chess.css
    ├── *_engine.js         die JS-Gegenstücke zu den .py-Engines
    ├── tetris.js, snake.js, breakout.js, g2048.js, gd.js, doom.js
    └── doom/               websockets-doom.js/.wasm, freedoom1.wad, Lizenzen
```

Zur Laufzeit kommen `arcade.db`, `secret_key` und `.venv/` dazu — die gehören
nicht ins Repo und überleben jedes Update.

---

## Lizenz

MIT, siehe [LICENSE](LICENSE).

DOOM: Chocolate Doom steht unter GPL, FreeDoom unter BSD. Die Lizenztexte
liegen in `static/doom/`.
