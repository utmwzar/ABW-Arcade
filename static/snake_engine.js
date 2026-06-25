/*
 * Deterministic Snake engine — shared by the browser (gameplay) and the server
 * (replay). The full game is a pure function of (seed, direction inputs): the
 * server re-simulates it and computes the authoritative score, so the client
 * never submits a score.
 *
 * Inputs are direction changes recorded as { tick, dir } with dir in U/D/L/R.
 * Per tick: apply the first non-reversing queued direction, then move one cell.
 *
 * UMD wrapper: browser global `SnakeEngine`, or require() under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnakeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COLS = 20, ROWS = 20;
  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const OPP = { U: "D", D: "U", L: "R", R: "L" };
  const ACTIONS = ["U", "D", "L", "R"];

  // mulberry32 returning an unsigned 32-bit integer (mirrors snake_engine.py).
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

  class Engine {
    constructor(seed, cols, rows) {
      this.cols = cols || COLS;
      this.rows = rows || ROWS;
      this.rng = makeRng(seed >>> 0);
      const cx = Math.floor(this.cols / 2), cy = Math.floor(this.rows / 2);
      this.snake = [[cx, cy], [cx - 1, cy], [cx - 2, cy]];  // head first
      this.dir = "R";
      this.score = 0;
      this.gameOver = false;
      this.won = false;
      this.food = null;
      this._spawnFood();
    }

    _occ() {
      const s = new Set();
      for (const c of this.snake) s.add(c[0] + "," + c[1]);
      return s;
    }

    _spawnFood() {
      const occ = this._occ();
      const empty = this.cols * this.rows - occ.size;
      if (empty <= 0) { this.food = null; this.gameOver = true; this.won = true; return; }
      let r = this.rng() % empty;            // pick the r-th empty cell, row-major
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (!occ.has(x + "," + y)) {
            if (r === 0) { this.food = [x, y]; return; }
            r--;
          }
        }
      }
    }

    head() { return this.snake[0]; }

    tick(dirs) {
      if (this.gameOver) return;
      if (dirs && dirs.length) {
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i];
          if (DIRS[d] && d !== OPP[this.dir]) { this.dir = d; break; }
        }
      }
      const h = this.snake[0], dv = DIRS[this.dir];
      const nx = h[0] + dv[0], ny = h[1] + dv[1];
      if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) { this.gameOver = true; return; }
      const eating = this.food && nx === this.food[0] && ny === this.food[1];
      const occ = this._occ();
      if (!eating) {
        const tail = this.snake[this.snake.length - 1];
        occ.delete(tail[0] + "," + tail[1]);   // tail vacates this step
      }
      if (occ.has(nx + "," + ny)) { this.gameOver = true; return; }
      this.snake.unshift([nx, ny]);
      if (eating) { this.score += 1; this._spawnFood(); }
      else { this.snake.pop(); }
    }
  }

  // Replay a recorded game. inputs: [{ tick, dir }, ...]
  function simulate(seed, inputs, maxTicks) {
    maxTicks = maxTicks || 2000000;
    const e = new Engine(seed);
    const byTick = new Map();
    let lastTick = 0;
    for (const it of inputs) {
      const t = it.tick | 0;
      const d = it.dir;
      if (ACTIONS.indexOf(d) === -1 || t < 0) continue;
      if (t > lastTick) lastTick = t;
      if (!byTick.has(t)) byTick.set(t, []);
      byTick.get(t).push(d);
    }
    // After the last input the snake travels straight and dies within the
    // board span, so this padding is always enough to reach game over.
    const endTick = lastTick + 2000;
    let tick = 0;
    while (!e.gameOver && tick <= endTick && tick <= maxTicks) {
      e.tick(byTick.get(tick));
      tick++;
    }
    return { score: e.score, length: e.snake.length, gameOver: e.gameOver, won: e.won, ticks: tick };
  }

  return { Engine, simulate, makeRng, COLS, ROWS, DIRS, OPP, ACTIONS };
});
