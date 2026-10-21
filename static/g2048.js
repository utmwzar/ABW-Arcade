/*
 * 2048 frontend.
 * All game RULES live in g2048_engine.js (shared with the server). This file
 * does rendering, input, and RECORDS every board-changing move as { tick, dir }.
 * On game over it posts the recorded log to the server, which replays it and
 * computes the authoritative score. The client never sends a score.
 * Start, restart and the result screen: js/arcade.js.
 *
 * Animation is purely visual: slidePlan (js/observe/g2048.js) reads the board
 * before a move and never touches the engine. A new move snaps any running
 * animation; input is never blocked.
 */
import { createArcade, fmt } from "./js/arcade.js";
import { toast } from "./js/shell.js";
import { crisp } from "./js/canvas.js";
import { createCanvasFx } from "./js/fx-canvas.js";
import { motion } from "./js/fx.js";
import { bindSwipe } from "./js/touch.js";
import { slidePlan } from "./js/observe/g2048.js";

const GE = window.G2048Engine;
const canvas = document.getElementById("board");

// ---- board geometry (460 x 460 game units) ----
const SIZE = 4;
const PX = 460;
const PAD = 14;
const GAP = 12;
const CELL = (PX - 2 * PAD - (SIZE - 1) * GAP) / SIZE; // 99
const RADIUS = 9;

const ctx = crisp(canvas, { width: PX, height: PX, onResize: () => scheduleDraw() });
const fx = createCanvasFx({ width: PX, height: PX, motion });

const scoreEl = document.getElementById("score");
const bestTileEl = document.getElementById("best-tile");

// Farben aus static/css/tokens.css: kühl bis warm, die 2048 in Cyan.
const COL_SLOT = "rgba(255,255,255,0.05)";
const DARK = "#110d20", LIGHT = "#eeeafe";
const TILES = {
  2: ["#2e2752", LIGHT], 4: ["#3b3366", LIGHT], 8: ["#51458a", LIGHT], 16: ["#6c5bb8", LIGHT],
  32: ["#a98bfa", DARK], 64: ["#f06bb2", DARK], 128: ["#f58a7e", DARK], 256: ["#f6a35f", DARK],
  512: ["#f7b553", DARK], 1024: ["#f7c04a", DARK], 2048: ["#2ccfe3", DARK], 4096: ["#4ad08a", DARK],
};
const TILE_HI = [LIGHT, DARK]; // 8192 and beyond
const CONFETTI = ["#2ccfe3", "#f7c04a", "#4ad08a", "#f06bb2", "#a98bfa"];

// Zeiten der Animation (ms): schieben, dann pochen die verschmolzenen Kacheln
// und die neue wächst heraus.
const SLIDE_MS = 90;
const POP_MS = 150;
const SPAWN_MS = 120;
const BIG_MERGE = 128;     // ab hier sprüht eine Verschmelzung

let engine = null;
let recorded = [];
let moveIdx = 0;
let wonAnnounced = false;
let anim = null;           // { t0, plan, merged: Set, spawn, fired }
let rafId = null;
let lastNow = 0;

const detail = (highest) => `Best Tile ${fmt(highest)}`;
const local = () => ({ score: engine.score, won: engine.won, detail: detail(engine.highest) });

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
    fx.reset();
    // Beide Startkacheln wachsen heraus (die Engine meldet nur die zweite).
    anim = { t0: performance.now(), plan: null, merged: new Set(), spawn: -1, fired: true, all: true };
    syncHud();
    scheduleDraw();
  },
  inputs: () => recorded,
  snapshot: local,
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

function drawTile(v, x, y, scale = 1, alpha = 1) {
  const size = CELL * scale;
  const off = (CELL - size) / 2;
  const [bg, fg] = TILES[v] || TILE_HI;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = bg;
  roundRect(x + off, y + off, size, size, RADIUS);
  ctx.fill();

  if (scale > 0.55) {
    ctx.fillStyle = fg;
    ctx.font = fontFor(v);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = alpha * Math.min(1, (scale - 0.55) / 0.45);
    ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 1);
  }
  ctx.globalAlpha = 1;
}

const easeOut = (k) => 1 - (1 - k) * (1 - k);

