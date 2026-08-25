# ABW Arcade

Selbstgehostete Spiele-Website für den Homelab-Container. Ein Account, sieben
Spiele, server-geprüfte Bestenlisten.

**Tetris · Snake · Breakout · 2048 · Geometry Dash · Schach · DOOM**

Flask + SQLite + waitress, ein systemd-Dienst. Keine Datenbank aufzusetzen,
kein Reverse Proxy nötig, kein Docker, keine externen Dienste.

---

## Installation

Vorausgesetzt wird Debian oder Ubuntu (LXC, VM, Container) mit Root-Zugang
und Internet für `apt` und `pip`. Mehr nicht — alles Weitere richtet das
Skript ein.

```bash
curl -fsSL -o abw-arcade.tar.gz \
  https://github.com/utmwzar/ABW-Arcade/releases/latest/download/abw-arcade.tar.gz
tar -xzf abw-arcade.tar.gz
cd abw-arcade
sudo ./install.sh
```

Der Link zeigt immer auf das neueste Release; es ist keine Versionsnummer
nachzuschlagen. Wo `curl` fehlt, tut `wget -O abw-arcade.tar.gz <URL>`
dasselbe.

Danach läuft die Seite auf Port **5000**. Ein anderer Port geht über
`PORT=8080 sudo ./install.sh`.

### Alternative: direkt aus git

`install.sh` läuft in jedem Ordner, in dem das Projekt liegt — ein Archiv
ist nicht nötig:

```bash
git clone --depth 1 https://github.com/utmwzar/ABW-Arcade.git
cd ABW-Arcade
sudo ./install.sh
```

Ein Release ist ein fester, getesteter Stand; der Klon ist der laufende
Entwicklungsstand. Für einen Server, der einfach laufen soll, ist das
Release die richtige Wahl.

### Was `install.sh` tut

Es installiert `python3`, `python3-venv`, `python3-pip` und `rsync`, legt den
System-User `arcade` an, kopiert die Anwendung nach `/opt/arcade`, baut dort
ein Virtualenv und richtet den systemd-Dienst `arcade.service` ein.

Die Datenbank `arcade.db` entsteht beim ersten Start leer. Es werden nie
Accounts oder Punktestände mitgeliefert.

Zum Schluss meldet das Skript, welcher Stand installiert wurde. Dieselbe
Angabe liegt danach in `/opt/arcade/PAKET-INFO` — damit lässt sich auf einem
laufenden Server jederzeit feststellen, welcher Commit dort tatsächlich
läuft.

### Ersten Admin ernennen

Zuerst im Browser registrieren, dann auf dem Server:

```bash
cd /opt/arcade && sudo -u arcade .venv/bin/flask --app app make-admin NUTZERNAME
```

Läuft eine Firewall, muss der Port frei sein: `ufw allow 5000/tcp`.

---

## Update

Neues Paket holen, entpacken, `sudo ./install.sh` — derselbe Ablauf wie bei
der Installation. Das Skript ist idempotent und lässt sich beliebig oft
ausführen.

**Accounts und Bestenlisten bleiben erhalten.** Unangetastet bleiben:

| | |
|---|---|
| `arcade.db` | Accounts, Punktestände, Elo, laufende Partien |
| `secret_key` | Sitzungsschlüssel; ohne ihn müssen sich alle neu anmelden |
| `static/doom/doom1.wad`, `doom2.wad` | selbst hinterlegte DOOM-Daten |
| `.venv/` | das Virtualenv |

Alles andere wird ersetzt, überzählige Dateien werden entfernt.

### Zurücksetzen

Sollen Accounts und Punktestände verschwinden:

```bash
sudo systemctl stop arcade
sudo rm -f /opt/arcade/arcade.db /opt/arcade/secret_key
sudo systemctl start arcade
```

Beides entsteht beim nächsten Start neu und leer.

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

```bash
systemctl status arcade        # läuft es?
systemctl restart arcade       # neu starten
journalctl -u arcade -f        # Logs mitlesen
curl localhost:5000/healthz    # {"ok": true}
```

`/healthz` braucht keinen Login und prüft die Datenbank gleich mit — taugt
also unverändert als Ziel für Uptime Kuma oder einen anderen Monitor.

Wo kein systemd läuft (etwa in einem Docker-Container), schreibt
`install.sh` die Dienstdatei trotzdem und gibt den passenden manuellen
Startbefehl aus.

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

Eigene `doom1.wad` oder `doom2.wad` nach `/opt/arcade/static/doom/` legen;
sie erscheinen dann als zusätzliche Startoption und überstehen Updates.

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

Hub, Leaderboard-API und Admin greifen den Eintrag von selbst auf. Auch
`install.sh` braucht keine Anpassung, es kopiert den ganzen Ordner.

Soll das Spiel eine server-geprüfte Bestenliste haben, braucht es die Engine
zweimal — als `<spiel>_engine.py` und `static/<spiel>_engine.js` — und einen
Eintrag in `pruefe-engines.js`, damit der Gleichlauf mitgeprüft wird.

### Ein Release-Paket bauen

```bash
./paket-bauen.sh              # aus HEAD
./paket-bauen.sh v1.0         # aus einem Tag oder Commit
```

Das Skript liest ausschließlich über `git archive` aus einem Commit, nie aus
dem Arbeitsverzeichnis. Dadurch enthält das Paket genau den eingecheckten
Stand; eine `.venv`, eine `arcade.db` oder halbfertige Änderungen können gar
nicht hineingeraten.

Veröffentlichen:

```bash
gh release create v1.1 abw-arcade.tar.gz \
  --title "ABW Arcade v1.1" --notes "Was sich geändert hat ..."
```

---

## Struktur

```
abw-arcade/
├── app.py                  Flask: Hub, Auth, Spiel-APIs, Schach, Admin
├── tetris_engine.py        Tetris          ┐
├── snake_engine.py         Snake           │ Server-Replay, je ein
├── breakout_engine.py      Breakout        │ JS-Gegenstueck in static/
├── g2048_engine.py         2048            │
├── gd_engine.py            Geometry Dash   ┘
├── chess_engine.py         Schachregeln, prueft jeden Zug
├── chess_bot.py            Schach-Bot (Negamax, drei Staerken)
├── requirements.txt        Flask, waitress
├── install.sh              Einrichtung und Update, idempotent
├── paket-bauen.sh          baut abw-arcade.tar.gz aus git
├── pruefe-engines.js       vergleicht die .py- gegen die .js-Engines
├── pruefe_engines.py       Python-Seite dieser Pruefung
├── templates/              Hub, Spiele, Login/Registrierung, admin/
└── static/
    ├── style.css, chess.css
    ├── *_engine.js         die JS-Gegenstuecke zu den .py-Engines
    ├── tetris.js, snake.js, breakout.js, g2048.js, gd.js, doom.js
    └── doom/               websockets-doom.js/.wasm, freedoom1.wad, Lizenzen
```

Zur Laufzeit kommen `arcade.db`, `secret_key` und `.venv/` hinzu. Die gehören
nicht ins Repository und überstehen jedes Update.

---

## Lizenz

MIT, siehe [LICENSE](LICENSE).

DOOM: Chocolate Doom steht unter GPL, FreeDoom unter BSD. Die vollständigen
Lizenztexte liegen in `static/doom/`.
