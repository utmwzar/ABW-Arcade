/*
 * Tetris frontend.
 * All game RULES live in tetris_engine.js (shared with the server). This file only
 * does rendering, input and the fixed-timestep loop, and it RECORDS every
 * input as { tick, action }. On game over it posts the recorded log to the
 * server, which replays it and computes the authoritative score. The client
 * never sends a score. Start, pause and the result screen: js/arcade.js.
 *
 * The loop must match tetris_engine.simulate() exactly: for each tick we first apply
 * the inputs recorded at that tick, then one gravityStep, then advance.
 * Effects only read the engine (js/observe/tetris.js) and keep their own clock.
 */
import { createArcade, fmt } from "./js/arcade.js";
import { crisp } from "./js/canvas.js";
import { createCanvasFx } from "./js/fx-canvas.js";
import { motion } from "./js/fx.js";
import { bindTetris } from "./js/touch.js";
import * as observe from "./js/observe/tetris.js";

const TE = window.TetrisEngine;
const CELL = 30;
const COLS = TE.COLS;
const ROWS = TE.ROWS;
const W = COLS * CELL;   // 300 x 600 game units
const H = ROWS * CELL;
const NEXT = 120;

// Farben aus static/css/tokens.css; L bleibt wie gewohnt orange.
const COLORS = {
  1: "#2ccfe3", 2: "#f7c04a", 3: "#a98bfa", 4: "#4ad08a",
  5: "#f0606b", 6: "#6c8cff", 7: "#f6a35f",
};
const COL_GRID = "rgba(255,255,255,0.04)";
const COL_TEXT = "#eeeafe";
const COL_DANGER = "#f0606b";

// Wall-clock per logical tick. Only affects feel/speed, not correctness:
// the server replays the recorded ticks regardless of real time.
const TICK_MS = 20;
const MAX_CATCHUP = 6; // cap ticks processed per frame (avoid stall spirals)
const REVEAL = { min: 350, max: 1000 };   // Ergebniskarte nach den Effekten

const canvas = document.getElementById("board");
const nextCanvas = document.getElementById("next");
const ctx = crisp(canvas, { width: W, height: H, onResize: () => draw() });
const nctx = crisp(nextCanvas, { width: NEXT, height: NEXT, onResize: () => drawNext() });
const fx = createCanvasFx({ width: W, height: H, motion });
const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");

let engine = null;
let recorded = [];
let tickCount = 0;
// { action, piece }: piece ist bei Gesten der Stein, auf dem sie begann.
const pending = [];
let accMs = 0;
let lastFrame = 0;
let rafId = null;

const detail = (lines, level) => `${fmt(lines)} Lines · Level ${level}`;
const local = () => ({ score: engine.score, detail: detail(engine.lines, engine.level) });

const arcade = createArcade({
  slug: "tetris",
  startUrl: "/api/game/start",
  finishUrl: "/api/game/finish",
  canPause: true,
  begin(data) {
    engine = new TE.Engine(data.seed >>> 0);
    engine.start();
    recorded = [];
    tickCount = 0;
    pending.length = 0;
    accMs = 0;
    lastFrame = performance.now();
    fx.reset();
    syncHud();
    drawNext();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  },
  resume() { lastFrame = performance.now(); },
  inputs: () => recorded,
  ticks: () => tickCount,
  snapshot: local,
  detail: (d) => detail(d.lines, d.level),
  sync(d) {
    scoreEl.textContent = fmt(d.score);
    linesEl.textContent = fmt(d.lines);
    levelEl.textContent = d.level;
  },
});

// ---------- rendering ----------
function drawCell(c, x, y, colorId, size = CELL) {
  const px = x * size, py = y * size;
  c.fillStyle = COLORS[colorId];
  c.fillRect(px + 1, py + 1, size - 2, size - 2);
  c.fillStyle = "rgba(255,255,255,0.22)";
  c.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.12));
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  fx.applyShake(ctx);

  ctx.strokeStyle = COL_GRID;
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, H); ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(W, y * CELL + 0.5); ctx.stroke();
  }

  if (engine) {
    const grid = engine.grid;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (grid[y][x]) drawCell(ctx, x, y, grid[y][x]);
    }

    const cur = engine.current;
    if (cur && !engine.gameOver) {
      const gy = engine.ghostY();
      ctx.globalAlpha = 0.18;
      cur.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v) drawCell(ctx, cur.x + x, gy + y, v);
      }));
      ctx.globalAlpha = 1;
      cur.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v && cur.y + y >= 0) drawCell(ctx, cur.x + x, cur.y + y, v);
      }));
    }
  }
  fx.draw(ctx);
  ctx.restore();
}

function drawNext() {
  nctx.clearRect(0, 0, NEXT, NEXT);
  if (!engine || !engine.nextType) return;
  const m = TE.SHAPES[engine.nextType], size = 24;
  let minX = 99, maxX = -1, minY = 99, maxY = -1;
  m.forEach((row, y) => row.forEach((v, x) => {
    if (v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }));
  const offX = (NEXT - (maxX - minX + 1) * size) / 2;
  const offY = (NEXT - (maxY - minY + 1) * size) / 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!m[y][x]) continue;
      const px = offX + (x - minX) * size, py = offY + (y - minY) * size;
      nctx.fillStyle = COLORS[m[y][x]];
      nctx.fillRect(px + 1, py + 1, size - 2, size - 2);
      nctx.fillStyle = "rgba(255,255,255,0.22)";
      nctx.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.12));
    }
  }
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.score : 0);
  linesEl.textContent = fmt(engine ? engine.lines : 0);
  levelEl.textContent = engine ? engine.level : 1;
}

