// Schach im Browser ohne eigene Regeln: Die Regeln prüft allein chess_engine.py.
// Dieses Modul spielt nur die vom Server bestätigte Zugliste nach (für das
// Nachspielen und die geschlagenen Figuren) und schreibt Züge auf Deutsch.
// Ein Brett ist wie auf dem Server: 8 Reihen, Reihe 0 = 8. Reihe, Weiß groß.

export const FILES = "abcdefgh";

export const START = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

export const NAMES = { K: "König", Q: "Dame", R: "Turm", B: "Läufer", N: "Springer", P: "Bauer" };
const LETTER = { K: "K", Q: "D", R: "T", B: "L", N: "S", P: "" };
const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

export const isWhite = (p) => p === p.toUpperCase();
export const rc = (sq) => [8 - Number(sq[1]), FILES.indexOf(sq[0])];
export const sqName = (r, c) => FILES[c] + (8 - r);

/** Stellung nach einem Zug aus der Historie (wie _apply in chess_engine.py). */
export function applyMove(board, m) {
  const b = board.map((row) => row.slice());
  const [fr, fc] = rc(m.from);
  const [tr, tc] = rc(m.to);
  const white = isWhite(m.piece);
  b[fr][fc] = null;
  if (m.flag === "ep") b[tr + (white ? 1 : -1)][tc] = null;
  b[tr][tc] = m.flag === "promo" ? (white ? m.promo : m.promo.toLowerCase()) : m.piece;
  if (m.flag === "OO") { b[tr][7] = null; b[tr][5] = white ? "R" : "r"; }
  if (m.flag === "OOO") { b[tr][0] = null; b[tr][3] = white ? "R" : "r"; }
  return b;
}

/** Alle Stellungen einer Partie: [Startstellung, nach Halbzug 1, …]. */
export function replay(history, start = START) {
  const boards = [start];
  for (const m of history) boards.push(applyMove(boards[boards.length - 1], m));
  return boards;
}

/** "Sg1–f3", "e4×d5", "e5×d6 e. p.", "O-O", "e7–e8=D+", "Dd1×f7#". */
export function notation(m, { mate = false } = {}) {
  let s;
  if (m.flag === "OO") s = "O-O";
  else if (m.flag === "OOO") s = "O-O-O";
  else {
    s = LETTER[m.piece.toUpperCase()] + m.from + (m.capture ? "×" : "–") + m.to;
    if (m.flag === "promo") s += "=" + LETTER[m.promo.toUpperCase()];
    if (m.flag === "ep") s += " e. p.";
  }
  if (mate) s += "#";
  else if (m.check) s += "+";
  return s;
}

/** Ausgesprochene Fassung für Screenreader: "Springer g1 nach f3, Schach". */
export function spoken(m, { mate = false } = {}) {
  let s;
  if (m.flag === "OO") s = "kurze Rochade";
  else if (m.flag === "OOO") s = "lange Rochade";
  else {
    s = `${NAMES[m.piece.toUpperCase()]} ${m.from} ${m.capture ? "schlägt auf" : "nach"} ${m.to}`;
    if (m.flag === "promo") s += `, wird ${NAMES[m.promo.toUpperCase()]}`;
    if (m.flag === "ep") s += " en passant";
  }
  if (mate) s += ", Schachmatt";
  else if (m.check) s += ", Schach";
  return s;
}

/**
 * Geschlagene Figuren je Seite und Materialvorsprung von Weiß.
 * captured.w = Figuren, die Weiß geschlagen hat (also schwarze), sortiert.
 */
export function material(history) {
  const captured = { w: [], b: [] };
  let balance = 0;
  for (const m of history) {
    const mover = isWhite(m.piece) ? "w" : "b";
    if (m.capture) {
      captured[mover].push(m.capture);
      balance += (mover === "w" ? 1 : -1) * VALUE[m.capture.toUpperCase()];
    }
    if (m.flag === "promo") {
      const gain = VALUE[m.promo.toUpperCase()] - VALUE.P;
      balance += (mover === "w" ? 1 : -1) * gain;
    }
  }
  const order = (a, b) => VALUE[b.toUpperCase()] - VALUE[a.toUpperCase()];
  captured.w.sort(order);
  captured.b.sort(order);
  return { captured, balance };
}
