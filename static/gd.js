/*
 * Geometry Dash frontend.
 * All game RULES live in gd_engine.js (shared with the server). This file does
 * rendering, input and the fixed-timestep loop, and RECORDS every jump-button
 * toggle as { tick, dir } (D = press, U = release). On game over it posts the
 * recorded log to the server, which replays it through the identical engine and
 * computes the authoritative distance. The client never sends a score.
 * Start, pause, restart and the result screen: js/arcade.js.
 *
 * The cube's spin is purely cosmetic and never affects collision.
 */
import { createArcade, fmt } from "./js/arcade.js";

const GE = window.GDEngine;
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");

// ---- view geometry (canvas buffer is 900x280; CSS scales it) ----
const W = canvas.width, H = canvas.height;
const CELLPX = 36;
const PXFP = CELLPX / GE.CELL;        // screen px per fp unit
const GROUND_Y = H - 44;              // y of the floor's top surface
const CUBE_X = 150;                   // cube's fixed left edge on screen

// Farben aus static/css/tokens.css
const COL_BG = "#0a0816";
const COL_GRID = "rgba(255,255,255,0.04)";
const COL_LINE = "#6c8cff";
const COL_CUBE = "#6c8cff";
const COL_CUBE_IN = "#cdd8ff";
const COL_SPIKE = "#f0606b";
const COL_SPIKE_HI = "#f8a1a8";
const COL_BLOCK = "#261f45";
const COL_FLOOR = "#181331";

const TICK_MS = 16;                   // ~60 ticks/s; server replays ticks regardless
const MAX_CATCHUP = 5;

let engine = null;
let recorded = [];
let tickCount = 0;
// Ein kurzer Tipp (drücken und loslassen im selben Frame) darf nicht verloren
// gehen: Jeder Wechsel kommt in die Warteschlange, je Takt geht einer hinein.
const toggles = [];
let held = false, lastHeld = false;
let accMs = 0, lastFrame = 0;
let rafId = null;
let cubeAngle = 0;                    // cosmetic only
let trail = [];

const detail = (won) => (won ? "Distance · Ziel erreicht" : "Distance");

const arcade = createArcade({
  slug: "geometry-dash",
  startUrl: "/api/geometry-dash/start",
  finishUrl: "/api/geometry-dash/finish",
  canPause: true,
  restart: {
    title: "NEUER RUN?",
    text: "Der laufende Run wird beendet und mit seiner Distance gewertet.",
  },
  begin(data) {
    engine = new GE.Engine(data.seed >>> 0);
    recorded = [];
    tickCount = 0;
    toggles.length = 0;
    held = lastHeld = false;
    cubeAngle = 0;
    trail = [];
    accMs = 0;
    lastFrame = performance.now();
    syncHud();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  },
  resume() { lastFrame = performance.now(); },
  inputs: () => recorded,
  snapshot: () => ({ score: engine.cells, won: engine.won, detail: detail(engine.won) }),
  detail: (d) => detail(d.won),
  sync(d) { scoreEl.textContent = fmt(d.score); },
  board(me) { bestEl.textContent = fmt(me.best); },
});

// ---------- helpers ----------
function sx(worldX) { return CUBE_X + (worldX - engine.worldX) * PXFP; }
function syForHeight(h) { return GROUND_Y - h * PXFP; }

