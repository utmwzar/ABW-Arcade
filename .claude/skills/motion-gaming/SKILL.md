---
name: motion-gaming
description: Use when adding or changing any animation, transition, overlay entrance/exit, score count-up, chess piece movement, or in-game canvas effect (particles, screen shake, flashes) in ABW Arcade. Covers game-feel motion without React, using the Web Animations API, CSS and the project modules static/js/fx.js and static/js/fx-canvas.js, plus the rule that effects must never touch the deterministic engines.
---

# Motion für ABW Arcade (ohne React)

ABW Arcade hat keinen Build-Schritt und kein React. Bewegung entsteht mit der Web Animations API
(`element.animate`), CSS-Transitions und zwei Projektmodulen:

- `static/js/fx.js` für DOM-Bewegung (Overlays, Panels, Zahlen, Schachfiguren);
  die Overlays der Arcade-Spiele steuert `static/js/arcade.js` mit diesen Bausteinen;
- `static/js/fx-canvas.js` für Effekte im Spielfeld (Partikel, Wackeln, Blitze, Texte).

Die Prinzipien von Framer Motion gelten trotzdem: Federn statt starrer Kurven, gestaffeltes
Einblenden, eigene Ausblend-Animationen und Bewegungen, die man jederzeit unterbrechen kann.

## Harte Regeln

1. **Die Engines bleiben unberührt.** Effekte lesen den Zustand nur; sie entstehen aus dem
   Vergleich „vorher/nachher“ eines Ticks.
   - Nie `engine.rng()` aufrufen: ein zusätzlicher Aufruf verschiebt Steine, Futter, Aufschläge
     und Spawns, und der Server lehnt danach ehrliche Partien ab.
   - Nie ändernde Methoden aufrufen (`applyAction`, `tick`, `move`, `gravityStep` …).
   - Nie Engine-Arrays sortieren oder umdrehen.
   - Für Zufall in Effekten immer `Math.random` nehmen.
2. **Effekte haben ihre eigene Uhr.** Ihre Zeit kommt aus dem `dt` von `requestAnimationFrame`.
   `accMs`, `tickCount`, `pending` und die Tick-Konstanten der Controller fassen sie nie an.
3. **Nur `transform` und `opacity` animieren.** Keine Animation von `width`, `height`, `top`, `left`
   oder Schatten auf vielen Elementen. Im Canvas gilt: Wackeln per `ctx.translate` innerhalb des
   Canvas, nie per CSS am Element, sonst verrutschen die Koordinaten für Touch.
4. **Bewegung blockiert nie die Eingabe.** Ein neuer Zug oder eine neue Taste bricht die laufende
   Animation ab (`animation.finish()` oder `cancel()`), statt auf sie zu warten.
5. **Reduzierte Bewegung gilt immer.** `fx.motion()` liefert `'full'`, `'reduced'` oder `'off'`.
   Grundlage sind die Einstellung in der App (`prefs.get('ui.motion')`: System, Voll, Reduziert
   oder Aus) und bei „System“ `prefers-reduced-motion`.
   - Bei `reduced` gibt es kein Wackeln und keine Wege; Ein- und Ausblenden nur über `opacity`.
     Partikel schrumpfen auf etwa 30 %.
   - Bei `off` gibt es keine Animation; der Endzustand wird sofort gesetzt.
   - Die globale CSS-Regel für reduzierte Bewegung erfasst **keine** WAAPI-Animationen; `fx.js`
     muss selbst prüfen.
6. **Lichtblitze höchstens dreimal pro Sekunde** (Schutz bei Lichtempfindlichkeit), und nie
   vollflächig weiß.

## Zeit und Kurven (Tokens)

Die Werte stehen als CSS-Variablen in `static/css/tokens.css` und als Konstanten in `fx.js`.

| Token (CSS / `fx.DUR`) | Wert | Wofür |
|---|---|---|
| `--dur-short` / `DUR.short` | 120 ms | Hover, Druckfeedback, Ausblenden kleiner Elemente |
| `--dur-base` / `DUR.base` | 200 ms | Overlay aus, Panel-Wechsel, Schachzug |
| `--dur-long` / `DUR.long` | 320 ms | Overlay ein, Ergebnis-Karte |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Standard für Einblenden |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Ausblenden |
| `--ease-spring` | `linear(…)` aus `fx.spring()` | Ergebnis-Karte, Highscore-Badge |

