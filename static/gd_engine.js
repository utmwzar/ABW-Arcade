/*
 * Deterministic Geometry-Dash engine — shared by the browser (gameplay) and the
 * server (replay). The whole simulation is INTEGER fixed-point (no floats, no
 * sqrt / trig, no division in the loop), so JS and Python produce bit-identical
 * results and the server can recompute the authoritative distance from the
 * recorded jump inputs. The cube's cosmetic spin lives only in the renderer and
 * never feeds back into collision.
 *
 * The single button is recorded as toggle events { tick, dir }, dir in:
 *   D = press/hold down, U = release.
 * Per tick: apply queued toggles; if held and grounded -> jump; gravity; move;
 * resolve floor / block landing / lethal hits.
 *
 * UMD wrapper: browser global `GDEngine`, or require() under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GDEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CELL = 100;
  const SPEED = 14;
  const GRAVITY = 4;
  const JUMP_V = 52;
  const CUBE = CELL;

  const SPIKE_INSET = 22;
  const SPIKE_H = 56;

  const START_RUNWAY = 8;
  const MIN_GAP = 5;

  const MAX_TICKS = 36000;
  const GEN_CELLS = Math.floor((MAX_TICKS * SPEED) / CELL) + 32;

  const ACTIONS = ["D", "U"];

  const SPIKE = 0, BLOCK = 1;

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

  function buildLevel(seed) {
    const rng = makeRng(seed >>> 0);
    const obs = [];
    let cell = START_RUNWAY;
    while (cell < GEN_CELLS) {
      const extra = 6 - Math.floor((cell * 6) / GEN_CELLS);
      const gap = MIN_GAP + extra + (rng() % 3);
      cell += gap;
      if (cell >= GEN_CELLS) break;

      const pct = Math.floor((cell * 100) / GEN_CELLS);
      const roll = rng() % 100;
      const x0 = cell * CELL;

      if (roll < 45) {
        obs.push({ kind: SPIKE, x0: x0 + SPIKE_INSET, x1: x0 + CELL - SPIKE_INSET, top: SPIKE_H });
        cell += 1;
      } else if (roll < 60 + Math.floor(pct / 5)) {
        obs.push({ kind: SPIKE, x0: x0 + SPIKE_INSET, x1: x0 + 2 * CELL - SPIKE_INSET, top: SPIKE_H });
        cell += 2;
      } else if (roll < 85) {
        obs.push({ kind: BLOCK, x0: x0, x1: x0 + CELL, top: CELL });
        cell += 1;
      } else {
        const h = pct > 25 ? 2 : 1;
        obs.push({ kind: BLOCK, x0: x0, x1: x0 + CELL, top: h * CELL });
        cell += 1;
      }
    }
    return obs;
  }

  class Engine {
    constructor(seed) {
      this.cell = CELL;
      this.cube = CUBE;
      this.speed = SPEED;
      this.rng = makeRng(seed >>> 0);   // kept for ctor parity with Python
      this.obstacles = buildLevel(seed);

      this.tickCount = 0;
      this.worldX = 0;                  // cube left edge in world fp
      this.y = 0;                       // cube BOTTOM above the floor (up = +)
      this.vy = 0;
      this.onGround = true;
      this.held = false;
      this.cells = 0;                   // distance in whole cells (= score)
      this.gameOver = false;
      this.won = false;
    }

    tick(events) {
      if (this.gameOver) return;

      if (events && events.length) {
        for (let i = 0; i < events.length; i++) {
          if (events[i] === "D") this.held = true;
          else if (events[i] === "U") this.held = false;
        }
      }

      if (this.held && this.onGround) {
        this.vy = JUMP_V;
        this.onGround = false;
      }

      const prevBottom = this.y;
      this.vy -= GRAVITY;
      this.y += this.vy;
      this.worldX += SPEED;
      this.tickCount++;

      const cx0 = this.worldX;
      const cx1 = this.worldX + CUBE;
      const cyt = this.y + CUBE;

      let support = 0;
      let lethal = false;
      for (let i = 0; i < this.obstacles.length; i++) {
        const ob = this.obstacles[i];
        if (ob.x1 <= cx0 || ob.x0 >= cx1) continue;
        const top = ob.top;
        if (ob.kind === SPIKE) {
          if (this.y < top && cyt > 0) lethal = true;
        } else {
          if (prevBottom >= top) {
            if (top > support) support = top;
          } else if (this.y < top && cyt > 0) {
            lethal = true;
          }
        }
      }

      if (lethal) {
        this.gameOver = true;
        this._finalize();
        return;
      }

      if (this.vy <= 0 && this.y <= support) {
        this.y = support;
        this.vy = 0;
        this.onGround = true;
      } else {
        this.onGround = (this.y === support);
      }

      if (this.worldX >= GEN_CELLS * CELL) {
        this.gameOver = true;
        this.won = true;
      }

      this._finalize();
    }

    _finalize() {
      const c = Math.floor(this.worldX / CELL);
      if (c > this.cells) this.cells = c;
    }
  }

  function simulate(seed, inputs, maxTicks) {
    maxTicks = maxTicks || MAX_TICKS;
    const e = new Engine(seed);
    const byTick = new Map();
    for (const it of inputs) {
      const t = it.tick | 0;
      const d = it.dir;
      if (ACTIONS.indexOf(d) === -1 || t < 0) continue;
      if (!byTick.has(t)) byTick.set(t, []);
      byTick.get(t).push(d);
    }
    let tick = 0;
    while (!e.gameOver && tick <= maxTicks) {
      e.tick(byTick.get(tick));
      tick++;
    }
    return { score: e.cells, cells: e.cells, ticks: tick, gameOver: e.gameOver, won: e.won };
  }

  return {
    Engine, simulate, makeRng, ACTIONS,
    CELL, SPEED, GRAVITY, JUMP_V, CUBE, SPIKE_INSET, SPIKE_H,
    START_RUNWAY, MIN_GAP, MAX_TICKS, GEN_CELLS, SPIKE, BLOCK,
  };
});
