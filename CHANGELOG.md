# Changelog

Was sich zwischen den Versionen von ABW Arcade geändert hat, die neueste oben.
Installation und Update stehen in der
[README](https://github.com/utmwzar/ABW-Arcade#readme).

## [1.1] – 21.10.2026

Neue Oberfläche, neues Schach, Touch-Steuerung, und ABW Arcade läuft jetzt als
Dienst unter Linux, macOS und Windows. Accounts, Scores und der Port bleiben
beim Update erhalten.

### Neu

- **Oberfläche im Stil einer Spielebibliothek.** Der Hub zeigt „Weiterspielen“,
  Kapseln mit Highscore und Platz, Zahlentasten 1–7, offene Schachpartien und
  „Zuletzt gespielt“ mit den eigenen Scores. Dazu kommen eine gemeinsame
  Kopfleiste, deutsche Fehlerseiten und Einstellungen für Bewegung,
  Touch-Steuerung, Schach und den Ton von DOOM.
- **Ergebniskarte am Spielende** mit dem vom Server nachgerechneten Score,
  „Gespeichert · Platz 3 von 9“ und bei einem neuen Highscore
  „Neuer Highscore · Platz 4 → 3“. Schlägt das Speichern fehl, heißt der Knopf
  „Erneut senden“.
- **Pause** mit P, Esc, per Knopf oder von selbst beim Fensterwechsel; ein
  Neustart fragt vorher nach. Wer mitten im Spiel beendet oder neu startet,
  bekommt genau den Score, der in diesem Moment stand.
- **Touch-Steuerung** auf Handy und Tablet: Tetris mit Tippen, Ziehen und
  Wischen, Snake mit Wischen, in Breakout folgt das Paddle dem Finger, 2048 mit
  Wischen, Geometry Dash mit Tippen und Halten. Jede Geste erzeugt dieselben
  Aktionen wie die Tasten; die Leaderboards bleiben fälschungssicher.
- **Effekte im Spielfeld**: Partikel, Blitze und Wackeln. Sie richten sich nach
  der Einstellung für Bewegung und lassen sich ganz abschalten.
- **Schach neu**: festes Brett mit gleitenden Figuren, Ziehen mit Maus oder
  Finger, Bedienung per Tastatur, Nachspielen jeder Partie, eine Ergebniskarte
  mit Elo-Änderung und ein Hinweis in der Lobby, wenn jemand einer selbst
  erstellten Partie beitritt.
- **Installation als Dienst unter macOS** (LaunchDaemon, Port 5050) und
  **Windows** (Windows-Dienst, Firewall-Regel, Start per `install.cmd`).
- **Zwei Pakete mit demselben Inhalt**: `abw-arcade.tar.gz` für Linux und macOS,
  `abw-arcade.zip` für Windows.

### Geändert

- Schriften und Schachfiguren liegen im Projekt; nichts lädt mehr von einem CDN.
- Spielfelder sind auf hochauflösenden Bildschirmen scharf und passen sich der
  Fensterhöhe an. Auf dem Handy ragt nichts mehr über den Rand.
- Die Texte sind einheitlich: Gaming-Begriffe wie Score, Leaderboard und Game
  Over englisch, alles andere deutsch, Schach deutsch.
- `run.py` ist auf allen Systemen der Startpunkt für den Dienst, für
  `run.py check` und für `run.py make-admin`.

### Behoben

- Schach: Zwei gleichzeitige Züge konnten sich überschreiben, der Bot hielt
  beim Rechnen bis zu vier Sekunden die Datenbank gesperrt, und eine Partie
  konnte zweimal gewertet werden.
- Wird dasselbe Spiel zweimal gleichzeitig gesendet, zählt der Score nur
  einmal.
- Schnelle Doppelkurven in Snake und kurzes Tippen in Geometry Dash gehen nicht
  mehr verloren.
- Die Meldung „Kein Zugriff“ erscheint wieder, und die Admin-Seite nennt den
  richtigen Befehl für neue Admins.
- Die Liste der FreeDoom-Mitwirkenden liegt jetzt bei. Der mitgelieferte
  Lizenztext verwies auf sie, sie fehlte aber.

### Betrieb und Umstieg von v1.0

- Das Update unter Linux geht wie bisher: neues Paket entpacken und
  `sudo ./install.sh` starten. Accounts, Scores, eigene WADs und der Port
  bleiben erhalten.
- Ein anderer Port wird als Schalter angegeben: `sudo ./install.sh --port 8080`.
  Die Form `PORT=8080 sudo ./install.sh` aus den Notizen zu v1.0 kam nie im
  Skript an, weil `sudo` Umgebungsvariablen verwirft.
- Port, Threads und Datenordner stehen jetzt in `arcade.conf` und überstehen
  jedes Update.
- Neue Admins werden mit `run.py make-admin BENUTZERNAME` ernannt; die Befehle
  je System stehen in der
  [README](https://github.com/utmwzar/ABW-Arcade#ersten-admin-ernennen).
  Der bisherige Befehl `flask --app app make-admin` funktioniert weiter.

## [1.0] – 25.08.2026

Erste Veröffentlichung: Tetris, Snake, Breakout, 2048, Geometry Dash, Schach mit
Elo und Bot sowie DOOM. Die Leaderboards sind durch Server-Replay
fälschungssicher. Installation als systemd-Dienst unter Debian und Ubuntu.

[1.1]: https://github.com/utmwzar/ABW-Arcade/compare/v1.0...v1.1
[1.0]: https://github.com/utmwzar/ABW-Arcade/releases/tag/v1.0
