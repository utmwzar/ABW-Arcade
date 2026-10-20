---
name: local-storage-state
description: Use when ABW Arcade should remember something in the viewer's browser — settings (motion, touch controls, chess board options, DOOM sound), last-used choices (chess bot level and colour) or "already seen" flags. Defines the single module static/js/prefs.js, its key scheme, validation, fallbacks and what must never be stored in localStorage.
---

# Browser-Speicher für ABW Arcade

Alles, was die Seite im Browser des Spielers speichert, läuft über **ein** Modul:
`static/js/prefs.js`. Direkte Zugriffe auf `localStorage` oder `sessionStorage` an anderer Stelle
sind nicht erlaubt.

## Wofür, wofür nicht

**Erlaubt** sind Komfort-Einstellungen eines einzelnen Spielers in einem einzelnen Browser:
- Bewegung (System, An oder Reduziert);
- Touch-Steuerung (Auto, An oder Aus);
- Schach: Koordinaten, Zughinweise, zuletzt gewählte Bot-Stärke und Farbe;
- DOOM-Ton;
- „Hilfe schon gesehen“.

**Niemals gespeichert werden:**
- Sitzung, Passwörter, Tokens oder irgendetwas Sicherheitsrelevantes;
- Scores, Eingabeprotokolle, `game_id` oder Seeds, also alles, dem der Server vertrauen müsste. Die
  Leaderboards entstehen ausschließlich durch das Nachspielen auf dem Server;
- persönliche Daten über das hinaus, was ohnehin angezeigt wird;
- Daten, die mehrere Personen sehen sollen. Die gehören auf den Server.

Die Seite muss mit **leerem oder gesperrtem** Speicher vollständig funktionieren: privates Fenster,
blockierte Website-Daten, Safari mit vollem Kontingent.

## Schlüssel und Schema

- Schlüssel folgen dem Muster `abw.v1.<bereich>.<name>`, zum Beispiel `abw.v1.chess.coords`.
- Jeder Schlüssel ist in `SCHEMA` in `prefs.js` eingetragen, mit Default und erlaubten Werten.
  `SCHEMA` ist die **einzige** Liste der gespeicherten Einstellungen; eine weitere Liste gibt es
  nicht.

```js
export const SCHEMA = {
  'ui.motion':      { default: 'system', values: ['system', 'full', 'reduced'] },
  'ui.touch':       { default: 'auto',   values: ['auto', 'on', 'off'] },
  'chess.coords':   { default: true,     type: 'boolean' },
  'chess.hints':    { default: true,     type: 'boolean' },
  'chess.botLevel': { default: 'medium', values: ['easy', 'medium', 'hard'] },
  'chess.botColor': { default: 'random', values: ['random', 'w', 'b'] },
  'doom.sound':     { default: true,     type: 'boolean' },
  'help.seen':      { default: [],       type: 'slugs' },   // Spiel-Slugs aus der GAMES-Registry
};
```

Wer ein neues Feld braucht, ergänzt `SCHEMA` und braucht sonst nichts anzulegen.

## API von `static/js/prefs.js` (Vertrag)

```js
get(key)                 // gespeicherter Wert, wenn gültig; sonst der Default
set(key, value)          // prüft gegen SCHEMA; Ungültiges wird ignoriert (console.warn)
reset(key)               // zurück auf den Default
subscribe(key | '*', (value, key) => {})  // gibt eine Abmeldefunktion zurück
```

## Pflichten der Implementierung

1. **Jeder Zugriff steckt in try/catch.** Schon der Zugriff auf `window.localStorage` kann werfen.
   Bei einem Fehler arbeitet das Modul still mit einer `Map` im Arbeitsspeicher weiter.
2. **Werte werden als JSON gespeichert und beim Lesen geprüft.** Ein kaputter oder unbekannter Wert
   führt zum Default, nie zu einem Fehler.
3. **Tabs bleiben gleich:** Ein Listener auf `window` für das `storage`-Event ruft die
   `subscribe`-Callbacks auf, wenn ein anderer Tab etwas ändert.
4. **Versionierung:** `v1` steckt im Schlüssel. Ändert sich die Bedeutung eines Werts, kommt ein neuer
   Schlüssel mit `v2` dazu, mit einer kleinen Übernahme beim Start; alte Schlüssel werden danach
   gelöscht.
5. **Kein Flackern:** Was das erste Bild beeinflusst (Bewegung, Touch-Leiste), setzt ein kleines
   Inline-Skript im `<head>` als Klasse auf `<html>`, ebenfalls in try/catch. Alles andere darf nach
   dem Laden greifen.
6. **Nichts Großes:** keine Bilder und keine Listen ohne Obergrenze; `help.seen` enthält nur bekannte
   Slugs.

## Prüfen

- `node --test`: `prefs.js` gegen eine Fake-Storage-Implementierung. Abgedeckt sind ungültige Werte,
  ein werfender Storage, das `storage`-Event und Defaults.
- Playwright mit gesperrtem Storage (`addInitScript`, der den Getter von `localStorage` werfen lässt):
  Alle Seiten müssen ohne Konsolenfehler laufen.
