# Gestaltung und Texte

Diese Seite beschreibt, wie die Oberfläche von ABW Arcade aufgebaut ist. Sie gilt für alle
Änderungen in `templates/` und `static/`. Die Werte selbst stehen im Code: Farben, Schrift,
Abstände und Bewegung in `static/css/tokens.css`, die Bewegungsbausteine in `static/js/fx.js`
und die gespeicherten Einstellungen in `static/js/prefs.js`.

## Grundsätze

- Die Oberfläche ist dunkel und zurückhaltend. Kräftige Farben kommen nur aus den Spielen,
  also aus den Kapselgrafiken der Spieleübersicht und den Spielfeldern.
- Es gibt einen Akzent, Cyan. Er kennzeichnet alles, was man anklicken, auswählen oder
  fokussieren kann.
- Zustandsfarben haben eine feste Bedeutung: Grün für gespeichert und gewonnen, Gold für
  Highscores, Rot für Gefahr, Verlust und Fehler.
- Jede Ansicht hat höchstens einen gefüllten Knopf.
- Bewegung ist kurz und zeigt einen Zustand an. Die Einstellung für reduzierte Bewegung gilt
  überall.
- Oberfläche und Effekte lesen den Zustand der Spiele-Engines nur. Sie ändern ihn nie, weil der
  Server jede Partie mit denselben Engines nachrechnet.

## Farben

| Token | Wert | Verwendung |
|---|---|---|
| `--playfield` | `#0a0816` | Grund der Spielfelder und Kapselgrafiken |
| `--bg` | `#110d20` | Seitengrund, Eingabefelder |
| `--bg-raised` | `#181331` | Kopfleiste, aufgeklapptes Menü |
| `--surface` | `#1e1838` | Panels, Kapseln, Karten, Dialoge |
| `--surface-2` | `#261f45` | sekundäre Knöpfe, Tastenkappen, Gesten-Hinweise, Kurzmeldungen |
| `--line` | `#2e2752` | Ränder von Flächen, Trennlinien |
| `--line-strong` | `#43396f` | Ränder von Bedienelementen |
| `--text` | `#eeeafe` | Text |
| `--text-muted` | `#a59dcb` | Nebentext, Labels, Platzhalter |
| `--accent` | `#2ccfe3` | Aktionen, Auswahl, Fokus, eigene Zeile |
| `--ok` | `#4ad08a` | gespeichert, gewonnen |
| `--gold` | `#f7c04a` | Highscores |
| `--danger` | `#f0606b` | Gefahr, Verlust, Fehler |
| `--danger-text` | `#ff9aa2` | Fehler- und Niederlagentext auf dunklem Grund |

Zu jeder Zustandsfarbe gibt es einen Schleier mit 14 % Deckkraft (`--accent-soft`,
`--ok-soft`, `--gold-soft`, `--danger-soft`). Er dient als Hintergrund für Meldungen, Tags und
markierte Zeilen.

Gold steht nur an Highscores: in Kapsel und Werte-Panel, unter dem Leaderboard, am Tag
„Highscore“, an der Rangziffer von Platz 1 und an der Ergebniszahl, sobald der Server einen
neuen Highscore bestätigt hat. Elo, Lines, Level und alle anderen Werte stehen in Textfarbe.

Die Spielfarben (`--game-*`) erscheinen nur in der Kapsel, im kleinen Farbquadrat vor dem
Spielnamen und im Spielfeld. Text, Werte und Bedienelemente der Oberfläche tragen sie nicht.
Im Spielfeld gelten die Farben des Spiels, dort darf auch Gold vorkommen, etwa in 2048 oder
beim O-Stein in Tetris. Das Schachbrett hat eigene Werte in `static/css/chess.css`
(`--board-light`, `--board-dark`, `--board-ink`).

Schatten sind schwarz, weich und nach unten versetzt. Glow und Verlaufsschrift kommen nicht
vor. Text und Nebentext haben auf allen Flächen einen Kontrast von mehr als 4,5 : 1.

## Schrift

Archivo (variabel, Gewicht 100 bis 900) trägt alles, was gelesen wird. Ziffern stehen als
Tabellenziffern, damit Scores in Spalten untereinander stehen und beim Hochzählen nicht
springen. Die Gewichte haben feste Aufgaben: 400 für Text, 600 für Navigation und Labels, 700
für Titel und Knöpfe, 800 für Werte.

Press Start 2P steht nur in 16, 24 oder 32 px (`--pixel-sm`, `--pixel-md`, `--pixel-lg`), also
auf dem Raster der Schrift. Sie ist der Wortmarke, den Seitentiteln, den Overlay-Titeln und
Texten im Spielfeld vorbehalten. Fließtext, Knöpfe, Labels und Werte stehen in Archivo.