// ---------- effects (read-only, from js/observe/tetris.js) ----------
function react(events) {
  for (const ev of events) {
    if (ev.type === "drop") {
      // Spur je Spalte vom Start bis zur Landung.
      const dist = ev.to - ev.from;
      const top = new Map();
      for (const [x, y, v] of ev.cells) {
        if (!top.has(x) || y < top.get(x)[0]) top.set(x, [y, v]);
      }
      for (const [x, [y, v]] of top) {
        fx.trail({ x: x * CELL + 4, y: (y - dist) * CELL, w: CELL - 8, h: dist * CELL, color: COLORS[v], alpha: 0.22, ms: 180 });
      }
    } else if (ev.type === "clear") {
      fx.flash({ rects: ev.rows.map((r) => ({ x: 0, y: r.y * CELL, w: W, h: CELL })), color: COL_TEXT, alpha: 0.5, ms: 220 });
      for (const row of ev.rows) {
        row.cells.forEach((v, x) => {
          fx.burst(x * CELL + CELL / 2, row.y * CELL + CELL / 2, {
            count: 3, color: COLORS[v], angle: x < COLS / 2 ? Math.PI : 0, spread: 1.8,
            speed: [60, 240], gravity: 420, life: [350, 650], size: [3, 5],
          });
        });
      }
      if (ev.rows.length === 4) {
        // in der Farbe des I-Steins, mit dem ein Tetris meist gelingt; Gold bleibt dem Highscore
        fx.text(W / 2, H * 0.42, "TETRIS", { color: COLORS[1], size: 24 });
        fx.shake(3, 220);
      }
    } else if (ev.type === "level") {
      fx.text(W / 2, H * 0.3, `LEVEL ${ev.level}`, { color: COL_TEXT, size: 16 });
    } else if (ev.type === "over") {
      fx.shake(5, 360);
      fx.flash({ color: COL_DANGER, alpha: 0.22, ms: 320 });
    }
  }
}

// ---------- loop (mirrors tetris_engine.simulate tick order) ----------
function stepTick() {
  if (pending.length) {
    for (let i = 0; i < pending.length; i++) {
      const { action, piece } = pending[i];
      // Eine Geste gilt dem Stein, auf dem sie begann. Liegt er schon, verfällt
      // sie, statt den nächsten Stein zu treffen. Aufgezeichnet wird nur, was
      // die Engine bekommt.
      if (piece && piece !== engine.current) continue;
      recorded.push({ tick: tickCount, action });
      const before = observe.snap(engine);
      engine.applyAction(action);
      react(observe.diff(before, engine, action));
      if (engine.gameOver) break;
    }
    pending.length = 0;
  }
  if (engine.gameOver) return;
  const before = observe.snap(engine);
  engine.gravityStep();
  react(observe.diff(before, engine, null));
  tickCount++;
  syncHud();
}

function frame(now) {
  rafId = null;
  let dt = now - lastFrame;
  lastFrame = now;
  if (dt > 250) dt = 250;        // ignore huge gaps (tab was backgrounded)
  const state = arcade.state;
  if (state === "paused" || state === "confirm") { rafId = requestAnimationFrame(frame); return; }

  if (state === "playing") {
    accMs += dt;
    let steps = 0;
    while (accMs >= TICK_MS && steps < MAX_CATCHUP && !engine.gameOver) {
      stepTick();
      accMs -= TICK_MS;
      steps++;
    }
    if (engine.gameOver) {
      syncHud();
      arcade.over(local(), { reveal: fx.settled(REVEAL) });
    }
  }
  fx.update(dt);
  drawNext();
  draw();
  // Nach dem Game Over läuft das Bild weiter, bis die Effekte durch sind.
  if (arcade.state === "playing" || fx.busy()) rafId = requestAnimationFrame(frame);
}

// ---------- input ----------
const KEY_ACTION = {
  ArrowLeft: "L", ArrowRight: "R", ArrowUp: "ROT", ArrowDown: "SOFT", " ": "HARD",
};

document.addEventListener("keydown", (e) => {
  if (!arcade.running || e.altKey || e.ctrlKey || e.metaKey) return;
  const action = KEY_ACTION[e.key];
  if (action) {
    e.preventDefault();
    pending.push({ action, piece: null });   // applied at the next tick (deterministic)
  }
});

// Touch: Tippen dreht, Ziehen bewegt, nach unten wischen legt ab (js/touch.js).
let gesturePiece = null;
bindTetris(canvas, {
  cols: COLS,
  onStart() { gesturePiece = engine && engine.current; },
  onAction(action) {
    if (arcade.running && gesturePiece) pending.push({ action, piece: gesturePiece });
  },
});

// ---------- init ----------
syncHud();
draw();
