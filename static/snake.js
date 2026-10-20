/*
 * Snake frontend.
 * All game RULES live in snake_engine.js (shared with the server). This file
 * does rendering, input and the fixed-timestep loop, and RECORDS every
 * direction change as { tick, dir }. On game over it posts the recorded log to
 * the server, which replays it and computes the authoritative score. The
 * client never sends a score. Start, pause and the result screen: js/arcade.js.
 *
 * The loop matches snake_engine.simulate() exactly: per tick we pass the
 * direction recorded at that tick to engine.tick(), then advance.
 */
import { createArcade, fmt } from "./js/arcade.js";

const SE = window.SnakeEngine;
const COLS = SE.COLS;
const ROWS = SE.ROWS;

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const CELL = canvas.width / COLS;            // 440 / 20 = 22

const scoreEl = document.getElementById("score");
const lengthEl = document.getElementById("length");

// Farben aus static/css/tokens.css
const COL_BG = "#0a0816";
const COL_GRID = "rgba(255,255,255,0.04)";
const COL_BODY = "#4ad08a";
const COL_HEAD = "#8fe9b8";
const COL_FOOD = "#f06bb2";

// Wall-clock per tick. Speeds up slightly as the snake grows. Only affects
// feel — the server replays the recorded ticks regardless of real time.
const BASE_TICK_MS = 130;
const MIN_TICK_MS = 70;
const MAX_CATCHUP = 4;
// Die Engine nimmt je Takt nur eine Richtung an. Schnelle Doppelkurven
// (hoch, dann links) warten deshalb hier und gehen Takt für Takt hinein.
const MAX_QUEUE = 3;

let engine = null;
let recorded = [];
let tickCount = 0;
const queue = [];
let accMs = 0;
let lastFrame = 0;
let rafId = null;

const detail = (length) => `Length ${fmt(length)}`;

const arcade = createArcade({
  slug: "snake",
  startUrl: "/api/snake/start",
  finishUrl: "/api/snake/finish",
  canPause: true,
  begin(data) {
    engine = new SE.Engine(data.seed >>> 0);
    recorded = [];
    tickCount = 0;
    queue.length = 0;
    accMs = 0;
    lastFrame = performance.now();
    syncHud();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  },
  resume() { lastFrame = performance.now(); },
  inputs: () => recorded,
  snapshot: () => ({ score: engine.score, won: engine.won, detail: detail(engine.snake.length) }),
  detail: (d) => detail(d.length),
  sync(d) {
    scoreEl.textContent = fmt(d.score);
    lengthEl.textContent = fmt(d.length);
  },
});

function tickMs() {
  if (!engine) return BASE_TICK_MS;
  return Math.max(MIN_TICK_MS, BASE_TICK_MS - engine.score * 3);
}

// ---------- rendering ----------
function cell(x, y, color, inset) {
  ctx.fillStyle = color;
  ctx.fillRect(x * CELL + inset, y * CELL + inset, CELL - 2 * inset, CELL - 2 * inset);
}

function draw() {
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = COL_GRID;
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, canvas.height); ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(canvas.width, y * CELL + 0.5); ctx.stroke();
  }

  if (!engine) return;

  if (engine.food) {
    ctx.fillStyle = COL_FOOD;
    ctx.beginPath();
    ctx.arc(engine.food[0] * CELL + CELL / 2, engine.food[1] * CELL + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const s = engine.snake;
  for (let i = s.length - 1; i >= 0; i--) {
    cell(s[i][0], s[i][1], i === 0 ? COL_HEAD : COL_BODY, i === 0 ? 1 : 2);
  }
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.score : 0);
  lengthEl.textContent = fmt(engine ? engine.snake.length : 3);
}

// ---------- loop (mirrors snake_engine.simulate tick order) ----------
function stepTick() {
  let dirs = null;
  if (queue.length) {
    const dir = queue.shift();
    dirs = [dir];
    recorded.push({ tick: tickCount, dir });
  }
  engine.tick(dirs);
  tickCount++;
  syncHud();
}

function frame(now) {
  const state = arcade.state;
  if (state === "paused" || state === "confirm") { lastFrame = now; rafId = requestAnimationFrame(frame); return; }
  if (state !== "playing") return;

  let dt = now - lastFrame;
  lastFrame = now;
  if (dt > 250) dt = 250;
  accMs += dt;

  let steps = 0;
  const step = tickMs();
  while (accMs >= step && steps < MAX_CATCHUP && !engine.gameOver) {
    stepTick();
    accMs -= step;
    steps++;
  }
  draw();
  if (engine.gameOver) {
    arcade.over({ score: engine.score, won: engine.won, detail: detail(engine.snake.length) });
    return;
  }
  rafId = requestAnimationFrame(frame);
}

// ---------- input ----------
const KEY_DIR = {
  ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
  w: "U", s: "D", a: "L", d: "R", W: "U", S: "D", A: "L", D: "R",
};

document.addEventListener("keydown", (e) => {
  if (!arcade.running || e.altKey || e.ctrlKey || e.metaKey) return;
  const dir = KEY_DIR[e.key];
  if (!dir) return;
  e.preventDefault();
  // Wiederholungen derselben Richtung bringen nichts und würden die Kurve verzögern.
  const last = queue.length ? queue[queue.length - 1] : engine.dir;
  if (dir !== last && queue.length < MAX_QUEUE) queue.push(dir);
});

// ---------- init ----------
syncHud();
draw();
