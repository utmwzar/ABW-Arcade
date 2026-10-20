---
version: 1
slug: "templates-hub-html"
primary_target: "templates/hub.html"
related_targets: ["templates/base.html","templates/game.html","templates/chess_game.html"]
---

# Oberfläche: Spiele-Hub und Spielhülle (gilt für alle Seiten von ABW Arcade)

Modus: Operate (Spiel in Sekunden finden und starten). Spielseiten und Schach erben diese Welt.

Publikum und Aufgabe: Kollegen der Ausbildungswerkstatt Wittmund in der Pause, meist am Desktop.
Sie wollen sehen, wo sie stehen, ein Spiel mit einem Klick oder einer Zahlentaste starten und
am Ende wissen, ob ihr Score zählt.

Gewählte Richtung: C, klassische Arcade (vom Nutzer gewählt, der sichere Weg), ohne Ironie und
ohne versteckte Eigenheiten. Messlatte für die Verarbeitung: die Steam-Bibliothek.

## Direction contract

THESIS: ABW Arcade ist eine dunkle Spielebibliothek. Die Spiele sind das Licht im Raum, alles
andere tritt zurück. Jedes Spiel hat eine kräftige Kapsel, die Hülle bleibt ruhig violett-schwarz.
Der eine laute Moment ist das Ende eines Runs, wenn das vom Server nachgerechnete Ergebnis kommt.
Abgelehnt wird der Synthwave-Standard: Verlaufsschrift, Glow-Ränder, Scanlines überall,
Pixelschrift in 8 px.

OWN-WORLD: Grund Nachtviolett #110D20, Flächen #181331 und #1E1838, Haarlinien #2E2752; Text
#EEEAFE, Nebentext #A59DCB (mindestens 4,5:1). Ein Akzent für Aktionen und Fokus: Cyan #2CCFE3.
Jedes Spiel behält seine Kapselfarbe aus seiner Vorschau-Grafik (Tetris Cyan, Snake Grün,
Breakout Pink, 2048 Gold, Geometry Dash Blau, Schach Violett, DOOM Rot), nur in der Kapsel und als
Akzent seiner Seite. Zustandsfarben: Grün gespeichert, Gold Highscore, Rot Game Over. Schrift:
Press Start 2P nur für Wortmarke und Seitentitel auf ihrem 8-px-Raster (16/24/32 px), sonst
Archivo mit Tabellenziffern. Ecken 10–12 px, weiche versetzte Schatten, kein Verlauf auf Text,
kein Glow.

STORY: Ein Kollege öffnet in der Pause den Hub, sieht seinen Stand und ob eine Schachpartie auf
ihn wartet, startet mit einem Klick oder einer Zahlentaste, spielt und liest am Ende das
nachgerechnete Ergebnis: gespeichert, neuer Highscore, Platz. Dann nochmal oder zurück.

FIRST VIEWPORT: Hub bei 1440 × 900. Kopfleiste 64 px: Wortmarke links, Navigation Spiele, Schach,
Admin; rechts Name, Einstellungen, Abmelden. Darunter Titel „Spiele“ (Press Start 2P 24 px) mit
einer Zeile Untertitel. Links die Bibliothek: oben „Weiterspielen“ als doppelt breite Kapsel des
zuletzt gespielten Spiels (Grafik, Titel, dein Highscore, Platz, Spielen mit Enter), darunter die
übrigen Spiele als Kapselraster mit Grafik 16:9, Titel, einer Zeile Ziel, Highscore und Platz,
Zahlentaste. Rechts eine 320 px breite Spalte: Schach (du bist dran, offene Partien) und
„Zuletzt gespielt“ mit den eigenen, vom Server geprüften Scores. Bewusst keine Aktivität anderer
Spieler: Am Arbeitsplatz soll niemand sehen, wann Kollegen spielen. Hauptaktion sind die Kapseln. Signatur-Interaktion: die
Ergebniskarte am Spielende zählt den Score hoch, zeigt „Platz 7 → 5“ und den Hinweis „Vom Server
nachgerechnet“. Bewegung: Overlays federn in 320 ms herein, verschwinden in 200 ms; Kapseln heben
sich beim Zeigen um 2 px; bei reduzierter Bewegung nur Einblenden.

FORM: Kanon (die Standard-Kategorie, geradeaus umgesetzt; vom Nutzer statt der ausgelosten
Richtung gewählt). seed:0bc57e059fe1dd9b

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Entscheidungen beim Bau

- Schachbrett (entschieden in Phase 3): Lavendel, helle Felder #C9BFE8, dunkle #8B7FC0. Schwarze
  Chessnut-Figuren stehen auf dunklen Feldern mit 5,9 : 1 (das braune lichess-Brett hat 6,7 : 1);
  das dunkle Brett der Skizze lag bei 1,4 : 1 und schied deshalb aus.
- Overlay-Titel (BEREIT?, PAUSE, GAME OVER) stehen in Press Start 2P 16 px wie ein Bildschirmtitel;
  laut ist am Spielende die Zahl, nicht der Titel.
