// Ereignisse im Geometry-Dash-Spiel aus dem Vergleich vor und nach einem Takt.
// Rein lesend; geprüft in tests/js/observe.test.mjs.

export function snap(engine) {
  return { ground: engine.onGround, over: engine.gameOver };
}

// Ereignisse:
//   { type: "jump" }    abgesprungen (nicht: über eine Kante gefallen)
//   { type: "land" }    gelandet
//   { type: "crash" }   gegen ein Hindernis
//   { type: "won" }     Ziel erreicht
export function diff(before, engine) {
  const events = [];
  if (before.ground && !engine.onGround && engine.vy > 0) events.push({ type: "jump" });
  if (!before.ground && engine.onGround && !engine.gameOver) events.push({ type: "land" });
  if (engine.gameOver && !before.over) events.push({ type: engine.won ? "won" : "crash" });
  return events;
}
