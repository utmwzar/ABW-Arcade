/*
 * 2048 frontend.
 * All game RULES live in g2048_engine.js (shared with the server). This file
 * does rendering, input, and RECORDS every board-changing move as { tick, dir }.
 * On game over it posts the recorded log to the server, which replays it and
 * computes the authoritative score. The client never sends a score.
 * Start, restart and the result screen: js/arcade.js.
 */
import { createArcade, fmt } from "./js/arcade.js";
import { toast } from "./js/shell.js";

const GE = window.G2048Engine;
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestTileEl = document.getElementById("best-tile");

// ---- board geometry (canvas is 460x460) ----
const SIZE = 4;
const PAD = 14;
const GAP = 12;
const CELL = (canvas.width - 2 * PAD - (SIZE - 1) * GAP) / SIZE; // 99
const RADIUS = 9;

// Farben aus static/css/tokens.css: kühl bis warm, die 2048 in Cyan.
const COL_BOARD = "#0a0816";
const COL_SLOT = "rgba(255,255,255,0.05)";
const DARK = "#110d20", LIGHT = "#eeeafe";
const TILES = {
  2: ["#2e2752", LIGHT], 4: ["#3b3366", LIGHT], 8: ["#51458a", LIGHT], 16: ["#6c5bb8", LIGHT],
  32: ["#a98bfa", DARK], 64: ["#f06bb2", DARK], 128: ["#f58a7e", DARK], 256: ["#f6a35f", DARK],
  512: ["#f7b553", DARK], 1024: ["#f7c04a", DARK], 2048: ["#2ccfe3", DARK], 4096: ["#4ad08a", DARK],
};
const TILE_HI = [LIGHT, DARK]; // 8192 and beyond

let engine = null;
let recorded = [];
let moveIdx = 0;
let wonAnnounced = false;

// spawn-pop animation (purely visual, never touches engine state)
let animCell = -1;
let animStart = 0;
const ANIM_MS = 110;
let rafId = null;

const detail = (highest) => `Best Tile ${fmt(highest)}`;

const arcade = createArcade({
  slug: "2048",
  startUrl: "/api/2048/start",
  finishUrl: "/api/2048/finish",
  canPause: false,          // zugbasiert: ohne Zug läuft nichts weiter
  restart: {
    title: "NEUES SPIEL?",
    text: "Das laufende Spiel wird beendet und mit seinem Score gewertet.",
  },
  begin(data) {
    engine = new GE.Engine(data.seed >>> 0);
    recorded = [];
    moveIdx = 0;
    wonAnnounced = false;
    animCell = engine.lastSpawn;
    animStart = performance.now();
    syncHud();
    scheduleDraw();
  },
  inputs: () => recorded,
  snapshot: () => ({ score: engine.score, won: engine.won, detail: detail(engine.highest) }),
  detail: (d) => detail(d.highest),
  sync(d) {
    scoreEl.textContent = fmt(d.score);
    bestTileEl.textContent = fmt(d.highest);
  },
});

// ---------- rendering ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cellXY(i) {
  const r = Math.floor(i / SIZE), c = i % SIZE;
  return { x: PAD + c * (CELL + GAP), y: PAD + r * (CELL + GAP) };
}

function fontFor(v) {
  const digits = String(v).length;
  const px = digits >= 4 ? 27 : digits === 3 ? 33 : 40;
  return `800 ${px}px Archivo, system-ui, sans-serif`;
}

function drawTile(v, x, y, scale) {
  const size = CELL * scale;
  const off = (CELL - size) / 2;
  const [bg, fg] = TILES[v] || TILE_HI;
  ctx.fillStyle = bg;
  roundRect(x + off, y + off, size, size, RADIUS);
  ctx.fill();

  if (scale > 0.55) {
    ctx.fillStyle = fg;
    ctx.font = fontFor(v);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = Math.min(1, (scale - 0.55) / 0.45);
    ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 1);
    ctx.globalAlpha = 1;
  }
}

function draw(now) {
  ctx.fillStyle = COL_BOARD;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < SIZE * SIZE; i++) {
    const { x, y } = cellXY(i);
    ctx.fillStyle = COL_SLOT;
    roundRect(x, y, CELL, CELL, RADIUS);
    ctx.fill();
  }
  if (!engine) return false;

  let animating = false;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = engine.board[i];
    if (!v) continue;
    const { x, y } = cellXY(i);
    let scale = 1;
    if (i === animCell) {
      const t = (now - animStart) / ANIM_MS;
      if (t < 1) {
        scale = 0.2 + 0.8 * (1 - (1 - t) * (1 - t)); // ease-out
        animating = true;
      }
    }
    drawTile(v, x, y, scale);
  }
  return animating;
}

function renderLoop(now) {
  rafId = draw(now) ? requestAnimationFrame(renderLoop) : null;
}

function scheduleDraw() {
  if (rafId === null) rafId = requestAnimationFrame(renderLoop);
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.score : 0);
  bestTileEl.textContent = fmt(engine ? engine.highest : 0);
}

// ---------- moves ----------
function applyMove(dir) {
  if (!arcade.running || !engine || engine.gameOver) return;
  const changed = engine.move(dir);
  if (!changed) return; // no-op move: nothing recorded, no spawn (matches engine)
  recorded.push({ tick: moveIdx, dir });
  moveIdx += 1;
  animCell = engine.lastSpawn;
  animStart = performance.now();
  syncHud();
  scheduleDraw();
  if (engine.won && !wonAnnounced) {
    wonAnnounced = true;
    toast("2048 geschafft! Du kannst weiterspielen und den Score ausbauen.");
  }
  if (engine.gameOver) arcade.over({ score: engine.score, won: engine.won, detail: detail(engine.highest) });
}

// ---------- input ----------
const KEY_DIR = {
  ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
  w: "U", W: "U", s: "D", S: "D", a: "L", A: "L", d: "R", D: "R",
};

document.addEventListener("keydown", (e) => {
  if (!arcade.running || e.altKey || e.ctrlKey || e.metaKey) return;
  const dir = KEY_DIR[e.key];
  if (dir) { e.preventDefault(); applyMove(dir); }
});

// touch swipe (mobile)
let touchX = 0, touchY = 0, touching = false;
canvas.addEventListener("touchstart", (e) => {
  if (!e.touches.length) return;
  touching = true;
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}, { passive: true });
canvas.addEventListener("touchend", (e) => {
  if (!touching || !e.changedTouches.length) return;
  touching = false;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.max(adx, ady) < 24) return; // ignore taps
  if (adx > ady) applyMove(dx > 0 ? "R" : "L");
  else applyMove(dy > 0 ? "D" : "U");
}, { passive: true });
// stop the page scrolling while swiping on the board
canvas.addEventListener("touchmove", (e) => { if (touching) e.preventDefault(); }, { passive: false });

// ---------- init ----------
syncHud();
scheduleDraw();
// Die Schrift der Kacheln kommt aus einer Webfont; danach einmal neu zeichnen.
document.fonts.ready.then(scheduleDraw);
