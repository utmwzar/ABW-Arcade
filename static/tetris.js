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
 */
import { createArcade, fmt } from "./js/arcade.js";

const TE = window.TetrisEngine;
const CELL = 30;
const COLS = TE.COLS;
const ROWS = TE.ROWS;

// Farben aus static/css/tokens.css; L bleibt wie gewohnt orange.
const COLORS = {
  1: "#2ccfe3", 2: "#f7c04a", 3: "#a98bfa", 4: "#4ad08a",
  5: "#f0606b", 6: "#6c8cff", 7: "#f6a35f",
};
const COL_GRID = "rgba(255,255,255,0.04)";

// Wall-clock per logical tick. Only affects feel/speed, not correctness:
// the server replays the recorded ticks regardless of real time.
const TICK_MS = 20;
const MAX_CATCHUP = 6; // cap ticks processed per frame (avoid stall spirals)

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nctx = nextCanvas.getContext("2d");
const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");

let engine = null;
let recorded = [];
let tickCount = 0;
const pending = [];
let accMs = 0;
let lastFrame = 0;
let rafId = null;

const detail = (lines, level) => `${fmt(lines)} Lines · Level ${level}`;

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
    syncHud();
    drawNext();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  },
  resume() { lastFrame = performance.now(); },
  inputs: () => recorded,
  snapshot: () => ({ score: engine.score, detail: detail(engine.lines, engine.level) }),
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = COL_GRID;
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, canvas.height); ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(canvas.width, y * CELL + 0.5); ctx.stroke();
  }

  if (!engine) return;

  const grid = engine.grid;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) if (grid[y][x]) drawCell(ctx, x, y, grid[y][x]);
  }

  const cur = engine.current;
  if (cur) {
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

function drawNext() {
  nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!engine || !engine.nextType) return;
  const m = TE.SHAPES[engine.nextType], size = 24;
  let minX = 99, maxX = -1, minY = 99, maxY = -1;
  m.forEach((row, y) => row.forEach((v, x) => {
    if (v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }));
  const offX = (nextCanvas.width - (maxX - minX + 1) * size) / 2;
  const offY = (nextCanvas.height - (maxY - minY + 1) * size) / 2;
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

// ---------- loop (mirrors tetris_engine.simulate tick order) ----------
function stepTick() {
  if (pending.length) {
    for (let i = 0; i < pending.length; i++) {
      recorded.push({ tick: tickCount, action: pending[i] });
      engine.applyAction(pending[i]);
      if (engine.gameOver) break;
    }
    pending.length = 0;
  }
  if (engine.gameOver) return;
  engine.gravityStep();
  tickCount++;
  syncHud();
}

function frame(now) {
  const state = arcade.state;
  if (state === "paused" || state === "confirm") { lastFrame = now; rafId = requestAnimationFrame(frame); return; }
  if (state !== "playing") return;

  let dt = now - lastFrame;
  lastFrame = now;
  if (dt > 250) dt = 250;        // ignore huge gaps (tab was backgrounded)
  accMs += dt;

  let steps = 0;
  while (accMs >= TICK_MS && steps < MAX_CATCHUP && !engine.gameOver) {
    stepTick();
    accMs -= TICK_MS;
    steps++;
  }
  drawNext();
  draw();

  if (engine.gameOver) {
    arcade.over({ score: engine.score, detail: detail(engine.lines, engine.level) });
    return;
  }
  rafId = requestAnimationFrame(frame);
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
    pending.push(action);   // applied at the next tick (deterministic)
  }
});

// ---------- init ----------
syncHud();
draw();
