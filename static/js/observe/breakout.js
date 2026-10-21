// Ereignisse im Breakout-Spiel aus dem Vergleich vor und nach einem Takt.
// Rein lesend; geprüft in tests/js/observe.test.mjs.

// Die Engine räumt je Takt höchstens einen Stein ab. Welcher es war, merkt
// sich seen (je Stein 1, sobald gemeldet) – das gehört dem Aufrufer, nicht
// der Engine. Neues Spiel: newSeen(engine).
export const newSeen = (engine) => new Uint8Array(engine.bricks.length);

export function snap(engine) {
  return {
    broken: engine.bricksBroken, lives: engine.lives, vy: engine.vy,
    bx: engine.bx, over: engine.gameOver,
  };
}

// Ereignisse:
//   { type: "brick", x, y, w, h, row }   Stein abgeräumt
//   { type: "paddle", x }                Ball prallt vom Paddle
//   { type: "life", x }                  Ball verloren, es geht weiter (x: wo er fiel)
//   { type: "over", x }                  letzter Ball verloren
//   { type: "won" }                      alle Steine weg
export function diff(before, engine, seen) {
  const events = [];
  if (engine.bricksBroken > before.broken) {
    for (let i = 0; i < engine.bricks.length; i++) {
      const b = engine.bricks[i];
      if (!b.alive && !seen[i]) {
        seen[i] = 1;
        events.push({ type: "brick", x: b.x, y: b.y, w: b.w, h: b.h, row: b.row });
      }
    }
  }
  if (before.vy > 0 && engine.vy < 0 && engine.by === engine.paddleY - engine.ballR) {
    events.push({ type: "paddle", x: engine.bx });
  }
  if (engine.lives < before.lives) {
    events.push({ type: engine.gameOver ? "over" : "life", x: before.bx });
  }
  if (engine.gameOver && !before.over && engine.won) events.push({ type: "won" });
  return events;
}
