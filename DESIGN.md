---
name: ABW Arcade
description: Dunkle Spielebibliothek für die Pause – die Hülle bleibt ruhig violett-schwarz, die Spiele bringen die Farbe.
colors:
  bg: "#110d20"
  bg-raised: "#181331"
  surface: "#1e1838"
  surface-2: "#261f45"
  line: "#2e2752"
  line-strong: "#43396f"
  text: "#eeeafe"
  text-muted: "#a59dcb"
  accent: "#2ccfe3"
  accent-hover: "#63e0ef"
  accent-ink: "#06121a"
  accent-soft: "rgb(44 207 227 / 0.14)"
  ok: "#4ad08a"
  ok-soft: "rgb(74 208 138 / 0.14)"
  gold: "#f7c04a"
  danger: "#f0606b"
  danger-soft: "rgb(240 96 107 / 0.14)"
  game-tetris: "#2ccfe3"
  game-snake: "#4ad08a"
  game-breakout: "#f06bb2"
  game-2048: "#f7c04a"
  game-geometry-dash: "#6c8cff"
  game-chess: "#a98bfa"
  game-doom: "#f0606b"
  board-light: "#c9bfe8"
  board-dark: "#8b7fc0"
typography:
  display:
    fontFamily: '"Press Start 2P", "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0"
  screen-title:
    fontFamily: '"Press Start 2P", "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  score:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "3.5rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: '"tnum"'
  stat-lg:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1
    fontFeature: '"tnum"'
  stat:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1.1
    fontFeature: '"tnum"'
  headline:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: '"tnum"'
  body-sm:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
  button:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.1
  label:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 600
  label-strong:
    fontFamily: '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1
rounded:
  sm: "6px"
  md: "10px"
  lg: "12px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "20px"
  s-6: "24px"
  s-8: "32px"
  s-12: "48px"
  gutter: "max(clamp(16px, 3vw, 40px), env(safe-area-inset-left, 0px))"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-ink}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "42px"
  button-secondary-hover:
    backgroundColor: "#2f2754"
    textColor: "{colors.text}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "42px"
  button-ghost-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "42px"
  button-danger-hover:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
  button-sm:
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "34px"
  button-lg:
    padding: "0 24px"
    height: "50px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "20px"
  capsule:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  capsule-wide:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "24px"
  overlay-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "24px"
    width: "360px"
  tag-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  tag-highscore:
    backgroundColor: "rgb(247 192 74 / 0.14)"
    textColor: "{colors.gold}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  key-cap:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "26px"
  gesture-pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "26px"
  leaderboard-row:
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    height: "36px"
  leaderboard-row-me:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  segmented:
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "4px"
  segmented-option-selected:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px"
  topbar:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.text}"
    height: "64px"
  nav-link:
    textColor: "{colors.text-muted}"
  nav-link-active:
    textColor: "{colors.text}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    width: "460px"
  toast:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  chess-square-light:
    backgroundColor: "{colors.board-light}"
  chess-square-dark:
    backgroundColor: "{colors.board-dark}"
---

# Design System: ABW Arcade

## Overview

**Creative North Star: "Die dunkle Spielebibliothek"**

ABW Arcade ist eine dunkle Spielebibliothek. Die Spiele sind das Licht im Raum, alles andere tritt zurück: Kopfleiste, Panels, Listen und Knöpfe liegen in einem ruhigen Nachtviolett und sprechen mit genau einem Akzent, Cyan, für alles, was man anklicken, auswählen oder fokussieren kann. Kräftige Farbe gehört den Spielen. Jedes hat eine Kapsel mit eigener Grafik in seiner Farbe, und sein Spielfeld leuchtet in seiner Palette auf einem Schwarz, das noch tiefer liegt als der Raum. Die Messlatte für die Verarbeitung ist die Steam-Bibliothek: klare Kapseln, ruhige Flächen, saubere Kanten.

Die Dichte ist die einer Bibliothek, nicht die einer Startseite. Der Hub zeigt alle Spiele, den eigenen Stand und die offenen Schachpartien auf einen Blick; jede Spielseite bringt Werte, Spielfeld und Leaderboard in einer Fensterhöhe unter. Pixelschrift ist Signatur, nicht Textur: Press Start 2P steht nur groß und auf ihrem 8-px-Raster, für Wortmarke und Titel. Alles, was man lesen muss, steht in Archivo mit Tabellenziffern.

Bewegung ist kurz und zeigt Zustand: 120 ms für Farbe und Hover, 200 ms für Wege und jedes Ausblenden, 320 ms für Hereinkommendes; Overlays federn. Laut ist nur das Ende eines Runs: Die Ergebniskarte federt über das Spielfeld, der Score zählt hoch, der Server bestätigt, und ein neuer Highscore wird golden. Bei reduzierter Bewegung bleibt nur das Ein- und Ausblenden. Abgelehnt ist der Synthwave-Standard: Verlaufsschrift, Glow-Ränder, Scanlines überall, Pixelschrift in 8 px.

