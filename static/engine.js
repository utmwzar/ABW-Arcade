/*
 * Deterministic Tetris engine — no DOM, no timers.
 * Given the same (seed, inputs) it always produces the same score, so the
 * server can replay a game and compute the score itself.
 *
 * Works both in the browser (as global `TetrisEngine`) and under Node
 * (`require`) so it can be cross-checked against the Python port.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TetrisEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COLS = 10, ROWS = 20;

  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[2, 2], [2, 2]],
    T: [[0, 3, 0], [3, 3, 3], [0, 0, 0]],
    S: [[0, 4, 4], [4, 4, 0], [0, 0, 0]],
    Z: [[5, 5, 0], [0, 5, 5], [0, 0, 0]],
    J: [[6, 0, 0], [6, 6, 6], [0, 0, 0]],
    L: [[0, 0, 7], [7, 7, 7], [0, 0, 0]],
  };
  // Fixed order — the bag shuffle depends on it, so it must match the port.
  const TYPES = ["I", "O", "T", "S", "Z", "J", "L"];
  const LINE_SCORES = [0, 40, 100, 300, 1200];
  const KICKS = [0, -1, 1, -2, 2];
  const ACTIONS = ["L", "R", "ROT", "SOFT", "HARD"];

  function gravityTicks(level) {
    return Math.max(2, 32 - (level - 1) * 3);
  }

  // mulberry32, returning an unsigned 32-bit integer (no float division).
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

  const shapeMatrix = (type) => SHAPES[type].map((row) => row.slice());

  function rotateCW(m) {
    const n = m.length;
    const out = [];
    for (let i = 0; i < n; i++) out.push(new Array(n).fill(0));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x][n - 1 - y] = m[y][x];
    return out;
  }

  class Engine {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.rng = makeRng(this.seed);
      this.bag = [];
      this.grid = [];
      for (let y = 0; y < ROWS; y++) this.grid.push(new Array(COLS).fill(0));
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.gravityCounter = 0;
      this.gameOver = false;
      this.current = null;
      this.nextType = null;
      this._started = false;
    }

    _drawType() {
      if (this.bag.length === 0) {
        this.bag = TYPES.slice();
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = this.rng() % (i + 1);
          const tmp = this.bag[i];
          this.bag[i] = this.bag[j];
          this.bag[j] = tmp;
        }
      }
      return this.bag.pop();
    }

    start() {
      if (this._started) return;
      this._started = true;
      this.nextType = this._drawType();
      this._spawn();
    }

    _makePiece(type) {
      const matrix = shapeMatrix(type);
      return { type, matrix, x: Math.floor((COLS - matrix[0].length) / 2), y: 0 };
    }

    _spawn() {
      this.current = this._makePiece(this.nextType);
      this.nextType = this._drawType();
      if (this._collides(this.current)) this.gameOver = true;
    }

    _collides(p) {
      const m = p.matrix;
      for (let y = 0; y < m.length; y++) {
        for (let x = 0; x < m[y].length; x++) {
          if (!m[y][x]) continue;
          const bx = p.x + x, by = p.y + y;
          if (bx < 0 || bx >= COLS || by >= ROWS) return true;
          if (by >= 0 && this.grid[by][bx]) return true;
        }
      }
      return false;
    }

    _merge(p) {
      for (let y = 0; y < p.matrix.length; y++) {
        for (let x = 0; x < p.matrix[y].length; x++) {
          if (p.matrix[y][x] && p.y + y >= 0) this.grid[p.y + y][p.x + x] = p.matrix[y][x];
        }
      }
    }

    _clearLines() {
      let cleared = 0;
      for (let y = ROWS - 1; y >= 0; y--) {
        let full = true;
        for (let x = 0; x < COLS; x++) if (!this.grid[y][x]) { full = false; break; }
        if (full) {
          this.grid.splice(y, 1);
          this.grid.unshift(new Array(COLS).fill(0));
          cleared++;
          y++;
        }
      }
      if (cleared) {
        this.score += LINE_SCORES[cleared] * this.level;
        this.lines += cleared;
        this.level = Math.floor(this.lines / 10) + 1;
      }
    }

    _lock() {
      this._merge(this.current);
      this._clearLines();
      this.gravityCounter = 0;
      this._spawn();
    }

    // Highest y the current piece can drop to (for ghost rendering).
    ghostY() {
      if (!this.current) return 0;
      const p = { matrix: this.current.matrix, x: this.current.x, y: this.current.y };
      while (!this._collides({ matrix: p.matrix, x: p.x, y: p.y + 1 })) p.y++;
      return p.y;
    }

    applyAction(action) {
      if (this.gameOver || !this.current) return;
      const p = this.current;
      if (action === "L") {
        p.x--; if (this._collides(p)) p.x++;
      } else if (action === "R") {
        p.x++; if (this._collides(p)) p.x--;
      } else if (action === "ROT") {
        const prevMatrix = p.matrix, px = p.x;
        p.matrix = rotateCW(p.matrix);
        let ok = false;
        for (let i = 0; i < KICKS.length; i++) {
          p.x = px + KICKS[i];
          if (!this._collides(p)) { ok = true; break; }
        }
        if (!ok) { p.matrix = prevMatrix; p.x = px; }
      } else if (action === "SOFT") {
        p.y++;
        if (this._collides(p)) { p.y--; this._lock(); }
        else { this.score += 1; this.gravityCounter = 0; }
      } else if (action === "HARD") {
        let dist = 0;
        while (!this._collides(p)) { p.y++; dist++; }
        p.y--; dist--;
        if (dist > 0) this.score += dist * 2;
        this._lock();
      }
    }

    gravityStep() {
      if (this.gameOver || !this.current) return;
      this.gravityCounter++;
      if (this.gravityCounter >= gravityTicks(this.level)) {
        this.gravityCounter = 0;
        const p = this.current;
        p.y++;
        if (this._collides(p)) { p.y--; this._lock(); }
      }
    }
  }

  // Replay a recorded game. inputs: [{ tick, action }, ...]
  function simulate(seed, inputs, maxTicks) {
    maxTicks = maxTicks || 5000000;
    const e = new Engine(seed);
    e.start();
    if (e.gameOver) {
      return { score: e.score, lines: e.lines, level: e.level, gameOver: true, ticks: 0 };
    }

    const byTick = new Map();
    let lastTick = 0;
    for (const it of inputs) {
      const t = it.tick | 0;
      const a = it.action;
      if (ACTIONS.indexOf(a) === -1) continue; // ignore unknown actions
      if (t > lastTick) lastTick = t;
      if (!byTick.has(t)) byTick.set(t, []);
      byTick.get(t).push(a);
    }

    const endTick = lastTick + 100000; // let gravity finish after the last input
    let tick = 0;
    while (!e.gameOver && tick <= endTick && tick <= maxTicks) {
      const acts = byTick.get(tick);
      if (acts) {
        for (const a of acts) { e.applyAction(a); if (e.gameOver) break; }
      }
      if (e.gameOver) break;
      e.gravityStep();
      tick++;
    }
    return { score: e.score, lines: e.lines, level: e.level, gameOver: e.gameOver, ticks: tick };
  }

  return { Engine, simulate, gravityTicks, makeRng, COLS, ROWS, TYPES, SHAPES, ACTIONS };
});
