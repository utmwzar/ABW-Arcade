// 2048: Was ein Zug auf dem Brett bewegt, für die Schiebe-Animation. Die
// Engine verrät ihre Bahnen nicht; slidePlan rechnet sie nach denselben
// Regeln nach (von der Kante her, je Paar nur eine Verschmelzung).
// Rein; geprüft in tests/js/observe.test.mjs gegen engine.move().

const SIZE = 4;

function lanes(dir) {
  const out = [];
  for (let a = 0; a < SIZE; a++) {
    const lane = [];
    for (let b = 0; b < SIZE; b++) {
      if (dir === "L") lane.push(a * SIZE + b);
      else if (dir === "R") lane.push(a * SIZE + (SIZE - 1 - b));
      else if (dir === "U") lane.push(b * SIZE + a);
      else lane.push((SIZE - 1 - b) * SIZE + a);   // D
    }
    out.push(lane);
  }
  return out;
}
const LANES = { L: lanes("L"), R: lanes("R"), U: lanes("U"), D: lanes("D") };

// board: 16 Werte (0 = leer), zeilenweise. Ergebnis:
//   board    Brett nach dem Zug, ohne die neue Kachel
//   moves    [{ from, to, value }] je Kachel (value vor dem Verschmelzen)
//   merges   [{ at, value }] neue Werte an Zielfeldern
//   gained   Punkte dieses Zugs
//   changed  ob sich etwas bewegt hat
export function slidePlan(board, dir) {
  const out = new Array(SIZE * SIZE).fill(0);
  const moves = [];
  const merges = [];
  let gained = 0;
  for (const lane of LANES[dir]) {
    const tiles = [];
    for (const i of lane) if (board[i]) tiles.push(i);
    let k = 0;
    for (let j = 0; j < tiles.length; j++) {
      const to = lane[k++];
      const v = board[tiles[j]];
      if (j + 1 < tiles.length && board[tiles[j + 1]] === v) {
        moves.push({ from: tiles[j], to, value: v }, { from: tiles[j + 1], to, value: v });
        merges.push({ at: to, value: v * 2 });
        out[to] = v * 2;
        gained += v * 2;
        j++;
      } else {
        moves.push({ from: tiles[j], to, value: v });
        out[to] = v;
      }
    }
  }
  const changed = out.some((v, i) => v !== board[i]);
  return { board: out, moves, merges, gained, changed };
}
