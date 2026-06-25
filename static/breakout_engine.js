/*
 * Deterministic Breakout engine — shared by the browser (gameplay) and the
 * server (replay). The whole simulation is INTEGER-only (no floats, no sqrt /
 * trig), so JS and Python produce bit-identical results and the server can
 * recompute the authoritative score from the recorded paddle inputs.
 *
 * Inputs are paddle direction changes recorded as { tick, dir }, dir in:
 *   L = move left, R = move right, S = stop.
 * Per tick: apply queued direction(s), move paddle, move ball, resolve walls /
 * paddle / one brick, then check win / life loss.
 *
 * UMD wrapper: browser global `BreakoutEngine`, or require() under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BreakoutEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const W = 440, H = 520;
  const COLS = 10, ROWS = 5;
  const MARGIN = 12, TOP = 50, BW = 38, BH = 18, GAP = 4;
  const PADDLE_W = 72, PADDLE_H = 12, PADDLE_Y = H - 34, PADDLE_SPEED = 6;
  const BALL_R = 5, BALL_VY = 3;
  const START_LIVES = 3;
  const MAX_TICKS = 500000;
  const ACTIONS = ["L", "R", "S"];

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
    constructor(seed) {
      this.w = W; this.h = H;
      this.cols = COLS; this.rows = ROWS;
      this.paddleW = PADDLE_W; this.paddleH = PADDLE_H; this.paddleY = PADDLE_Y;
      this.ballR = BALL_R;
      this.rng = makeRng(seed >>> 0);

      this.bricks = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          this.bricks.push({
            x: MARGIN + c * (BW + GAP), y: TOP + r * (BH + GAP),
            w: BW, h: BH, alive: true, points: ROWS - r, row: r,
          });
        }
      }
      this.aliveCount = COLS * ROWS;
      this.paddleX = (W - PADDLE_W) >> 1;
      this.paddleDir = 0;
      this.score = 0;
      this.lives = START_LIVES;
      this.bricksBroken = 0;
      this.gameOver = false;
      this.won = false;
      this._serve();
    }

    _serve() {
      this.bx = this.paddleX + (PADDLE_W >> 1);
      this.by = PADDLE_Y - BALL_R - 1;
      const s = (this.rng() & 1) ? 1 : -1;   // deterministic serve direction
      this.vx = 2 * s;
      this.vy = -BALL_VY;
    }

    tick(events) {
      if (this.gameOver) return;

      if (events && events.length) {
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          if (e === "L") this.paddleDir = -1;
          else if (e === "R") this.paddleDir = 1;
          else if (e === "S") this.paddleDir = 0;
        }
      }

      this.paddleX += this.paddleDir * PADDLE_SPEED;
      if (this.paddleX < 0) this.paddleX = 0;
      if (this.paddleX > W - PADDLE_W) this.paddleX = W - PADDLE_W;

      this.bx += this.vx;
      this.by += this.vy;

      if (this.bx - BALL_R < 0) { this.bx = BALL_R; this.vx = -this.vx; }
      if (this.bx + BALL_R > W) { this.bx = W - BALL_R; this.vx = -this.vx; }
      if (this.by - BALL_R < 0) { this.by = BALL_R; this.vy = -this.vy; }

      const pTop = PADDLE_Y;
      if (this.vy > 0 && this.by + BALL_R >= pTop && this.by - BALL_R <= pTop + PADDLE_H &&
          this.bx + BALL_R >= this.paddleX && this.bx - BALL_R <= this.paddleX + PADDLE_W) {
        this.by = pTop - BALL_R;
        this.vy = -BALL_VY;
        const rel = this.bx - (this.paddleX + (PADDLE_W >> 1));
        if (rel < -25) this.vx = -3;
        else if (rel < -9) this.vx = -2;
        else if (rel <= 9) this.vx = this.vx >= 0 ? 1 : -1;
        else if (rel <= 25) this.vx = 2;
        else this.vx = 3;
      }

      for (let i = 0; i < this.bricks.length; i++) {
        const b = this.bricks[i];
        if (!b.alive) continue;
        if (this.bx + BALL_R > b.x && this.bx - BALL_R < b.x + b.w &&
            this.by + BALL_R > b.y && this.by - BALL_R < b.y + b.h) {
          b.alive = false;
          this.aliveCount--;
          this.bricksBroken++;
          this.score += b.points;
          const prevX = this.bx - this.vx, prevY = this.by - this.vy;
          const wasVert = (prevY + BALL_R <= b.y) || (prevY - BALL_R >= b.y + b.h);
          const wasHoriz = (prevX + BALL_R <= b.x) || (prevX - BALL_R >= b.x + b.w);
          if (wasHoriz && !wasVert) this.vx = -this.vx;
          else this.vy = -this.vy;
          break;
        }
      }

      if (this.aliveCount <= 0) { this.gameOver = true; this.won = true; return; }

      if (this.by - BALL_R > H) {
        this.lives--;
        if (this.lives <= 0) { this.gameOver = true; return; }
        this._serve();
      }
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
    return {
      score: e.score, bricks: e.bricksBroken, lives: e.lives,
      gameOver: e.gameOver, won: e.won, ticks: tick,
    };
  }

  return {
    Engine, simulate, makeRng, ACTIONS,
    W, H, COLS, ROWS, MARGIN, TOP, BW, BH, GAP,
    PADDLE_W, PADDLE_H, PADDLE_Y, PADDLE_SPEED, BALL_R, START_LIVES,
  };
});