// ---------- rendering ----------
function drawBackground() {
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, W, H);

  // scrolling grid
  const wx = engine ? engine.worldX : 0;
  const step = CELLPX * 2;
  const off = ((wx * PXFP) % step);
  ctx.strokeStyle = COL_GRID;
  ctx.lineWidth = 1;
  for (let x = -off; x < W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GROUND_Y); ctx.stroke();
  }
  for (let y = GROUND_Y - step; y > 0; y -= step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function drawFloor() {
  ctx.fillStyle = COL_FLOOR;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = COL_LINE;
  ctx.fillRect(0, GROUND_Y, W, 2);
  // moving floor ticks
  const wx = engine ? engine.worldX : 0;
  const off = ((wx * PXFP) % CELLPX);
  ctx.strokeStyle = "rgba(108,140,255,0.18)";
  ctx.lineWidth = 1;
  for (let x = -off; x < W; x += CELLPX) {
    ctx.beginPath(); ctx.moveTo(x, GROUND_Y + 6); ctx.lineTo(x, H); ctx.stroke();
  }
}

function drawObstacles() {
  const leftFp = engine.worldX - (CUBE_X / PXFP) - GE.CELL;
  const rightFp = engine.worldX + ((W - CUBE_X) / PXFP) + GE.CELL;
  for (let i = 0; i < engine.obstacles.length; i++) {
    const ob = engine.obstacles[i];
    if (ob.x1 < leftFp || ob.x0 > rightFp) continue;
    if (ob.kind === GE.SPIKE) {
      // derive cell footprint from the (inset) hitbox so triangles look right
      const cellLeft = ob.x0 - GE.SPIKE_INSET;
      const widthCells = Math.round(((ob.x1 - ob.x0) + 2 * GE.SPIKE_INSET) / GE.CELL);
      for (let c = 0; c < widthCells; c++) {
        const bx = sx(cellLeft + c * GE.CELL);
        ctx.fillStyle = COL_SPIKE;
        ctx.beginPath();
        ctx.moveTo(bx + 2, GROUND_Y);
        ctx.lineTo(bx + CELLPX - 2, GROUND_Y);
        ctx.lineTo(bx + CELLPX / 2, syForHeight(GE.CELL));
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = COL_SPIKE_HI;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      const x = sx(ob.x0);
      const w = (ob.x1 - ob.x0) * PXFP;
      const topY = syForHeight(ob.top);
      ctx.fillStyle = COL_BLOCK;
      ctx.fillRect(x, topY, w, GROUND_Y - topY);
      ctx.strokeStyle = COL_LINE;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, topY + 0.75, w - 1.5, GROUND_Y - topY - 1.5);
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCube() {
  const bottomY = GROUND_Y - engine.y * PXFP;
  const cx = CUBE_X + CELLPX / 2;
  const cy = bottomY - CELLPX / 2;

  for (let i = 0; i < trail.length; i++) {
    const s = CELLPX * (0.5 + 0.5 * (i + 1) / trail.length);
    ctx.fillStyle = `rgba(108,140,255,${((i + 1) / (trail.length + 1)) * 0.28})`;
    ctx.fillRect(trail[i].x - s / 2, trail[i].y - s / 2, s, s);
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cubeAngle);
  ctx.fillStyle = COL_CUBE;
  roundRect(-CELLPX / 2, -CELLPX / 2, CELLPX, CELLPX, 6);
  ctx.fill();
  ctx.fillStyle = COL_CUBE_IN;
  const inner = CELLPX * 0.34;
  roundRect(-inner / 2, -inner / 2, inner, inner, 3);
  ctx.fill();
  ctx.restore();
}

function draw() {
  drawBackground();
  if (!engine) { drawFloor(); return; }
  drawObstacles();
  drawFloor();
  drawCube();
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.cells : 0);
}

// ---------- loop (mirrors gd_engine.simulate tick order) ----------
function stepTick() {
  let events = null;
  if (toggles.length) {
    const dir = toggles.shift();
    events = [dir];
    recorded.push({ tick: tickCount, dir });
  }
  engine.tick(events);
  tickCount++;

  // cosmetic spin + trail
  if (!engine.onGround) cubeAngle += 0.12;
  else {
    // ease the spin back to an upright quarter
    const q = Math.round(cubeAngle / (Math.PI / 2)) * (Math.PI / 2);
    cubeAngle += (q - cubeAngle) * 0.5;
    if (Math.abs(q - cubeAngle) < 0.02) cubeAngle = 0;
  }
  trail.push({ x: CUBE_X + CELLPX / 2, y: GROUND_Y - engine.y * PXFP - CELLPX / 2 });
  if (trail.length > 6) trail.shift();

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
    arcade.over({ score: engine.cells, won: engine.won, detail: detail(engine.won) });
    return;
  }
  rafId = requestAnimationFrame(frame);
}

// turn the held button into a recorded toggle when it changes
function setHeld(value) {
  held = value;
  if (held !== lastHeld) {
    toggles.push(held ? "D" : "U");
    lastHeld = held;
  }
}

// ---------- input ----------
const JUMP_KEYS = [" ", "ArrowUp", "w", "W", "Spacebar", "Up"];

document.addEventListener("keydown", (e) => {
  if (JUMP_KEYS.indexOf(e.key) === -1 || e.altKey || e.ctrlKey || e.metaKey) return;
  if (arcade.running) {
    e.preventDefault();
    if (!e.repeat) setHeld(true);
  } else if ((arcade.state === "idle" || arcade.state === "over") &&
             !(e.target instanceof Element && e.target.closest("button, a, input, select, textarea"))) {
    // Wie im Original: Springen startet auch den Run.
    e.preventDefault();
    if (!e.repeat) arcade.start();
  }
});
document.addEventListener("keyup", (e) => {
  if (JUMP_KEYS.indexOf(e.key) !== -1 && engine && !engine.gameOver) setHeld(false);
});
canvas.addEventListener("mousedown", (e) => {
  if (!arcade.running) return;
  e.preventDefault();
  setHeld(true);
});
window.addEventListener("mouseup", () => { if (held) setHeld(false); });
// Gehaltene Taste beim Fensterwechsel loslassen; das keyup käme sonst nie an.
window.addEventListener("blur", () => { if (held) setHeld(false); });

// ---------- init ----------
syncHud();
draw();
