# ABW Arcade

Selbstgehostete Spiele-Website für den Homelab-Container: **Tetris, Snake,
Breakout** (mit server-verifizierten Leaderboards), **Schach** (PvP mit Elo
+ Bot-Modus, eigenes Design) und **DOOM** (WebAssembly im Browser).
Backend: Flask + SQLite + waitress, ein systemd-Service, keine weiteren
Abhängigkeiten.

## Neu aufsetzen (frische Umgebung)

Voraussetzung: Debian/Ubuntu (LXC, VM o. ä.) mit Root-Zugang und Internet
für `apt`/`pip`.

```bash
tar -xzf abw-arcade.tar.gz
cd abw-arcade
sudo ./install.sh
```

Das Skript installiert Pakete (python3, venv, rsync), legt den System-User
`arcade` an, kopiert die App nach `/opt/arcade`, baut das Virtualenv und
startet den systemd-Service `arcade.service` auf Port **5000**
(anpassbar: `PORT=8080 sudo ./install.sh`). Die Datenbank `arcade.db`
entsteht beim ersten Start automatisch leer — **es werden nie alte Accounts
oder Scores mitgeliefert oder überschrieben**.

Danach im Browser registrieren und den ersten Admin ernennen:

```bash
cd /opt/arcade && sudo -u arcade .venv/bin/flask --app app make-admin DEIN_NAME
```

Falls eine Firewall läuft: `ufw allow 5000/tcp` (bzw. euer Regelwerk).

## Update vs. frischer Reset

**Update** (Accounts/Scores behalten): neues Paket entpacken, `sudo
./install.sh`, fertig — Migrationen laufen beim Start automatisch.

**Frischer Reset** (alte Accounts/Scores verwerfen):

```bash
sudo systemctl stop arcade
sudo rm -f /opt/arcade/arcade.db /opt/arcade/secret_key
sudo ./install.sh        # oder nur: sudo systemctl start arcade
```

## Wechsel von der alten `tetris`-Installation

Frühere Versionen liefen unter `/opt/tetris` mit dem Service `tetris.service`
und dem User `tetris`. Beim Umstieg (Accounts/Scores werden NICHT übernommen):

```bash
sudo systemctl disable --now tetris.service 2>/dev/null
sudo rm -rf /opt/tetris /etc/systemd/system/tetris.service
sudo userdel tetris 2>/dev/null
sudo ./install.sh
```

`install.sh` warnt zusätzlich, falls die Alt-Installation noch liegt
(Port-Konflikt auf 5000).

## Betrieb

- Healthcheck ohne Login: `GET /healthz` → `{"ok": true}` (z. B. für
  Uptime Kuma).
- Logs: `journalctl -u arcade -f`
- Service: `systemctl status|restart arcade`
- In Umgebungen ohne systemd (z. B. Docker) gibt `install.sh` den passenden
  manuellen Startbefehl aus.

## Die Spiele & Architektur

**Tetris / Snake / Breakout** — die Leaderboards sind manipulationsarm:
Der Client schickt nie einen Score. Der Server vergibt pro Partie Seed +
einmalige `game_id`, der Client zeichnet nur Eingaben auf
(`{tick, action}`), und der Server **spielt die Partie mit der identischen
Python-Engine nach** (engine.py / snake_engine.py / breakout_engine.py —
bit-identisch zu den JS-Engines, Breakout dafür komplett in
Integer-Physik). Scores pro Spiel, ein Account für alles.

**Schach** — Spieler gegen Spieler über die Lobby (`/games/chess`): Partie
erstellen (Zufallsfarbe), zweiter Account tritt bei. Kein Replay, sondern
direkte Autorität: Der Server validiert **jeden Zug** mit
`chess_engine.py` (Vollregeln inkl. Rochade, en passant, Umwandlung,
Matt/Patt, 50-Züge, Wiederholung, totes Material; per
Perft-Referenzzahlen verifiziert). Updates per Polling (2–3 s), Remis &
Aufgeben, **Elo-Rangliste** (K=32, Start 1000). Zusätzlich ein
**Bot-Modus** (`chess_bot.py`, Negamax + Alpha-Beta, drei Stärken) —
Bot-Partien sind bewusst **unbewertet** und auf 3 gleichzeitig begrenzt.
Eigenes "Studierzimmer"-Design nur im Schach (`chess.css`, gescoped unter
`body.chess-theme`).

**DOOM** — Chocolate Doom als WebAssembly (GPL, selbst kompiliert) mit
**FreeDoom Phase 1** als freien Spieldaten (BSD); Lizenztexte liegen in
`static/doom/`. Läuft komplett im Browser, der Server liefert nur Statik —
darum bewusst **kein Leaderboard** (client-seitig = nicht verifizierbar).
Eigene `doom1.wad`/`doom2.wad` nach `static/doom/` legen → erscheint als
Start-Option. Steuerung: WASD + Maus (ins Bild klicken), Space feuern,
E benutzen, Shift rennen. Savegames leben nur im Tab.

**Admin** (`/admin`, nur für Admins): Dashboard mit Pro-Spiel-Statistik,
Spielerverwaltung (Admin-Flag, Passwort-Reset, Löschen mit CASCADE),
Score-Verwaltung mit Spiel-Filter, Aufräumen verwaister Replay-Sessions.

## Ein neues Spiel ergänzen

Eintrag in der `GAMES`-Registry in `app.py` (slug, title, endpoint,
status "live"), Route + Template, und — falls Leaderboard — Score-Zeilen
mit dem `slug` in die `scores`-Tabelle schreiben. Hub, Leaderboard-API und
Admin greifen es automatisch auf.

## Struktur

```
abw-arcade/
├── app.py                      # Flask: Hub, Auth, Spiel-APIs, Schach, Admin
├── engine.py                   # Tetris-Engine (Server-Replay)
├── snake_engine.py             # Snake-Engine (Server-Replay)
├── breakout_engine.py          # Breakout-Engine (Integer-Physik, Replay)
├── chess_engine.py             # Schachregeln (Server validiert jeden Zug)
├── chess_bot.py                # Schach-Bot (Negamax, 3 Stärken)
├── requirements.txt            # Flask, waitress
├── install.sh                  # Setup/Update (idempotent)
├── templates/                  # hub, game, snake, breakout, doom,
│   ├── chess_lobby/chess_game  #   Schach (eigenes Theme), login/register,
│   └── admin/                  #   Admin-Backend
└── static/
    ├── style.css / chess.css
    ├── engine.js, snake_engine.js, breakout_engine.js   # = .py-Engines
    ├── tetris.js, snake.js, breakout.js, doom.js
    ├── chess_lobby.js, chess_game.js
    └── doom/                   # websockets-doom.js/.wasm, freedoom1.wad,
                                #   default.cfg, Lizenzen
```