// Zeichnet und meldet, ob die Animation noch läuft.
function draw(now) {
  ctx.clearRect(0, 0, PX, PX);   // den Grund malt .board-wrap (--playfield)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const { x, y } = cellXY(i);
    ctx.fillStyle = COL_SLOT;
    roundRect(x, y, CELL, CELL, RADIUS);
    ctx.fill();
  }
  if (!engine) return false;

  const m = motion();
  const a = m === "off" ? null : anim;
  const t = a ? now - a.t0 : Infinity;
  let running = false;

  if (a && a.plan && m === "full" && t < SLIDE_MS) {
    // Schieben: jede Kachel von ihrem alten zu ihrem neuen Feld.
    const k = easeOut(Math.max(0, t) / SLIDE_MS);
    for (const mv of a.plan.moves) {
      const p = cellXY(mv.from), q = cellXY(mv.to);
      drawTile(mv.value, p.x + (q.x - p.x) * k, p.y + (q.y - p.y) * k);
    }
    fx.draw(ctx);
    return true;
  }

  const after = a ? t - (m === "full" && a.plan ? SLIDE_MS : 0) : Infinity;
  if (a && !a.fired) {
    a.fired = true;
    for (const mg of a.plan.merges) {
      if (mg.value < BIG_MERGE) continue;
      const { x, y } = cellXY(mg.at);
      fx.burst(x + CELL / 2, y + CELL / 2, {
        count: 10, color: (TILES[mg.value] || TILE_HI)[0], speed: [80, 220], drag: 0.06, life: [300, 520], size: [3, 5],
      });
    }
  }
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = engine.board[i];
    if (!v) continue;
    const { x, y } = cellXY(i);
    let scale = 1, alpha = 1;
    if (a && (i === a.spawn || a.all) && after < SPAWN_MS) {
      running = true;
      const k = Math.max(0, after) / SPAWN_MS;
      if (m === "full") scale = 0.2 + 0.8 * easeOut(k);
      else alpha = k;                 // reduziert: nur einblenden
    } else if (a && m === "full" && a.merged.has(i) && after < POP_MS) {
      running = true;
      scale = 1 + 0.12 * Math.sin(Math.PI * Math.max(0, after) / POP_MS);
    }
    drawTile(v, x, y, scale, alpha);
  }
  fx.draw(ctx);
  return running;
}

function renderLoop(now) {
  fx.update(Math.min(250, Math.max(0, now - lastNow)));
  lastNow = now;
  rafId = draw(now) || fx.busy() ? requestAnimationFrame(renderLoop) : null;
}

function scheduleDraw() {
  if (rafId !== null) return;
  lastNow = performance.now();
  rafId = requestAnimationFrame(renderLoop);
}

function syncHud() {
  scoreEl.textContent = fmt(engine ? engine.score : 0);
  bestTileEl.textContent = fmt(engine ? engine.highest : 0);
}

// ---------- moves ----------
function applyMove(dir) {
  if (!arcade.running || !engine || engine.gameOver) return;
  const plan = slidePlan(engine.board, dir);   // liest nur
  const changed = engine.move(dir);
  if (!changed) return; // no-op move: nothing recorded, no spawn (matches engine)
  recorded.push({ tick: moveIdx, dir });
  moveIdx += 1;
  anim = {
    t0: performance.now(), plan, merged: new Set(plan.merges.map((mg) => mg.at)),
    spawn: engine.lastSpawn, fired: false, all: false,
  };
  syncHud();
  scheduleDraw();
  if (engine.won && !wonAnnounced) {
    wonAnnounced = true;
    fx.confetti(CONFETTI);
    toast("2048 geschafft! Du kannst weiterspielen und den Score ausbauen.");
  }
  if (engine.gameOver) {
    arcade.over(local(), { reveal: fx.settled({ min: SLIDE_MS + POP_MS, max: 900 }) });
  }
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

// Wischen: ein Zug je Berührung (js/touch.js).
bindSwipe(canvas, { threshold: 24, onSwipe: applyMove });

// ---------- init ----------
syncHud();
scheduleDraw();
// Die Schrift der Kacheln kommt aus einer Webfont; danach einmal neu zeichnen.
document.fonts.ready.then(scheduleDraw);
