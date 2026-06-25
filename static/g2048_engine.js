/*
 * Deterministic 2048 engine — shared by the browser (gameplay) and the server
 * (replay). 2048's only randomness is tile spawning: which empty cell, and
 * 2 (90%) vs 4 (10%). Both are driven by the same integer mulberry32 PRNG used
 * by the other engines, consumed in a fixed order (cell first, then value), so
 * JS and Python evolve identically from the same seed + move sequence and the
 * server can recompute the authoritative score from the recorded moves.
 *
 * Inputs are direction presses recorded as { tick, dir }, dir in:
 *   U = up, D = down, L = left, R = right.
 * A move that does not change the board is a no-op (no spawn, no RNG, the move
 * counter does not advance) — exactly as in real 2048. The game ends when the
 * board is full and no merge is possible.
 *
 * UMD wrapper: browser global `G2048Engine`, or require() under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G2048Engine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIZE = 4;
  const TARGET = 2048;
  const MAX_MOVES = 100000;
  const ACTIONS = ["U", "D", "L", "R"];

  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) >>> 0;
      return (t ^ (t >>> 14)) >>> 0;
    };
  }

  // For each direction, the four lanes (board indices, row-major i = r*4 + c)
  // ordered FROM the edge tiles slide toward; compressing each lane toward its
  // index 0 performs the move.
  function lanesFor(direction) {
    const lanes = [];
    if (direction === "L") {
      for (let r = 0; r < SIZE; r++) {
        const lane = [];
        for (let c = 0; c < SIZE; c++) lane.push(r * SIZE + c);
        lanes.push(lane);
      }
    } else if (direction === "R") {
      for (let r = 0; r < SIZE; r++) {
        const lane = [];
        for (let c = SIZE - 1; c >= 0; c--) lane.push(r * SIZE + c);
        lanes.push(lane);
      }
    } else if (direction === "U") {
      for (let c = 0; c < SIZE; c++) {
        const lane = [];
        for (let r = 0; r < SIZE; r++) lane.push(r * SIZE + c);
        lanes.push(lane);
      }
    } else if (direction === "D") {
      for (let c = 0; c < SIZE; c++) {
        const lane = [];
        for (let r = SIZE - 1; r >= 0; r--) lane.push(r * SIZE + c);
        lanes.push(lane);
      }
    }
    return lanes;
  }

  const LANES = {};
  for (const d of ACTIONS) LANES[d] = lanesFor(d);

  // Slide+merge a 4-length lane toward index 0. Returns { out, gained, changed }.
  function compress(vals) {
    const tiles = [];
    for (let i = 0; i < vals.length; i++) if (vals[i] !== 0) tiles.push(vals[i]);
    const out = [];
    let gained = 0;
    let i = 0;
    const n = tiles.length;
    while (i < n) {
      if (i + 1 < n && tiles[i] === tiles[i + 1]) {
        const merged = tiles[i] * 2;
        out.push(merged);
        gained += merged;
        i += 2;
      } else {
        out.push(tiles[i]);
        i += 1;
      }
    }
    while (out.length < SIZE) out.push(0);
    let changed = false;
    for (let k = 0; k < SIZE; k++) if (out[k] !== vals[k]) { changed = true; break; }
    return { out: out, gained: gained, changed: changed };
  }

  function boardMax(board) {
    let m = 0;
    for (let i = 0; i < board.length; i++) if (board[i] > m) m = board[i];
    return m;
  }

  class Engine {
    constructor(seed) {
      this.size = SIZE;
      this.rng = makeRng(seed >>> 0);
      this.board = new Array(SIZE * SIZE).fill(0);
      this.score = 0;
      this.moves = 0;
      this.highest = 0;
      this.won = false;
      this.gameOver = false;
      this.lastSpawn = -1; // cell index of the most recent spawn (display only)
      this._spawn();
      this._spawn();
      this._updateStatus();
    }

    _spawn() {
      const empties = [];
      for (let i = 0; i < this.board.length; i++) if (this.board[i] === 0) empties.push(i);
      if (empties.length === 0) { this.lastSpawn = -1; return; }
      const cell = empties[this.rng() % empties.length];
      const value = (this.rng() % 10) === 0 ? 4 : 2;
      this.board[cell] = value;
      this.lastSpawn = cell;
    }

    _updateStatus() {
      const m = boardMax(this.board);
      if (m > this.highest) this.highest = m;
      if (m >= TARGET) this.won = true;
      if (this.board.indexOf(0) !== -1) { this.gameOver = false; return; }
      let movable = false;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const v = this.board[r * SIZE + c];
          if (c + 1 < SIZE && this.board[r * SIZE + c + 1] === v) movable = true;
          if (r + 1 < SIZE && this.board[(r + 1) * SIZE + c] === v) movable = true;
        }
      }
      this.gameOver = !movable;
    }

    move(direction) {
      if (this.gameOver || !LANES[direction]) return false;
      const work = this.board.slice();
      let changed = false;
      let gained = 0;
      const lanes = LANES[direction];
      for (let li = 0; li < lanes.length; li++) {
        const lane = lanes[li];
        const vals = [work[lane[0]], work[lane[1]], work[lane[2]], work[lane[3]]];
        const res = compress(vals);
        if (res.changed) changed = true;
        gained += res.gained;
        for (let k = 0; k < SIZE; k++) work[lane[k]] = res.out[k];
      }
      if (!changed) return false;
      this.board = work;
      this.score += gained;
      this.moves += 1;
      this._spawn();
      this._updateStatus();
      return true;
    }
  }

  function simulate(seed, inputs, maxMoves) {
    maxMoves = maxMoves || MAX_MOVES;
    const e = new Engine(seed);
    let count = 0;
    for (const it of inputs) {
      if (e.gameOver || count >= maxMoves) break;
      const d = it && it.dir;
      if (ACTIONS.indexOf(d) === -1) continue;
      e.move(d);
      count += 1;
    }
    return {
      score: e.score, highest: e.highest, moves: e.moves,
      won: e.won, gameOver: e.gameOver,
    };
  }

  return { Engine, simulate, makeRng, ACTIONS, SIZE, TARGET };
});