- Einblenden dauert länger als Ausblenden.
- Gestaffeltes Einblenden: höchstens 6 Elemente, je höchstens 40 ms Abstand.
- Keine Bounce- oder Elastic-Kurven mit sichtbarem Überschwingen über 4 %.

## API von `static/js/fx.js` (Vertrag)

```js
motion()                                   // 'full' | 'reduced' | 'off'
animate(el, keyframes, opts)               // Animation | null; respektiert motion(), fill: 'backwards'
enter(el, { from = 'up' | 'scale' | 'fade', delay }) // setzt hidden = false, blendet ein; Promise
exit(el, { to = 'down' | 'scale' | 'fade' })         // blendet aus, setzt danach hidden = true; Promise
stagger(els, (el, delay) => Animation|null, { step = 30, max = 6 })
flip(el, firstRect, { duration, easing })  // FLIP: el ist bereits am Ziel, firstRect = alte Position
countTo(el, from, to, { ms = 600, format })  // Zahl hochzählen, format = de-DE
bump(el)  flash(el)  shake(el)             // kurzes Feedback; flash höchstens 3× pro Sekunde
spring({ stiffness = 210, damping = 22, mass = 1 })  // { easing: 'linear(…)', duration }
reduceKeyframes(keyframes)                 // nur opacity, oder null
```

Maßgeblich ist der Code in `static/js/fx.js`; die reinen Teile prüft `tests/js/fx.test.mjs`.

## API von `static/js/fx-canvas.js` (Vertrag)

```js
const fx = createCanvasFx({ maxParticles = 256, motion })   // motion: () => 'full'|'reduced'|'off'
fx.burst(x, y, { count, color, speed:[min,max], life:[min,max], size:[min,max], gravity, spread })
fx.flash({ x, y, w, h, color, ms, alpha })  // ohne Rechteck = ganzes Feld; ≤ 3 pro Sekunde
fx.shake(intensity, ms)
fx.text(x, y, str, { color, ms, rise, font })
fx.update(dtMs)        // pro Frame mit eigener Uhr
fx.applyShake(ctx)     // vor dem Zeichnen der Szene
fx.draw(ctx)           // nach dem Zeichnen der Szene
fx.busy()  fx.reset()
```

- Partikel kommen aus einem festen Pool, ohne Allokation pro Frame.
- Partikel bekommen kein `shadowBlur`; für Leuchten dient `globalCompositeOperation = 'lighter'`.
- Beobachter-Module unter `static/js/observe/<spiel>.js` liefern Ereignisse aus Zustandsvergleichen:
  `snap(engine)` kopiert nur Grundwerte und Referenzen, `diff(before, engine)` liefert eine Liste
  wie `[{ type: 'lineClear', rows: [...] }, …]`.
- Beide Funktionen sind rein. Ein `node --test` prüft, dass ein Lauf mit Beobachtern dasselbe
  Ergebnis liefert wie `simulate()`.

## Typische Momente

| Moment | Bewegung |
|---|---|
| Overlay erscheint | Abdunklung blendet ein, die Karte federt herein (`spring()`); weg in 200 ms |
| Game Over | Spielfeld läuft weiter, bis `fx.busy()` falsch ist; nach etwa 400 ms erscheint das Overlay |
| Neuer Highscore | Score per `countTo`, danach `bump`; goldene Statuszeile unter dem Score (kein Badge über dem Titel) |
| Leaderboard-Rang neu | Zeile kurz hervorheben (`flash`), keine Sortier-Animation |
| Schachzug | Figur per `flip` (200 ms); geschlagene Figur blendet aus; Turm bei Rochade mit |
| Schach | Königsfeld pulsiert einmal, keine Endlosschleife |

## Prüfen

- `node pruefe-engines.js` und `node --test` müssen grün sein.
- Playwright-Rundgang einmal mit `reducedMotion: 'reduce'`: Es darf nichts wackeln, und alle
  Zustände müssen erreichbar sein.
- Ein Durchlauf pro Spiel mit Effekten: Client-Score und Server-Score müssen übereinstimmen.
  Die Warnung bei Abweichung in den Controllern bleibt erhalten.