**Key Characteristics:**
- Tonal geschichtetes Nachtviolett mit Haarlinien; kräftige Farbe nur in Kapseln und Spielfeldern.
- Ein Akzent: Cyan für Aktion, Auswahl, Fokus und alles, was dich meint.
- Zustandsfarben mit fester Bedeutung: Grün gespeichert, Gold Highscore, Rot Verlust und Fehler.
- Press Start 2P nur in 16, 24 und 32 px; sonst Archivo mit Tabellenziffern, Werte in 800.
- Ecken von 6 bis 12 px, schwarze, weich nach unten versetzte Schatten, kein Glow, kein Verlauf auf Text.
- Ein lauter Moment: die Ergebniskarte am Ende eines Runs.

## Colors

Ein Nachtviolett in vier Stufen trägt die Oberfläche, Cyan ist der einzige Akzent, und Zustands- und Spielfarben haben je genau eine Aufgabe.

### Primary
- **Arcade-Cyan** (#2ccfe3): der einzige Akzent der Hülle. Gefüllte Knöpfe, Links, Fokusringe, die aktive Navigation, Auswahl, „Du bist am Zug“, das Initial im Avatar und „ARCADE“ in der Wortmarke. Auf jeder Fläche über 8 : 1.
- **Helles Cyan** (#63e0ef): Hover von gefüllten Knöpfen und Links.
- **Cyan-Tinte** (#06121a): Schrift auf Cyan (10 : 1), auch in der Textauswahl.
- **Cyan-Schleier** (rgb(44 207 227 / 0.14)): Grund der eigenen Zeile in Leaderboard und Rangliste, der Tags „Du bist am Zug“ und „am Zug“, des aktuellen Zugs in der Zugliste und des Hinweises beim Nachspielen.

### State Colors
- **Gespeichert-Grün** (#4ad08a): bestätigt. „Gespeichert“ auf der Ergebniskarte, Erfolgsmeldungen, das Schild bei „Jeder Score ist vom Server nachgerechnet“; im Schach Sieg und Elo-Gewinn. Sein Schleier (rgb(74 208 138 / 0.14)) trägt Erfolgsmeldungen.
- **Highscore-Gold** (#f7c04a): der Highscore, sonst nichts (siehe The Gold-Is-Highscore Rule).
- **Signalrot** (#f0606b): Verlust und Fehler. Der rote Blitz im Spielfeld bei Leben-Verlust und Game Over, das Matt-Feld, „Aufgeben“ und Löschen. Sein Schleier (rgb(240 96 107 / 0.14)) trägt Fehlermeldungen und den Hover roter Knöpfe. Fehler- und Niederlagentext auf dunklem Grund steht in einem helleren Rot (#ff9aa2, 8,4 : 1, kein eigener Token): „Nicht gespeichert“, „Niederlage“, Elo-Verlust, Fehler in der Lobby. Der Titel GAME OVER bleibt in Textfarbe; der Richtungsvertrag nannte Rot für Game Over, gebaut ist Rot dort als Blitz im Spielfeld.

### Game Colors
Jedes Spiel behält die Farbe seiner Vorschau-Grafik: **Tetris-Cyan** (#2ccfe3), **Snake-Grün** (#4ad08a), **Breakout-Pink** (#f06bb2), **2048-Gold** (#f7c04a), **Geometry-Dash-Blau** (#6c8cff), **Schach-Violett** (#a98bfa), **DOOM-Rot** (#f0606b).
- **Wo sie stehen:** in der Kapsel (Grafik auf 13 % Spielfarbe über Spielfeld-Schwarz, 3-px-Kante unter der Grafik, beim Zeigen ein Rahmen aus 55 % Spielfarbe), als 8-px-Quadrat vor dem Spielnamen in „Zuletzt gespielt“ und im Spielfeld. Auf der eigenen Seite zeigt nur DOOM seine Farbe, im Ladebalken. Der Richtungsvertrag sah die Spielfarbe als Akzent der ganzen Spielseite vor; gebaut bleibt dort alles Bedienbare cyan.
- **Gleiche Werte:** Tetris, Snake, 2048 und DOOM teilen ihren Wert mit dem Akzent oder einer Zustandsfarbe. Sie geraten nicht aneinander, weil eine Spielfarbe nie Text, Wert oder Bedienelement färbt.
- **Lavendelbrett** (hell #c9bfe8, dunkel #8b7fc0): die Felder des Schachbretts. Schwarze Figuren stehen auf dunklen Feldern mit 5,9 : 1.

### Neutral
- **Nachtviolett** (#110d20): Grund der Seite, Eingabefelder, Spur des Segmentschalters.
- **Erhöhtes Nachtviolett** (#181331): Kopfleiste, aufgeklapptes Menü, Reiterleiste im Admin; auch die Browserfarbe (theme-color).
- **Kapselviolett** (#1e1838): Panels, Kapseln, Overlay-Karte, Dialoge, Anmeldekarte.
- **Tastenviolett** (#261f45): sekundäre Knöpfe, Tastenkappen, Gesten-Pillen, Avatar, gewähltes Segment, Kurzmeldungen.
- **Haarlinie** (#2e2752): Rand von Panels und Kapseln, Trennlinien in Listen und Tabellen.
- **Kantenviolett** (#43396f): Kante alles Bedienbaren (Eingabefelder, sekundäre Knöpfe, Tastenkappen, Overlay-Karte, Dialoge), Tabellenköpfe, Scrollbalken.
- **Lavendelweiß** (#eeeafe): Text, auf jeder Fläche mindestens 13 : 1.
- **Nebel-Lavendel** (#a59dcb): Nebentext, Labels, inaktive Navigation, Platzhalter; auf jeder Fläche mindestens 6 : 1.
- **Spielfeld-Schwarz** (#0a0816, kein eigener Token): Grund jedes Spielfelds und jeder Kapselgrafik, eine Stufe unter dem Seitengrund.

### Named Rules
**The One-Accent Rule.** Cyan ist der einzige Akzent der Hülle: Aktion, Auswahl, Fokus und alles, was dich meint (deine Zeile, dein Zug, dein Initial). Auch auf einer Spielseite sind Knöpfe, Links und Fokusringe cyan, nie in der Spielfarbe.

**The Gold-Is-Highscore Rule.** Gold heißt Highscore und nichts anderes. Golden sind dein Highscore in Kapsel und Werte-Panel, unter dem Leaderboard und als Tag in „Zuletzt gespielt“, die Rangziffer von Platz 1 und die Ergebniszahl, diese erst, wenn der Server den neuen Highscore bestätigt hat. Elo, Lines, Level und alle anderen Werte stehen in Textfarbe.

**The Games-Are-The-Light Rule.** Kräftige Farbe kommt aus den Spielen: Kapselgrafik, Kapselkante, Spielmarke und Spielfeld. Die Hülle bleibt in den Neutralen; eine Spielfarbe färbt nie Text, Wert oder Bedienelement.

## Typography

**Display Font:** Press Start 2P (mit Archivo, dann system-ui als Rückfall)
**Body Font:** Archivo, variabel mit Gewicht 100–900 und Breite 62–125 % (mit system-ui, -apple-system, Segoe UI, Roboto)
**Label/Mono Font:** keine eigene; Tasten, Labels und Zahlen stehen in Archivo.

Beide Schriften liegen lokal im Projekt (OFL), es gibt keinen Schriftdienst von außen.

**Character:** Eine Pixelschrift aus der Spielhalle als Signatur, gesetzt wie ein Bildschirmtitel, neben einer kräftigen Grotesk, die Ziffern gleich breit setzt und in 800 laut werden kann. Die Pixelschrift setzt den Ton, Archivo trägt die Information.

### Hierarchy
- **Display** (Press Start 2P 400, 24 px, 1,3): Seitentitel („Spiele“, „Schach“, „Admin“) und der Spielname auf der Spielseite; die Wortmarke auf der Anmeldekarte.
- **Screen Title** (Press Start 2P 400, 16 px, 1,4): Overlay-Titel (BEREIT?, PAUSE, GAME OVER, GESCHAFFT!, NEUES SPIEL?, DU HAST GEWONNEN), die Wortmarke in der Kopfleiste (Zeilenhöhe 1) und Texte im Spielfeld („LEVEL 2“; „TETRIS“ in 24 px). Die dritte Rasterstufe, 32 px, trägt bisher nur den Code der Fehlerseite.
- **Score** (Archivo 800, 3,5 rem = 56 px, 1, −0,01 em): die Ergebniszahl am Spielende; in der flachen Karte von Geometry Dash 2,75 rem.
- **Stat Large** (Archivo 800, 2,5 rem = 40 px, 1): der Hauptwert im Werte-Panel (Score, Distance), der Highscore in „Weiterspielen“, deine Elo in Lobby und Endkarte. Auf dem Handy wird der Hauptwert 28 px.
- **Stat** (Archivo 800, 22 px, 1,1): Werte in Panels und Kapseln (Lines, Level, Highscore). Kennzahlen im Admin stehen in 28 px.
- **Headline** (Archivo 700, 22 px, 1,25): Abschnittstitel („Weiterspielen“, „Weitere Spiele“) und Dialogtitel; der Titel der Kapsel „Weiterspielen“ in 28 px.
- **Title** (Archivo 700, 18 px, 1,3): Panel- und Kapseltitel, die Statuszeile im Schach.
- **Body** (Archivo 400, 16 px, 1,5): Fließtext. Untertitel laufen höchstens 70ch, das Ziel in der Kapsel „Weiterspielen“ 40ch.
- **Body Small** (Archivo 400, 14 px): Spielziel in der Kapsel, Tabellen, Zeilen im eigenen Stand, Statuszeilen der Ergebniskarte, Steuerungslisten.
- **Label** (Archivo 600, 13 px): Labels über Werten („Highscore“, „Score“, „Lines“); Formular-Labels in 14 px.
- **Label Strong** (Archivo 700, 13 px, 1): Tastenkappen, Gesten-Pillen, Tags und der Tastenhinweis im Knopf.
- **Button** (Archivo 700, 16 px, 1,1): Knöpfe; klein 14 px, groß 18 px.

Die Gewichte haben Aufgaben: 400 für Text, 600 für Navigation und Labels, 700 für Titel und Knöpfe, 800 für Werte. Überschriften brechen ausgeglichen um (balance), Absätze ohne einzelnes Wort in der letzten Zeile (pretty).

### Named Rules
**The 8-Pixel Rule.** Press Start 2P steht nur in 16, 24 oder 32 px, also auf ihrem Raster, und nur für Wortmarke, Seitentitel, Overlay-Titel und Texte im Spielfeld. Nie kleiner, nie für Fließtext, Knöpfe, Labels oder Werte.

**The Loud-Number Rule.** Am Ende eines Runs ist die Zahl laut, nicht der Titel: 56 px Archivo 800 für den Score, 16 px Pixelschrift für GAME OVER darüber.

**The Tabular-Figures Rule.** Jede Ziffer ist eine Tabellenziffer, damit Scores in Spalten stehen und beim Hochzählen nicht springen.

## Layout

Ein Seitenraster für alles: höchstens 1320 px breit, zentriert, mit dem Rand `gutter` (16 px auf dem Handy, mit der Fensterbreite wachsend bis 40 px, nie schmaler als die Safe Area). Abstände laufen auf einem 4-px-Raster von 4 bis 48 px. Die Kopfleiste ist 64 px hoch (bis 860 px Breite 56 px), darunter folgen 32 px Luft (auf Spielseiten 24 px) und der Seitenkopf: Titel und eine Zeile Untertitel auf einer Grundlinie, 24 px bis zum Inhalt. Innen gilt: Panels 20 px, Kapseln 16 px (die große 24 px), Overlay-Karte 24 px; zwischen Panels 20 bis 24 px, zwischen Abschnitten 32 px. Gruppen stehen eng, Abschnitte weit.

- **Hub:** Bibliothek und eine 320 px breite Seitenspalte mit 32 px Abstand; die Seitenspalte bleibt beim Scrollen 24 px unter dem Rand stehen. Oben steht „Weiterspielen“ als doppelt breite Kapsel (Grafik links auf 56 %, rechts Titel, Ziel, Highscore und „Spielen“), darunter die übrigen Spiele in drei Spalten mit 20 px Abstand. Bis 1100 px wird die Seitenspalte 280 px breit und das Raster zweispaltig, bis 900 px stehen beide Panels nebeneinander unter der Bibliothek, bis 720 px stapelt die große Kapsel Grafik über Text, bis 520 px rückt das Raster auf 12 px zusammen und lässt Ziel und Zahlentaste weg.
- **Spielseite:** Werte, Next und Steuerung links (200 bis 260 px), das Spielfeld in der Mitte, das Leaderboard rechts (240 bis 300 px). Die Hülle ist so breit wie dieses Raster, damit die Titelzeile mit ihm beginnt. Bis 1100 px steht das Feld links und eine Spalte rechts, bis 760 px alles untereinander: die Werte (drei nebeneinander) über dem Feld, die Steuerung zuletzt, und die Startkarte zeigt dann selbst die Steuerung. Ein flaches Feld (Geometry Dash) liegt oben über die ganze Breite (bis 1140 px), darunter drei Spalten; auf dem Handy rückt seine Karte unter das Feld.
- **Schach:** Brett (280 bis 560 px, aus der Fensterhöhe abzüglich 300 px) und eine Seitenspalte von 300 bis 360 px mit 24 px Abstand. Bis 900 px eine Spalte, die Statuszeile über dem Brett, das Brett so breit wie der Inhalt, höchstens 560 px. Die Lobby teilt sich in zwei Spalten im Verhältnis 1,3 : 1.
- **Admin:** vier Kennzahlen in einer Reihe (bis 1000 px zwei), darunter zwei Spalten mit Tabellen.
- **Eingabeart vor Breite:** Ohne Hover entfallen Tastenhinweise, Zahlentasten und das Anheben der Kapseln. Mit grobem Zeiger ersetzen Gesten die Tastenkappen, umschaltbar in den Einstellungen.

### Named Rules
**The Field-Fits-The-Window Rule.** Das Spielfeld füllt die Fensterhöhe, und die Seite scrollt beim Spielen nicht: Es ist so hoch wie das Fenster abzüglich einer Reserve von 190 px (bis 760 px Breite 272 px, weil die Werte darüber stehen), im Seitenverhältnis des Spiels, höchstens 1,75-mal so groß wie seine Spielkoordinaten, mindestens 220 px breit und nie breiter als seine Spalte.

## Elevation & Depth

Tiefe entsteht zuerst aus Tonwerten, dann aus Schatten. Von hinten nach vorne: Spielfeld-Schwarz, Nachtviolett (Seite), Erhöhtes Nachtviolett (Kopfleiste), Kapselviolett (Panels, Kapseln, Karten), Tastenviolett (Bedienelemente auf Flächen). Jede Fläche trägt eine 1-px-Haarlinie, Bedienbares eine Kante in Kantenviolett. Schatten zeigen, was schwebt (Overlay-Karte, Dialog, Kurzmeldung) oder was man anfassen kann (Kapsel, Tastenkappe); Panels liegen flach. Über dem Spielfeld liegt ein Schleier aus dunklem Violett mit 72 % Deckkraft, hinter Dialogen und über dem Schachbrett am Partieende einer mit 66 %. Ebenen: Overlay 10, Kopfleiste 20, Kurzmeldungen 40.

### Shadow Vocabulary
- **Auflage** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.35)`): Kapseln in Ruhe, Tastenkappen, gewähltes Segment, aktiver Reiter im Admin.
- **Gehoben** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 12px 28px -14px rgb(0 0 0 / 0.75)`): Kapsel beim Zeigen, Spielfeld, Schachbrett, Anmeldekarte.
- **Schwebend** (`box-shadow: 0 2px 6px rgb(0 0 0 / 0.4), 0 28px 56px -22px rgb(0 0 0 / 0.9)`): Overlay- und Ergebniskarte, Dialoge, Kurzmeldungen, das aufgeklappte Menü.
- **Gezogene Figur** (`filter: drop-shadow(0 6px 8px rgb(0 0 0 / 0.45))`): eine Schachfigur, solange sie gezogen wird.

### Named Rules
**The Soft-Offset Rule.** Jeder Schatten ist schwarz, fällt nach unten und ist weich. Kein farbiger Leuchtrand, keine harte Kante, kein Glow, auch nicht an Partikeln im Spielfeld.

**The Deeper-Field Rule.** Das Spielfeld liegt tiefer als der Raum: Spielfeld-Schwarz unter dem Seitengrund, jede Fläche der Hülle heller darüber.

## Shapes

Weich gerundete Rechtecke in drei Stufen, dazu Pillen und Quadrate. 12 px für alles, was eine Fläche ist: Panels, Kapseln, Overlay-Karte, Dialoge, Spielfeld. 10 px für Bedienelemente in normaler Größe: Knöpfe, Eingabefelder, Meldungen, Kurzmeldungen, Segmentschalter. 6 px für Kleines: kleine Knöpfe, Tags, Tastenkappen, Segmente, Zeilen im Leaderboard, Züge in der Zugliste und das Schachbrett. Pillen nur für Gesten, Filter-Chips im Admin, geschlagene Figuren und Fortschrittsbalken; kreisrund sind Avatar, Farbpunkte der Spieler, Zugpunkte auf dem Brett und der Spinner. Tastenhinweis im Knopf und Code haben 4 px.

Das Quadrat ist die zweite Form der Welt: Pixelschrift, quadratische Partikel, die 8-px-Spielmarke (2 px gerundet), das Schachbrett und die Steine und Kacheln der Kapselgrafiken. Ränder sind 1 px stark. Stärker sind nur die 3-px-Kante der Spielfarbe unter der Kapselgrafik, der 3-px-Unterstrich der aktiven Navigation, Markierungen auf dem Schachbrett und Fokusringe: 2 px in Cyan mit 2 px Abstand, an Kapseln mit 3 px Abstand, auf Schachfeldern 3 px nach innen.

## Components

### Buttons
Fest und flach, mit einem klaren Hauptknopf.
- **Shape:** sanft gerundet (10 px), 42 px hoch, 16 px Innenabstand; klein 34 px mit 12 px Innenabstand und 6 px Rundung, groß 50 px mit 24 px.
- **Primary:** Arcade-Cyan mit Cyan-Tinte, Archivo 700. „Spiel starten“, „Nochmal“, „Spielen“, „Anmelden“, „Bot-Partie starten“.
- **Hover / Focus:** Hover hellt in 120 ms zu Hellem Cyan auf; Fokus ist ein 2-px-Ring in Cyan mit 2 px Abstand; gedrückt sitzt der Knopf 1 px tiefer; deaktiviert 45 % Deckkraft.
- **Secondary:** Tastenviolett mit Kante in Kantenviolett und Textfarbe, Hover etwas heller (#2f2754). Für jede Nebenaktion: „Alle Spiele“, „Zum Brett“, „Pause“, „Abbrechen“.
- **Ghost:** transparent mit Nebentext, Hover Kapselviolett und Textfarbe: Kopfleiste, „Menü“, Nachspielen im Schach, „Ansehen“.
- **Danger:** roter Umriss (50 %) mit rotem Text, Hover Rot-Schleier: „Aufgeben“, Löschen und Leeren im Admin. Gefülltes Rot (#f0606b mit Schrift #1d0509) gibt es nur als „Bestätigen“ im Rückfrage-Dialog.
- **Tastenhinweis:** Die passende Taste steht rechts im Knopf („Enter“, „P“, „R“) als kleine Kappe in Label Strong mit 4 px Rundung, auf Cyan in 16 % Schwarz, auf sekundären Knöpfen in Nachtviolett mit Nebentext. Ohne Hover entfällt sie.

### Chips
- **Tags:** 22 px hoch, 6 px Rundung, Label Strong, Schleier ihrer Farbe mit Text in der Farbe: Cyan für „Du bist am Zug“ und „am Zug“, Gold nur für „Highscore“, gedämpft (Tastenviolett mit Nebentext) für Nebensachen.
- **Filter-Chips (Admin):** Pillen, 32 px hoch, Kante in Kantenviolett, Nebentext; gewählt Cyan-Schleier mit Cyan-Kante (50 %) und Cyan-Text.

### Cards / Containers
- **Corner Style:** 12 px für Panels, Kapseln, Karten und Dialoge.
- **Background:** Kapselviolett mit Haarlinie; das Spielfeld Spielfeld-Schwarz.
- **Shadow Strategy:** Panels flach, Kapseln mit Auflage, Spielfeld und Anmeldekarte Gehoben, Overlay-Karte und Dialoge Schwebend (siehe Elevation & Depth).
- **Internal Padding:** Panel 20 px mit Titel in 18 px 700 und 12 bis 16 px darunter; Listen trennen ihre Zeilen mit Haarlinien (12 px oben und unten), nie mit Streifen.
- **Dialog:** 460 px breit (Rückfrage 400 px), Kante in Kantenviolett, Kopf durch eine Haarlinie abgesetzt, Aktionen rechts unten; Schleier 66 %.
- **Kurzmeldung:** unten mittig, höchstens 480 px, Tastenviolett mit Kante, Schwebend; kommt 12 px von unten in 320 ms und geht in 200 ms.
- **Meldungen:** Schleier der Zustandsfarbe, Rand in der Zustandsfarbe (45 %), aufgehellte Schrift und das Symbol links.

### Inputs / Fields
- **Style:** 44 px hoch, Nachtviolett, 1-px-Kante in Kantenviolett, 10 px Rundung, 12 px Innenabstand; Label darüber in 14 px 600, Platzhalter in Nebentext. Hover hellt die Kante auf (#5a4f8c).
- **Focus:** Kante und 2-px-Ring in Cyan, ohne Abstand.
- **Error / Disabled:** ungültige Felder bekommen eine Kante in Signalrot, die Meldung steht über dem Formular.
- **Segmentschalter:** eine Spur in Nachtviolett mit Haarlinie und 4 px Innenabstand, Segmente in 14 px 600 Nebentext; das gewählte Segment liegt in Tastenviolett mit Textfarbe und Auflage. Er dient für Einstellungen (Bewegung, Touch-Steuerung) und die Wahl gegen den Bot. Der Design-Detektor meldet ihn im Panel als „nested cards“; er ist ein Bedienelement, keine Karte in der Karte.
- **Checkbox:** 20 px, in Cyan.

### Navigation
- **Kopfleiste:** 64 px, Erhöhtes Nachtviolett mit Haarlinie unten. Links die Wortmarke („ABW“ in Textfarbe, „ARCADE“ in Cyan, Press Start 2P 16 px), daneben „Spiele“, „Schach“ und „Admin“ in Archivo 600 und Nebentext; Hover Textfarbe; die aktive Seite in Textfarbe mit einem 3-px-Unterstrich in Cyan an der Unterkante. Rechts Avatar (30 px, Initial in Cyan), Name, „Einstellungen“ und „Abmelden“ als Ghost-Knöpfe.
- **Mobile treatment:** Von 861 bis 1080 px zeigen „Einstellungen“ und „Abmelden“ nur ihr Symbol. Bis 860 px liegt alles hinter „Menü“; das Menü klappt als Fläche unter der Leiste auf (Schwebend), die aktive Seite steht dort in Cyan.
- **Zurück-Link:** Chevron und „Alle Spiele“ oder „Lobby“ in Nebentext 600 vor dem Seitentitel.
- **Reiter im Admin:** eine Leiste in Erhöhtem Nachtviolett; der aktive Reiter liegt in Tastenviolett mit Auflage.

### Kapsel
Die Hülle eines Spiels wie im Regal einer Spielebibliothek: oben Licht, unten Information.
- **Aufbau:** Grafik im Format 16 : 9 (eigenes SVG in den Farben der Spiele) auf Spielfeld-Schwarz mit 13 % Spielfarbe, darunter die 3-px-Kante in Spielfarbe. Im Körper (16 px) Titel, eine Zeile Ziel, unten das Label „Highscore“, der Wert in Gold, „Platz 3 von 8“ in Nebentext und rechts die Zahlentaste als Tastenkappe. Für Schach steht die Elo in Textfarbe und, wenn eine Partie auf dich wartet, der Tag „Du bist am Zug“ neben dem Titel; für DOOM steht „Ohne Leaderboard“.
- **States:** Die ganze Kapsel ist ein Link. Mit Maus hebt sie sich beim Zeigen um 2 px (200 ms), ihr Rahmen nimmt 55 % Spielfarbe an, der Schatten wird Gehoben. Fokus ist ein Cyan-Ring mit 3 px Abstand; gedrückt (auch per Zahlentaste) wird der Rahmen cyan und die Kapsel sinkt zurück. Bei reduzierter Bewegung hebt sie sich nicht.
- **Weiterspielen:** doppelt breit, Grafik links (56 %, durch eine Haarlinie getrennt), Titel 28 px, Highscore 40 px, darunter „Spielen“ als gefüllter Knopf mit Hinweis „Enter“. Bis 720 px steht die Grafik über dem Text, wieder mit der Kante in Spielfarbe.

### Overlay- und Ergebniskarte
Ein Bildschirmtitel über dem Spielfeld; am Ende die eine laute Zahl.
- **Overlay:** Schleier (72 %) über dem Feld, darauf mittig die Karte: höchstens 360 px, 24 px innen, Kante in Kantenviolett, Schwebend. Titel in Screen Title, Text in Nebentext, darunter die Knöpfe in voller Breite und groß: einer gefüllt, darunter einer sekundär. In schmalen Feldern bis 300 px und auf dem Handy 16 px innen. Geometry Dash zeigt die Karte zweispaltig (Text links, Knöpfe rechts, bis 660 px). Der Design-Detektor meldet die Karte als „nested cards“; sie ist ein Dialog über dem Spielfeld und so gewollt.
- **Ergebnis:** Der Score zählt in 700 ms von 0 hoch (Score, zunächst in Textfarbe), darunter die Detailzeile („56 Lines · Level 6“). Unter einer Haarlinie folgt der Stand des Servers: zuerst „Der Server rechnet nach …“ mit Spinner, dann grün „Gespeichert · Platz 3 von 9“, eine Notiz („Bisher 9.348“ oder „Dein Highscore bleibt 12.340“) und „Vom Server nachgerechnet“. Bestätigt der Server einen neuen Highscore, folgt ein zweiter Schlag: Die Zahl wird golden und pulsiert einmal (auf 106 %, 320 ms), darunter kommt die Pokalzeile in Gold („Neuer Highscore · Platz 4 → 3“ oder „Dein erster Highscore“). Scheitert das Speichern, steht der Grund in hellem Rot mit Warnsymbol; wo ein neuer Versuch helfen kann, heißt die Hauptaktion „Erneut senden“.
- **Bewegung:** Der Schleier blendet in 200 ms ein. Die Karte federt aus 96 % Größe herein: eine gedämpfte Feder mit etwa 2,6 % Überschwingen, nach rund 240 ms zu 98 % da und nach rund 550 ms in Ruhe; wo der Browser `linear()` nicht kennt, sind es 320 ms ease-out. Ausblenden dauert 200 ms (ease-in), und schon beim Ausblenden gehört die Eingabe dem Spielfeld.
- **Schach:** Am Partieende legt sich dieselbe Karte über das Brett (Schleier 66 %): Titel in Pixelschrift („DU HAST GEWONNEN“, „DU HAST VERLOREN“, „REMIS“), der Grund, die neue Elo in 40 px 800 und Textfarbe mit der Differenz in Grün oder hellem Rot, und „Brett ansehen“ als einziger gefüllter Knopf.

### Tastenkappen und Gesten
Tasten sehen aus wie Tasten, Gesten wie Gesten.
- **Tastenkappe:** 26 px hoch und mindestens 26 px breit, Tastenviolett, Kante in Kantenviolett, 6 px Rundung, Label Strong, weicher Auflage-Schatten ohne harte Kante. Pfeiltasten zeigen einen Pfeil (14 px) statt eines Worts. In Steuerungslisten stehen die Kappen links und die Wirkung rechts.
- **Gesten-Pille:** 26 px hoch, Pille in Tastenviolett ohne Kante, Label Strong, das Wort und die Richtung als Pfeilsymbole (SVG, 13 px): „Tippen“, „Ziehen“ mit Pfeilen nach links und rechts, „Wischen“ mit Pfeil nach unten, „Halten“. Auf Handy und Tablet ersetzen die Pillen die Kappen in allen Hinweisen.
- **Zahlentasten:** Jede Kapsel trägt ihre Taste (1 bis 7), der Seitenkopf erklärt sie einmal. Ohne Hover entfallen alle Tastenhinweise.

### Leaderboard
- **Zeilen:** 36 px hoch, eine 28-px-Spalte für den Rang (rechtsbündig, 700, Nebentext), der Name, der Score rechts in 700. Platz 1 hat eine goldene Rangziffer.
- **Eigene Zeile:** Cyan-Schleier mit 6 px Rundung, der Name in Cyan 700. Nach einem gespeicherten Run blitzt sie einmal in Cyan auf (600 ms).
- **Ohne Streifen:** Zeilen tragen weder Zebrastreifen noch Linien. Darunter steht unter einer Haarlinie „Dein Highscore: 12.340 · Platz 3 von 8“ mit dem Wert in Gold.
- **Tabellen:** Rangliste und Admin trennen Zeilen mit Haarlinien, Köpfe stehen in 600 und Nebentext, Zahlen rechtsbündig. Die eigene Zeile in der Rangliste steht ganz in Cyan auf Cyan-Schleier.

### Schachbrett
- **Brett:** 8 × 8 Lavendelfelder, 6 px Rundung, Schatten Gehoben; Figuren aus dem Satz Chessnut (SVG). Die Koordinaten liegen als eigene Ebene über den Feldern und unter den Figuren (11 px Archivo 700, auf kleinen Brettern 9 px in den Ecken) und lassen sich abschalten. Sie stehen in Tinte aus dem Nachtviolett: Kantenviolett auf hellen Feldern (5,9 : 1), Erhöhtes Nachtviolett auf dunklen (5,0 : 1). Helle Schrift erreicht auf dem mittleren Lavendel höchstens 3,6 : 1.
- **Feldzustände:** Der letzte Zug liegt unter 30 % Cyan, die Auswahl trägt einen 3-px-Ring in Cyan über 35 %. Mögliche Züge zeigen einen Punkt, Schlagzüge einen Ring, beide in Nachtviolett mit 38 %. Beim Ziehen markiert ein weißer 3-px-Ring das Zielfeld. Steht ein König im Schach, wird sein Feld getönt: ein Hinweis, kein Alarm. Rot bekommt nur das Matt (70 %).
- **Bewegung:** Figuren gleiten in 200 ms (ease-out), neue blenden aus 85 % Größe ein, die gezogene Figur hebt sich mit ihrem Schatten.
- **Drumherum:** Spielerleisten mit Farbpunkt, Name (700), Elo in Nebentext, Tag „am Zug“ und den geschlagenen Figuren in einer hellen Lavendel-Pille. Die Statuszeile ist cyan, wenn du am Zug bist. Ein Remis-Angebot erscheint als Kasten über der Zugliste mit „Annehmen“ (gefüllt) und „Ablehnen“ (sekundär). Die Zugliste markiert den gezeigten Zug mit Cyan-Schleier und Cyan.

### Effekte im Spielfeld
- **Partikel:** quadratisch (2 bis 4 px, Konfetti 3 bis 6 px), in der Farbe dessen, was getroffen wurde (Stein, Futter, Würfel), in voller Deckkraft und ohne Glow.
- **Blitze:** höchstens drei pro Sekunde. Hell (Lavendelweiß, 50 %) nur über abgeräumten Reihen, rot (18 bis 26 %) über dem Feld bei Leben-Verlust und Game Over.
- **Wackeln:** 3 bis 6 px für 220 bis 380 ms, nur bei voller Bewegung.
- **Texte:** in Press Start 2P 16 oder 24 px („LEVEL 2“, „TETRIS“), steigen 18 px und blenden in 900 ms aus.
- **Reduziert / Aus:** Bei reduzierter Bewegung gibt es kein Wackeln und keine Spuren, ein Drittel der Partikel und Texte, die stehen bleiben; bei „Aus“ keine Effekte.

### Named Rules
**The One-Filled-Button Rule.** Höchstens ein gefüllter Knopf pro Ansicht; alles daneben ist sekundär oder ghost.

**The One-Loud-Moment Rule.** Nur das Ende eines Runs ist laut: Die Karte federt, die Zahl zählt hoch, und ein bestätigter Highscore kommt als zweiter Schlag (Gold, Puls, Pokalzeile). Alles andere in der Hülle bleibt kurz (120 ms für Farbe, 200 ms für Wege und Ausblenden, 320 ms für Hereinkommendes) und bewegt sich nur, um einen Zustand zu zeigen.

## Do's and Don'ts

### Do:
- **Do** lass die Farbe aus den Spielen kommen: Kapselgrafik und Spielfeld sind kräftig, Flächen, Linien und Text der Hülle bleiben in den Neutralen.
- **Do** nimm Cyan für jede Aktion, jede Auswahl und jeden Fokus, auch auf Spielseiten.
- **Do** färbe einen Wert nur golden, wenn er ein Highscore ist, und die Ergebniszahl erst, wenn der Server den Highscore bestätigt hat.
- **Do** markiere die eigene Zeile in Leaderboard und Rangliste mit Cyan-Schleier und dem Namen in Cyan.
- **Do** setze Press Start 2P nur in 16, 24 oder 32 px und alles andere in Archivo mit Tabellenziffern.
- **Do** zeige Tasten als Tastenkappen und auf Touchgeräten Gesten als Pillen (Tippen, Ziehen, Wischen, Halten) mit Pfeilen; Tastenhinweise entfallen ohne Hover.
- **Do** lass Overlays federnd hereinkommen und in 200 ms verschwinden; bei reduzierter Bewegung bleibt nur das Ein- und Ausblenden.
- **Do** zeichne Partikel quadratisch in der Farbe dessen, was getroffen wurde, und blitze höchstens dreimal pro Sekunde: hell nur über abgeräumten Reihen, rot bei Leben-Verlust und Game Over.

### Don't:
- **Don't** verwende Verlaufsschrift, Glow-Ränder, Scanlines über der Oberfläche oder Pixelschrift in 8 px; das ist der abgelehnte Synthwave-Standard.
- **Don't** setze Press Start 2P unter 16 px oder für Fließtext, Knöpfe, Labels und Werte.
- **Don't** färbe Elo, Lines, Level oder andere Werte golden.
- **Don't** nimm eine Spielfarbe für Knöpfe, Links, Fokus, Text oder Auswahl.
- **Don't** stelle mehr als einen gefüllten Knopf in eine Ansicht.
- **Don't** streife Tabellen und Leaderboards (Zebra); Zeilen trennen Haarlinien oder Luft.
- **Don't** lass einen Blitz weiß über das ganze Spielfeld gehen oder öfter als dreimal pro Sekunde blitzen.
- **Don't** gib einem Schatten Farbe oder eine harte Kante.
