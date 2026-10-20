/*
 * Breakout frontend.
 * All game RULES live in breakout_engine.js (shared with the server). This file
 * does rendering, input and the fixed-timestep loop, and RECORDS every paddle
 * direction change as { tick, dir }. On game over it posts the recorded log to
 * the server, which replays it and computes the authoritative score. The
 * client never sends a score. Start, pause and the result screen: js/arcade.js.
 */
import { createArcade, fmt } from "./js/arcade.js";

const BE = window.BreakoutEngine;
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");

// Farben aus static/css/tokens.css; Steinreihen von oben nach unten
const COL_BG = "#0a0816";
const COL_PADDLE = "#eeeafe";
const COL_BALL = "#eeeafe";
const ROW_COLORS = ["#f06bb2", "#a98bfa", "#6c8cff", "#2ccfe3", "#4ad08a"];

const TICK_MS = 16;          // ~60 ticks/s; server replays ticks regardless
const MAX_CATCHUP = 5;

let engine = null;
let recorded = [];
let tickCount = 0;
let pendingDir = null;       // latest paddle dir not yet committed to a tick
let lastDir = "S";
let accMs = 0;
let lastFrame = 0;
let rafId = null;
const held = { left: false, right: false };

const detail = (bricks) => `${fmt(bricks)} ${bricks === 1 ? "Stein" : "Steine"} abgeräumt`;

const arcade = createArcade({
  slug: "breakout",
  startUrl: "/api/breakout/start",
  finishUrl: "/api/breakout/finish",
  canPause: true,
  begin(data) {
    engine = new BE.Engine(data.seed >>> 0);
    recorded = [];
    tickCount = 0;
    pendingDir = null;
    lastDir = "S";
    held.left = held.right = false;
    accMs = 0;
    lastFrame = performance.now();
    syncHud();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  },
  resume() { lastFrame = performance.now(); },
  inputs: () => recorded,
  snapshot: () => ({ score: engine.score, won: engine.won, detail: detail(engine.bricksBroken) }),
  detail: (d) => detail(d.bricks),
  sync(d) { scoreEl.textContent = fmt(d.score); },
});

// ---------- rendering ----------
function draw() {
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!engine) return;

  for (let i = 0; i < engine.bricks.length; i++) {
    const b = engine.bricks[i];
    if (!b.alive) continue;
    ctx.fillStyle = ROW_COLORS[b.row % ROW_COLORS.length];
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(b.x, b.y, b.w, 3);
  }

  ctx.fillStyle = COL_PADDLE;
  ctx.fillRect(engine.paddleX, engine.paddleY, engine.paddleW, engine.paddleH);

  ctx.fillStyle = COL_BALL;
  ctx.beginPath();
  ctx.arc(engine.bx, engine.by, engine.ballR, 0, Math.PI * 2);
  ctx.fill();
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.score : 0);
  livesEl.textContent = engine ? engine.lives : 3;
}

// ---------- loop (mirrors breakout_engine.simulate tick order) ----------
function stepTick() {
  let dirs = null;
  if (pendingDir !== null) {
    dirs = [pendingDir];
    recorded.push({ tick: tickCount, dir: pendingDir });
    pendingDir = null;
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
  while (accMs >= TICK_MS && steps < MAX_CATCHUP && !engine.gameOver) {
    stepTick();
    accMs -= TICK_MS;
    steps++;
  }
  draw();
  if (engine.gameOver) {
    arcade.over({ score: engine.score, won: engine.won, detail: detail(engine.bricksBroken) });
    return;
  }
  rafId = requestAnimationFrame(frame);
}

// turn the held keys into a paddle direction, queue it if it changed
function updateDir() {
  let dir = "S";
  if (held.left && !held.right) dir = "L";
  else if (held.right && !held.left) dir = "R";
  if (dir !== lastDir) { pendingDir = dir; lastDir = dir; }
}

// Wer das Fenster wechselt, lässt die Tasten los, ohne dass hier ein keyup ankommt.
function releaseAll() {
  if (!held.left && !held.right) return;
  held.left = held.right = false;
  if (engine && !engine.gameOver) updateDir();
}

// ---------- input ----------
const isLeft = (k) => k === "ArrowLeft" || k === "a" || k === "A";
const isRight = (k) => k === "ArrowRight" || k === "d" || k === "D";

document.addEventListener("keydown", (e) => {
  if (!arcade.running || e.altKey || e.ctrlKey || e.metaKey) return;
  if (isLeft(e.key)) { e.preventDefault(); held.left = true; updateDir(); }
  else if (isRight(e.key)) { e.preventDefault(); held.right = true; updateDir(); }
});
document.addEventListener("keyup", (e) => {
  if (!engine || engine.gameOver) return;
  if (isLeft(e.key)) { held.left = false; updateDir(); }
  else if (isRight(e.key)) { held.right = false; updateDir(); }
});
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

// ---------- init ----------
syncHud();
draw();
