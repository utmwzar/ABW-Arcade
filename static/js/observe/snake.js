// Ereignisse im Snake-Spiel aus dem Vergleich vor und nach einem Takt.
// Rein lesend; geprüft in tests/js/observe.test.mjs.

// food ist ein Array, das die Engine beim Spawn ersetzt, nie verändert.
export function snap(engine) {
  return { food: engine.food, score: engine.score, over: engine.gameOver };
}

// Ereignisse:
//   { type: "eat", x, y }     Futter gefressen (Zelle)
//   { type: "crash", x, y }   gegen Wand oder Körper (Kopf)
//   { type: "won" }           Feld voll
export function diff(before, engine) {
  const events = [];
  if (engine.score > before.score && before.food) {
    events.push({ type: "eat", x: before.food[0], y: before.food[1] });
  }
  if (engine.gameOver && !before.over) {
    if (engine.won) events.push({ type: "won" });
    else events.push({ type: "crash", x: engine.snake[0][0], y: engine.snake[0][1] });
  }
  return events;
}