Beide Schriften liegen mit ihren Lizenzen (SIL Open Font License) in `static/fonts/`. Die
Seite lädt keine Schriften von fremden Servern.

## Abstände und Formen

Abstände folgen einem 4-px-Raster (`--s-1` bis `--s-12`), Seiten sind höchstens 1320 px breit
(`--page-max`). Ecken sind in drei Stufen gerundet: 12 px für Flächen wie Panels, Kapseln,
Karten, Dialoge und das Spielfeld, 10 px für Bedienelemente und 6 px für Kleines wie Tags,
Tastenkappen, kleine Knöpfe und das Schachbrett. Der Fokus ist ein 2 px breiter Ring in Cyan
mit 2 px Abstand.

Das Spielfeld passt in die Fensterhöhe, sodass die Seite beim Spielen nicht scrollt. Auf
Geräten ohne Hover entfallen Tastenhinweise und Zahlentasten. Auf Touchscreens zeigen die
Hinweise Gesten statt Tasten; das lässt sich in den Einstellungen unter „Touch-Steuerung“
ändern.

## Bausteine

- **Knöpfe:** gefüllt in Cyan für die Hauptaktion, sekundär für Nebenaktionen, transparent in
  der Kopfleiste und rot umrandet für Aufgeben und Löschen. Gefülltes Rot gibt es nur für
  „Bestätigen“ im Rückfrage-Dialog. Welcher Knopf einer Ansicht gefüllt ist, hängt vom Zustand
  ab: In der Schach-Lobby ist es „Zum Brett“ bei der ersten Partie, in der der Spieler am Zug
  ist, sonst „Bot-Partie starten“. Kurzmeldungen zeigen ihre Aktion gefüllt, weil sie nur kurz
  über der Ansicht liegen.
- **Kapseln in der Spieleübersicht:** oben eine Grafik im Format 16 : 9 auf `--playfield`,
  darunter eine 3 px hohe Kante in der Spielfarbe, dann Titel, Ziel, Highscore mit Platz und
  die Zahlentaste. Die ganze Kapsel ist ein Link. Über den anderen steht eine doppelt breite
  Kapsel, unter „Weiterspielen“ mit dem zuletzt gespielten Spiel oder, wenn noch keine Partie
  gespeichert ist, unter „Zum Einstieg“.
- **Overlay und Ergebniskarte:** Über dem Spielfeld liegt ein dunkler Schleier, darauf eine
  Karte von höchstens 360 px Breite. Am Spielende zählt der Score hoch, und darunter steht, was
  der Server meldet, etwa „Gespeichert · Platz 3 von 9“. Bestätigt der Server einen neuen
  Highscore, wird die Zahl golden und die Zeile „Neuer Highscore“ erscheint. Scheitert das
  Speichern, heißt die Hauptaktion „Erneut senden“.
- **Leaderboard und Tabellen:** keine Zebrastreifen. Die eigene Zeile liegt auf dem
  Cyan-Schleier.
- **Schachbrett:** Der letzte Zug ist cyan unterlegt, das gewählte Feld hat zusätzlich einen
  Ring in Cyan. Steht ein König im Schach, bekommt sein Feld einen roten Ring von 3 px, und die
  Statuszeile sagt es in Worten. Rot gefüllt wird nur das Feld eines mattgesetzten Königs.

## Bewegung

| Token (CSS / `fx.DUR`) | Wert | Verwendung |
|---|---|---|
| `--dur-short` / `DUR.short` | 120 ms | Farbwechsel und Hover |
| `--dur-base` / `DUR.base` | 200 ms | Wege wie Schachzüge, jedes Ausblenden |
| `--dur-long` / `DUR.long` | 320 ms | alles, was hereinkommt: Overlay, Ergebniskarte, Kurzmeldung |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Hereinkommendes und Wege |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Ausblenden |

Bewegung entsteht ohne Framework mit der Web Animations API und CSS-Transitions. Vier Module
teilen sich die Arbeit:

- `static/js/fx.js` bewegt Elemente der Seite, etwa Overlays, Zahlen und Schachfiguren.
- `static/js/fx-canvas.js` zeichnet Effekte im Spielfeld: Partikel, Blitze, Wackeln und kurze
  Texte.
- `static/js/observe/<spiel>.js` vergleicht den Zustand vor und nach einem Spielschritt und
  meldet daraus Ereignisse wie abgeräumte Reihen oder Treffer.
- `static/js/canvas.js` passt die Auflösung der Spielfelder an hochauflösende Bildschirme an.

Für alle Effekte gelten diese Regeln:

1. Effekte lesen die Engines nur. Sie rufen weder `engine.rng()` noch ändernde Methoden wie
   `applyAction`, `gravityStep` oder `tick` auf und sortieren keine Arrays der Engine. Zufall
   in Effekten kommt aus `Math.random`. Ein zusätzlicher Aufruf des Engine-Zufalls würde den
   Spielverlauf ändern, und der Server käme beim Nachrechnen auf einen anderen Score.
2. Effekte haben eine eigene Uhr, das `dt` von `requestAnimationFrame`. Tick-Zähler und
   Eingabepuffer der Spiele bleiben unberührt.
3. Animiert werden nur `transform` und `opacity`. Im Spielfeld wackelt das Bild über
   `ctx.translate`, nicht über CSS am Element, damit die Koordinaten für Touch stimmen.
4. Bewegung blockiert nie eine Eingabe. Eine neue Eingabe beendet die laufende Animation.
5. `fx.motion()` liefert `full`, `reduced` oder `off`. Grundlage ist die Einstellung „Bewegung“
   und bei „Wie System“ die Systemeinstellung `prefers-reduced-motion`. Bei `reduced` wird nur
   ein- und ausgeblendet, ohne Wackeln und mit weniger Partikeln, bei `off` gibt es keine
   Animation. Weil CSS-Regeln für reduzierte Bewegung keine Web Animations erfassen, fragt
   jede Funktion in `fx.js` die Einstellung selbst ab.
6. Lichtblitze kommen höchstens dreimal pro Sekunde und sind nie vollflächig weiß.

Die Tests in `tests/js/fx.test.mjs`, `fx-canvas.test.mjs` und `observe.test.mjs` prüfen diese
Regeln. Der Test der Beobachter spielt jedes Spiel einmal mit und einmal ohne Beobachter; der
Zustand der Engine muss am Ende gleich sein.

## Gespeicherte Einstellungen

Alles, was die Seite im Browser speichert, läuft über `static/js/prefs.js`. Gespeichert werden
nur Komfort-Einstellungen: Bewegung, Touch-Steuerung, Optionen fürs Schachbrett, die zuletzt
gewählte Stärke und Farbe gegen den Bot, der Ton in DOOM und welche Hilfen schon gesehen wurden.
Sitzungen, Passwörter, Tokens, Scores, Eingabeprotokolle, Spiel-IDs, Seeds und persönliche
Daten gehören nie in den Browser-Speicher, ebenso wenig Daten, die mehrere Personen sehen
sollen. Sie liegen auf dem Server.

Jeder Schlüssel folgt dem Muster `abw.v1.<bereich>.<name>` und steht mit Standardwert und
erlaubten Werten in `SCHEMA` in `prefs.js`. Eine neue Einstellung braucht nur einen Eintrag
dort. Ändert sich die Bedeutung eines Werts, bekommt er einen neuen Schlüssel mit `v2`.

Jeder Zugriff steckt in `try/catch`. Ist kein Speicher nutzbar, etwa in einem privaten Fenster
oder bei gesperrten Website-Daten, arbeitet das Modul im Arbeitsspeicher weiter. Ungültige
oder beschädigte Werte ergeben den Standardwert. Über das `storage`-Ereignis bleiben mehrere
offene Tabs auf demselben Stand.

Bewegung und Touch-Steuerung wirken schon auf das erste Bild. Deshalb liest ein kleines Skript
im `<head>` von `templates/base.html` diese beiden Werte direkt und setzt sie als
`data-motion` und `data-touch` am `<html>`-Element. Das ist der einzige Zugriff auf den
Browser-Speicher außerhalb von `prefs.js`.

`tests/js/prefs.test.mjs` prüft das Modul, auch mit ungültigen Werten, gesperrtem und vollem
Speicher.

## Texte und Begriffe

Die Oberfläche ist deutsch und spricht Spieler mit „du“ an. Zahlen stehen im deutschen Format
(12.345). Der Ton ist freundlich und sachlich.

Begriffe aus Spielen bleiben englisch und heißen überall gleich:

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

Ein Sieg in den Arcade-Spielen heißt „Geschafft!“. Eine Schachpartie endet mit „Du hast
gewonnen“, „Du hast verloren“ oder „Remis“.

Schachbegriffe und Bedienelemente sind deutsch, zum Beispiel Partie, Zug, Schachmatt, Patt,
Aufgeben, Weiß und Schwarz oder Anmelden, Benutzername, Einstellungen, Nochmal und Abbrechen.
Gesten heißen Tippen, Halten, Ziehen und Wischen. Spielnamen bleiben im Original (Tetris,
Snake, Breakout, 2048, Geometry Dash, DOOM), nur Schach ist deutsch. Die Karte am Spielende
heißt Ergebniskarte.
