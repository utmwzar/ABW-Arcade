# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Kolleginnen und Kollegen der Ausbildungswerkstatt Wittmund (ABW). Sie spielen in kurzen
Pausen, meist am Desktop-PC mit Tastatur und Maus im Firmennetz. Das Handy ist zweitrangig,
muss aber sauber funktionieren. Jede Person hat einen eigenen Account.

## Product Purpose

ABW Arcade ist eine selbst gehostete Spiele-Website für die Pause:

- ein Account für alle Spiele;
- sieben Spiele: Tetris, Snake, Breakout, 2048, Geometry Dash, Schach und DOOM;
- ein Leaderboard je Spiel;
- Schach gegeneinander mit Elo-Wertung oder gegen einen Bot.

Erfolg heißt: Man ist in Sekunden im Spiel und versteht ohne Anleitung, was zu tun ist. Dem
Leaderboard kann man vertrauen.

## Positioning

Die Leaderboards sind fälschungssicher. Der Browser schickt nie einen Score, sondern nur
Seed, Spiel-ID und das Protokoll der Eingaben. Der Server spielt die Partie mit derselben
deterministischen Engine nach und rechnet den Score selbst aus. Beim Schach prüft der Server
jeden einzelnen Zug.

DOOM läuft komplett im Browser und hat deshalb bewusst kein Leaderboard.

## Operating Context

- Die Seite läuft im LAN der Ausbildungswerkstatt, ohne externe Dienste, CDN oder Tracking.
- Betrieben wird sie als Dienst unter Linux (systemd), macOS (LaunchDaemon) oder Windows
  (Windows-Dienst). Den ersten Admin ernennt man auf dem Server per Kommandozeile.
- Die Sitzungen sind kurz und liegen zwischen Arbeitsphasen. Mehrere Leute spielen gleichzeitig
  und vergleichen sich über das Leaderboard.

## Capabilities and Constraints

- Technik: Flask, SQLite, waitress und Jinja-Templates. Im Browser läuft reines JavaScript ohne
  Build-Schritt und ohne React.
- Die Engines (`*_engine.py` und `static/*_engine.js`) müssen paarweise gleich rechnen. Arbeit an
  der Oberfläche verändert sie nicht; `node pruefe-engines.js` muss grün bleiben.
- Bewusst nicht enthalten: Sound, Werbung, Tracking und Social-Login.

### Sprache und Glossar

- Die Oberfläche ist deutsch, die Anrede ist „du“. Zahlen stehen im deutschen Format (12.345).
- **Gaming-Begriffe sind englisch, und zwar überall gleich:**

  | Begriff | Bedeutung |
  |---|---|
  | Score | Punkte einer Partie |
  | Highscore | persönlicher Bestwert |
  | Leaderboard | Bestenliste |
  | Level | Spielstufe |
  | Lines | abgeräumte Reihen (Tetris) |
  | Next | nächster Stein (Tetris) |
  | Lives | Leben (Breakout) |
  | Length | Länge (Snake) |
  | Best Tile | höchste Kachel (2048) |
  | Distance | Distanz (Geometry Dash) |
  | Run | ein Durchgang in Geometry Dash |
  | Game Over | Spielende durch Niederlage |
  | Pause | angehaltenes Spiel |

- **Für Siege gibt es genau einen Titel:** „Geschafft!“. GEWONNEN!, DURCHGESPIELT! und andere
  Varianten werden nicht mehr verwendet.
- **Schachbegriffe sind deutsch:** Partie, Zug, Schach, Schachmatt, Patt, Remis, Remis anbieten,
  Aufgeben, Weiß, Schwarz, Bauer, Springer, Läufer, Turm, Dame, König, Elo, Lobby.
- **Bedienelemente sind deutsch:** Anmelden, Abmelden, Registrieren, Benutzername, Passwort,
  Einstellungen, Spiele, Spiel starten, Nochmal, Weiter, Abbrechen.
- **Spielnamen bleiben im Original:** Tetris, Snake, Breakout, 2048, Geometry Dash, DOOM. Nur
  „Schach“ ist deutsch.

## Brand Commitments

- Verbindlich ist der Name **„ABW Arcade“**. ABW steht für die Ausbildungswerkstatt Wittmund.
  Es gibt keine Firmenfarben und kein Logo.
- **Look (vom Nutzer gewählt, Oktober 2026):** klassische Arcade – dunkel, ein Neon-Akzent,
  Pixelschrift nur groß –, geradeaus und sauber umgesetzt. Die Verarbeitung soll neben der
  Steam-Bibliothek bestehen können.
- Ton: freundlich und klar, nicht albern.

## Evidence on Hand

- Die sieben vorhandenen Spiele und ihre Engines liegen im Repo. DOOM nutzt Chocolate Doom (GPL)
  mit den FreeDoom-Daten (BSD); beides liegt unter `static/doom/`.
- Es gibt keine Nutzerzahlen, Zitate oder Auszeichnungen. Nichts davon darf erfunden werden.

## Product Principles

1. **In Sekunden im Spiel.** Kein Weg zu einem Spiel ist länger als zwei Klicks. Ziel und
   Steuerung stehen dort, wo man sie braucht.
2. **Ehrliche Zahlen.** Was im Leaderboard steht, hat der Server nachgerechnet. Die Oberfläche
   sagt nach jeder Partie klar, ob der Score gespeichert wurde.
3. **Pausentauglich.** Jedes Spiel lässt sich jederzeit anhalten oder abbrechen. Nichts
   blockiert, und alles funktioniert offline im LAN.
4. **Passend für den Arbeitsplatz.** Keine Töne, kein Tracking, nichts Schrilles.
