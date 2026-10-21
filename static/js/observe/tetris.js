// Ereignisse im Tetris-Spiel aus dem Vergleich vor und nach einem Schritt
// (applyAction oder gravityStep). Rein lesend: keine Methode der Engine, keine
// Änderung an ihren Arrays. Geprüft in tests/js/observe.test.mjs.

// Grundwerte und Referenzen; grid.slice() kopiert nur die Zeilen-Referenzen.
export function snap(engine) {
  const cur = engine.current;
  return {
    cur,
    y0: cur ? cur.y : 0,
    rows: engine.grid.slice(),
    level: engine.level,
    over: engine.gameOver,
  };
}

// action: die angewendete Aktion oder null (Schwerkraft).
// Ereignisse:
//   { type: "lock", cells: [[x, y, farbe], ...] }        Stein liegt
//   { type: "drop", cells, from, to }                    sofort abgelegt (HARD), Stein-y von from nach to
//   { type: "clear", rows: [{ y, cells: [farbe, ...] }] } volle Reihen, y vor dem Abräumen
//   { type: "level", level }
//   { type: "over" }
export function diff(before, engine, action = null) {
  const events = [];
  const piece = before.cur;
  // Ein neuer Stein heißt: der alte liegt. Er behält seine letzte Position.
  if (piece && engine.current !== piece) {
    const cells = [];
    piece.matrix.forEach((row, y) => row.forEach((v, x) => {
      if (v && piece.y + y >= 0) cells.push([piece.x + x, piece.y + y, v]);
    }));
    if (action === "HARD" && piece.y > before.y0) events.push({ type: "drop", cells, from: before.y0, to: piece.y });
    events.push({ type: "lock", cells });
    // Abgeräumte Reihen sind die Zeilen-Arrays, die nicht mehr im Gitter stehen.
    const rows = [];
    for (let y = 0; y < before.rows.length; y++) {
      if (!engine.grid.includes(before.rows[y])) rows.push({ y, cells: before.rows[y].slice() });
    }
    if (rows.length) events.push({ type: "clear", rows });
  }
  if (engine.level > before.level) events.push({ type: "level", level: engine.level });
  if (engine.gameOver && !before.over) events.push({ type: "over" });
  return events;
}
