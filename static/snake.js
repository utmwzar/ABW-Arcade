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
 * Effects only read the engine (js/observe/snake.js) and keep their own clock.
 */
import { createArcade, fmt } from "./js/arcade.js";
import { crisp } from "./js/canvas.js";
import { createCanvasFx } from "./js/fx-canvas.js";
import { motion } from "./js/fx.js";
import { bindSwipe } from "./js/touch.js";
import * as observe from "./js/observe/snake.js";

const SE = window.SnakeEngine;
const COLS = SE.COLS;
const ROWS = SE.ROWS;
const W = 440, H = 440;                       // game units
const CELL = W / COLS;                        // 22

const canvas = document.getElementById("board");
const ctx = crisp(canvas, { width: W, height: H, onResize: () => draw() });
const fx = createCanvasFx({ width: W, height: H, motion });

const scoreEl = document.getElementById("score");
const lengthEl = document.getElementById("length");

// Farben aus static/css/tokens.css
const COL_BG = "#0a0816";
const COL_GRID = "rgba(255,255,255,0.04)";
const COL_BODY = "#4ad08a";
const COL_HEAD = "#8fe9b8";
const COL_FOOD = "#f06bb2";
const COL_DANGER = "#f0606b";
const CONFETTI = ["#2ccfe3", "#f7c04a", "#4ad08a", "#f06bb2", "#a98bfa"];

// Wall-clock per tick. Speeds up slightly as the snake grows. Only affects
// feel — the server replays the recorded ticks regardless of real time.
const BASE_TICK_MS = 130;
const MIN_TICK_MS = 70;
const MAX_CATCHUP = 4;
// Die Engine nimmt je Takt nur eine Richtung an. Schnelle Doppelkurven
// (hoch, dann links) warten deshalb hier und gehen Takt für Takt hinein.
const MAX_QUEUE = 3;
const REVEAL = { min: 350, max: 1000 };

let engine = null;
let recorded = [];
let tickCount = 0;
const queue = [];
let accMs = 0;
let lastFrame = 0;
let rafId = null;

const detail = (length) => `Length ${fmt(length)}`;
const local = () => ({ score: engine.score, won: engine.won, detail: detail(engine.snake.length) });

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
    fx.reset();
    syncHud();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  },
  resume() { lastFrame = performance.now(); },
  inputs: () => recorded,
  snapshot: local,
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
  ctx.fillRect(0, 0, W, H);
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
  fx.draw(ctx);
  ctx.restore();
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.score : 0);
  lengthEl.textContent = fmt(engine ? engine.snake.length : 3);
}

// ---------- effects (read-only, from js/observe/snake.js) ----------
const center = (c) => c * CELL + CELL / 2;

function react(events) {
  for (const ev of events) {
    if (ev.type === "eat") {
      fx.burst(center(ev.x), center(ev.y), {
        count: 10, color: [COL_FOOD, "#f8a1d0"], speed: [50, 170], drag: 0.05, life: [260, 480], size: [2, 4],
      });
    } else if (ev.type === "crash") {
      fx.shake(5, 320);
      fx.flash({ color: COL_DANGER, alpha: 0.22, ms: 300 });
      fx.burst(center(ev.x), center(ev.y), {
        count: 16, color: [COL_HEAD, COL_BODY], speed: [60, 220], drag: 0.04, life: [350, 650], size: [3, 5],
      });
    } else if (ev.type === "won") {
      fx.confetti(CONFETTI);
    }
  }
}

// ---------- loop (mirrors snake_engine.simulate tick order) ----------
function stepTick() {
  let dirs = null;
  if (queue.length) {
    const dir = queue.shift();
    dirs = [dir];
    recorded.push({ tick: tickCount, dir });
  }
  const before = observe.snap(engine);
  engine.tick(dirs);
  react(observe.diff(before, engine));
  tickCount++;
  syncHud();
}

function frame(now) {
  rafId = null;
  let dt = now - lastFrame;
  lastFrame = now;
  if (dt > 250) dt = 250;
  const state = arcade.state;
  if (state === "paused" || state === "confirm") { rafId = requestAnimationFrame(frame); return; }

  if (state === "playing") {
    accMs += dt;
    let steps = 0;
    const step = tickMs();
    while (accMs >= step && steps < MAX_CATCHUP && !engine.gameOver) {
      stepTick();
      accMs -= step;
      steps++;
    }
    if (engine.gameOver) arcade.over(local(), { reveal: fx.settled(REVEAL) });
  }
  fx.update(dt);
  draw();
  if (arcade.state === "playing" || fx.busy()) rafId = requestAnimationFrame(frame);
}

// ---------- input ----------
// Tastatur und Wischen gehen denselben Weg: in die Warteschlange.
function turn(dir) {
  if (!arcade.running) return;
  // Wiederholungen derselben Richtung bringen nichts und würden die Kurve verzögern.
  const last = queue.length ? queue[queue.length - 1] : engine.dir;
  if (dir !== last && queue.length < MAX_QUEUE) queue.push(dir);
}

const KEY_DIR = {
  ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
  w: "U", s: "D", a: "L", d: "R", W: "U", S: "D", A: "L", D: "R",
};

document.addEventListener("keydown", (e) => {
  if (!arcade.running || e.altKey || e.ctrlKey || e.metaKey) return;
  const dir = KEY_DIR[e.key];
  if (!dir) return;
  e.preventDefault();
  turn(dir);
});

// Wischen: Eine Berührung kann mehrmals lenken; die Schwelle wächst mit dem Feld.
bindSwipe(canvas, {
  continuous: true,
  threshold: (rect) => Math.max(18, 0.6 * rect.width / COLS),
  onSwipe: turn,
});

// ---------- init ----------
syncHud();
draw();
