/*
 * Breakout frontend.
 * All game RULES live in breakout_engine.js (shared with the server). This file
 * does rendering, input and the fixed-timestep loop, and RECORDS every paddle
 * direction change as { tick, dir }. On game over it posts the recorded log to
 * the server, which replays it and computes the authoritative score. The
 * client never sends a score. Start, pause and the result screen: js/arcade.js.
 * Effects only read the engine (js/observe/breakout.js) and keep their own clock.
 */
import { createArcade, fmt } from "./js/arcade.js";
import { crisp } from "./js/canvas.js";
import { createCanvasFx } from "./js/fx-canvas.js";
import { motion } from "./js/fx.js";
import { bindFollow, followDir } from "./js/touch.js";
import * as observe from "./js/observe/breakout.js";

const BE = window.BreakoutEngine;
const W = BE.W, H = BE.H;    // 440 x 520 game units
const canvas = document.getElementById("board");
const ctx = crisp(canvas, { width: W, height: H, onResize: () => draw() });
const fx = createCanvasFx({ width: W, height: H, motion });

const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");

// Farben aus static/css/tokens.css; Steinreihen von oben nach unten
const COL_BG = "#0a0816";
const COL_PADDLE = "#eeeafe";
const COL_BALL = "#eeeafe";
const COL_DANGER = "#f0606b";
const ROW_COLORS = ["#f06bb2", "#a98bfa", "#6c8cff", "#2ccfe3", "#4ad08a"];

const TICK_MS = 16;          // ~60 ticks/s; server replays ticks regardless
const MAX_CATCHUP = 5;
const REVEAL = { min: 350, max: 1000 };
const TRAIL = 5;             // Ballspur: so viele frühere Positionen

let engine = null;
let recorded = [];
let tickCount = 0;
let pendingDir = null;       // latest paddle dir not yet committed to a tick
let lastDir = "S";
let accMs = 0;
let lastFrame = 0;
let rafId = null;
const held = { left: false, right: false };
let follow = null;           // Finger: Ziel-x in Spielkoordinaten, sonst null
let seen = null;             // für observe.diff: schon gemeldete Steine
let trail = [];              // nur Darstellung
let squash = 0;              // Paddle-Stauchen nach einem Treffer, 1 → 0

const detail = (bricks) => `${fmt(bricks)} ${bricks === 1 ? "Stein" : "Steine"} abgeräumt`;
const local = () => ({ score: engine.score, won: engine.won, detail: detail(engine.bricksBroken) });

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
    seen = observe.newSeen(engine);
    trail = [];
    squash = 0;
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
  detail: (d) => detail(d.bricks),
  sync(d) { scoreEl.textContent = fmt(d.score); },
});

// ---------- rendering ----------
function draw() {
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  fx.applyShake(ctx);

  if (engine) {
    for (let i = 0; i < engine.bricks.length; i++) {
      const b = engine.bricks[i];
      if (!b.alive) continue;
      ctx.fillStyle = ROW_COLORS[b.row % ROW_COLORS.length];
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(b.x, b.y, b.w, 3);
    }

    // Paddle; nach einem Treffer kurz gestaucht (nur Darstellung, die Engine
    // rechnet weiter mit ihrem Rechteck).
    const k = motion() === "full" ? squash : 0;
    const pw = engine.paddleW * (1 + 0.08 * k);
    const ph = engine.paddleH * (1 - 0.3 * k);
    ctx.fillStyle = COL_PADDLE;
    ctx.fillRect(engine.paddleX - (pw - engine.paddleW) / 2, engine.paddleY + (engine.paddleH - ph), pw, ph);

    if (!engine.gameOver || engine.won) {
      ctx.fillStyle = COL_BALL;
      for (let i = 0; i < trail.length; i++) {
        ctx.globalAlpha = 0.07 + 0.05 * i;
        ctx.beginPath();
        ctx.arc(trail[i][0], trail[i][1], engine.ballR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(engine.bx, engine.by, engine.ballR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  fx.draw(ctx);
  ctx.restore();
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.score : 0);
  livesEl.textContent = engine ? engine.lives : 3;
}

// ---------- effects (read-only, from js/observe/breakout.js) ----------
function react(events) {
  for (const ev of events) {
    if (ev.type === "brick") {
      fx.burst(ev.x + ev.w / 2, ev.y + ev.h / 2, {
        count: 12, color: ROW_COLORS[ev.row % ROW_COLORS.length],
        speed: [70, 220], gravity: 520, life: [350, 650], size: [2, 4],
      });
    } else if (ev.type === "paddle") {
      squash = 1;
    } else if (ev.type === "life" || ev.type === "over") {
      trail = [];
      fx.shake(ev.type === "over" ? 6 : 4, ev.type === "over" ? 380 : 280);
      fx.flash({ color: COL_DANGER, alpha: ev.type === "over" ? 0.26 : 0.18, ms: 300 });
      fx.burst(Math.min(W - 8, Math.max(8, ev.x)), H - 4, {
        count: 10, color: [COL_DANGER, COL_BALL], angle: -Math.PI / 2, spread: 1.4,
        speed: [80, 220], gravity: 500, life: [300, 550], size: [2, 4],
      });
    } else if (ev.type === "won") {
      fx.confetti(ROW_COLORS);
    }
  }
}

// ---------- loop (mirrors breakout_engine.simulate tick order) ----------
function stepTick() {
  // Folgt das Paddle einem Finger, wird die Richtung hier entschieden, nach
  // derselben Regel wie bei den Tasten: nur Änderungen gehen in die Aufzeichnung.
  if (follow !== null) {
    const want = followDir(follow, engine.paddleX, engine.paddleW);
    if (want !== lastDir) { pendingDir = want; lastDir = want; }
  }
  let dirs = null;
  if (pendingDir !== null) {
    dirs = [pendingDir];
    recorded.push({ tick: tickCount, dir: pendingDir });
    pendingDir = null;
  }
  const before = observe.snap(engine);
  engine.tick(dirs);
  react(observe.diff(before, engine, seen));
  tickCount++;
  trail.push([engine.bx, engine.by]);
  if (trail.length > TRAIL) trail.shift();
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
    while (accMs >= TICK_MS && steps < MAX_CATCHUP && !engine.gameOver) {
      stepTick();
      accMs -= TICK_MS;
      steps++;
    }
    if (engine.gameOver) arcade.over(local(), { reveal: fx.settled(REVEAL) });
  }
  squash = Math.max(0, squash - dt / 140);
  fx.update(dt);
  draw();
  if (arcade.state === "playing" || fx.busy()) rafId = requestAnimationFrame(frame);
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

// Touch: Das Paddle folgt dem Finger; loslassen hält es an (bzw. gilt wieder die Tastatur).
bindFollow(canvas, {
  onMove(x) {
    follow = x === null ? null : x * W;
    if (x === null && engine && !engine.gameOver) updateDir();
  },
});

// ---------- init ----------
syncHud();
draw();
