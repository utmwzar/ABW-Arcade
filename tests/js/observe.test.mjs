// Die Beobachter (static/js/observe/) dürfen die Engines nur lesen. Jedes Spiel
// läuft hier zweimal mit denselben Eingaben, einmal mit Beobachtern so wie in
// den Spiel-Skripten und einmal ohne. Engine-Zustand und Server-Ergebnis
// (simulate) müssen gleich sein, und die Ereignisse müssen zum Spiel passen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as obTetris from "../../static/js/observe/tetris.js";
import * as obSnake from "../../static/js/observe/snake.js";
import * as obBreakout from "../../static/js/observe/breakout.js";
import * as obGd from "../../static/js/observe/gd.js";
import { slidePlan } from "../../static/js/observe/g2048.js";

const require = createRequire(import.meta.url);
const TE = require("../../static/tetris_engine.js");
const SE = require("../../static/snake_engine.js");
const BE = require("../../static/breakout_engine.js");
const GE = require("../../static/gd_engine.js");
const G2 = require("../../static/g2048_engine.js");

// Eigener Zufall für die Eingaben, damit jeder Lauf gleich ist.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const state = (engine) => JSON.stringify(engine);   // Funktionen (rng) fallen weg

// ---------- Tetris ----------
// Ein einfacher Spieler, damit wirklich Reihen fallen: Er probiert jede Drehung
// und Spalte auf einer Kopie der Engine aus (die echte bleibt unberührt) und
// nimmt die Lage mit wenig Löchern und flachem Stapel. Ab und zu legt er
// zufällig ab, damit die Partien auch enden.
function copyEngine(e) {
  const c = Object.assign(Object.create(Object.getPrototypeOf(e)), e);
  c.grid = e.grid.map((row) => row.slice());
  c.current = { ...e.current, matrix: e.current.matrix.map((row) => row.slice()) };
  c.bag = e.bag.slice();
  c.rng = () => 0;
  return c;
}

function rate(c, lines) {
  const heights = [];
  let holes = 0;
  for (let x = 0; x < TE.COLS; x++) {
    let y = 0;
    while (y < TE.ROWS && !c.grid[y][x]) y++;
    heights.push(TE.ROWS - y);
    for (let yy = y + 1; yy < TE.ROWS; yy++) if (!c.grid[yy][x]) holes++;
  }
  let bump = 0;
  for (let x = 1; x < TE.COLS; x++) bump += Math.abs(heights[x] - heights[x - 1]);
  const total = heights.reduce((a, b) => a + b, 0);
  return 0.76 * lines - 0.51 * total - 0.36 * holes - 0.18 * bump - (c.gameOver ? 100 : 0);
}

function plan(e, r) {
  const options = [];
  for (let rot = 0; rot < 4; rot++) {
    for (let dx = -5; dx <= 5; dx++) {
      const moves = [...Array(rot).fill("ROT"), ...Array(Math.abs(dx)).fill(dx < 0 ? "L" : "R"), "HARD"];
      const c = copyEngine(e);
      for (const m of moves) c.applyAction(m);
      options.push({ moves, score: rate(c, c.lines - e.lines) });
    }
  }
  if (r() < 0.04) return options[Math.floor(r() * options.length)].moves;
  return options.reduce((a, b) => (b.score > a.score ? b : a)).moves;
}

function runTetris(seed, observe) {
  const r = rng(seed * 7 + 1);
  const e = new TE.Engine(seed);
  e.start();
  const inputs = [];
  const events = [];
  const step = (fn, action) => {
    if (!observe) { fn(); return; }
    const before = obTetris.snap(e);
    fn();
    events.push(...obTetris.diff(before, e, action));
  };
  let planned = null;
  let pieces = 0;
  for (let tick = 0; tick < 200000 && !e.gameOver && pieces < 400; tick++) {
    if (e.current !== planned) {
      planned = e.current;
      pieces++;
      // Manchmal erst ein paar Takte fallen lassen oder ziehen, wie ein Mensch.
      if (r() < 0.93) {
        for (const action of plan(e, r)) {
          inputs.push({ tick, action });
          step(() => e.applyAction(action), action);
          if (e.gameOver) break;
        }
      }
    } else if (r() < 0.05) {
      const action = r() < 0.5 ? "SOFT" : TE.ACTIONS[Math.floor(r() * TE.ACTIONS.length)];
      inputs.push({ tick, action });
      step(() => e.applyAction(action), action);
    }
    if (e.gameOver) break;
    step(() => e.gravityStep(), null);
  }
  return { e, inputs, events };
}

test("Tetris: Beobachter ändern nichts, Ereignisse passen zum Spiel", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const plain = runTetris(seed, false);
    const seen = runTetris(seed, true);
    assert.equal(state(seen.e), state(plain.e), `Seed ${seed}: Zustand weicht ab`);
    const server = TE.simulate(seed, seen.inputs);
    assert.equal(server.score, seen.e.score);
    assert.equal(server.lines, seen.e.lines);

    const cleared = seen.events.filter((x) => x.type === "clear").flatMap((x) => x.rows);
    assert.equal(cleared.length, seen.e.lines, `Seed ${seed}: abgeräumte Reihen`);
    for (const row of cleared) assert.ok(row.cells.every((v) => v > 0), "abgeräumte Reihe war voll");
    for (const ev of seen.events.filter((x) => x.type === "lock")) assert.equal(ev.cells.length, 4);
    for (const ev of seen.events.filter((x) => x.type === "drop")) {
      assert.ok(Math.min(...ev.cells.map((c) => c[1])) >= ev.from);
    }
    assert.equal(seen.events.filter((x) => x.type === "over").length, seen.e.gameOver ? 1 : 0);
    assert.equal(seen.events.filter((x) => x.type === "level").length, seen.e.level - 1);
  }
});

// ---------- Snake ----------
// Snake-Spieler: Richtung zum Futter, solange der nächste Schritt frei ist;
// mit der Zeit wird er unaufmerksamer, damit die Partie endet.
function snakeChoice(e, r, tick) {
  const [hx, hy] = e.snake[0];
  const body = new Set(e.snake.slice(0, -1).map(([x, y]) => `${x},${y}`));
  const free = (d) => {
    const [dx, dy] = SE.DIRS[d];
    const x = hx + dx, y = hy + dy;
    return x >= 0 && y >= 0 && x < SE.COLS && y < SE.ROWS && !body.has(`${x},${y}`);
  };
  const options = SE.ACTIONS.filter((d) => d !== SE.OPP[e.dir] && free(d));
  if (!options.length || r() < tick / 40000) return SE.ACTIONS[Math.floor(r() * 4)];
  const dist = (d) => {
    const [dx, dy] = SE.DIRS[d];
    return Math.abs(hx + dx - e.food[0]) + Math.abs(hy + dy - e.food[1]);
  };
  return options.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

function runSnake(seed, observe) {
  const r = rng(seed * 11 + 3);
  const e = new SE.Engine(seed);
  const inputs = [];
  const events = [];
  for (let tick = 0; tick < 20000 && !e.gameOver; tick++) {
    let dirs = null;
    const want = e.food ? snakeChoice(e, r, tick) : e.dir;
    if (want !== e.dir) dirs = [want];
    if (dirs) inputs.push({ tick, dir: dirs[0] });
    const before = observe ? obSnake.snap(e) : null;
    e.tick(dirs);
    if (observe) events.push(...obSnake.diff(before, e));
  }
  return { e, inputs, events };
}

test("Snake: Beobachter ändern nichts, Ereignisse passen zum Spiel", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const plain = runSnake(seed, false);
    const seen = runSnake(seed, true);
    assert.equal(state(seen.e), state(plain.e), `Seed ${seed}: Zustand weicht ab`);
    const server = SE.simulate(seed, seen.inputs);
    assert.equal(server.score, seen.e.score);
    assert.equal(seen.events.filter((x) => x.type === "eat").length, seen.e.score);
    const ends = seen.events.filter((x) => x.type === "crash" || x.type === "won");
    assert.equal(ends.length, seen.e.gameOver ? 1 : 0);
  }
});

// ---------- Breakout ----------
function runBreakout(seed, observe) {
  const r = rng(seed * 13 + 5);
  const e = new BE.Engine(seed);
  const seen = obBreakout.newSeen(e);
  const inputs = [];
  const events = [];
  let last = "S";
  let away = 0;          // Takte, in denen der Spieler nicht hinschaut
  let target = BE.W / 2;
  for (let tick = 0; tick < 40000 && !e.gameOver; tick++) {
    let dirs = null;
    // Meist dem Ball folgen; ab und zu (je Seed verschieden oft) schaut er weg.
    if (away > 0) away--;
    else if (r() < seed * 0.0006) { away = 60 + Math.floor(r() * 90); target = r() * BE.W; }
    else target = e.bx;
    const c = e.paddleX + e.paddleW / 2;
    const want = target < c - 3 ? "L" : target > c + 3 ? "R" : "S";
    if (want !== last) { dirs = [want]; last = want; inputs.push({ tick, dir: want }); }
    const before = observe ? obBreakout.snap(e) : null;
    e.tick(dirs);
    if (observe) events.push(...obBreakout.diff(before, e, seen));
  }
  return { e, inputs, events };
}

test("Breakout: Beobachter ändern nichts, Ereignisse passen zum Spiel", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const plain = runBreakout(seed, false);
    const seen = runBreakout(seed, true);
    assert.equal(state(seen.e), state(plain.e), `Seed ${seed}: Zustand weicht ab`);
    const server = BE.simulate(seed, seen.inputs);
    assert.equal(server.score, seen.e.score);
    const bricks = seen.events.filter((x) => x.type === "brick");
    assert.equal(bricks.length, seen.e.bricksBroken);
    assert.equal(new Set(bricks.map((b) => `${b.x},${b.y}`)).size, bricks.length, "jeder Stein einmal");
    assert.ok(seen.events.some((x) => x.type === "paddle"), "Paddle-Treffer erkannt");
    const lost = seen.events.filter((x) => x.type === "life" || x.type === "over").length;
    assert.equal(lost, BE.START_LIVES - seen.e.lives);
  }
});

// ---------- Geometry Dash ----------
function runGd(seed, observe) {
  const r = rng(seed * 17 + 7);
  const e = new GE.Engine(seed);
  const inputs = [];
  const events = [];
  let held = false;
  for (let tick = 0; tick < GE.MAX_TICKS && !e.gameOver; tick++) {
    let ev = null;
    if (r() < 0.06) { held = !held; ev = [held ? "D" : "U"]; inputs.push({ tick, dir: ev[0] }); }
    const before = observe ? obGd.snap(e) : null;
    e.tick(ev);
    if (observe) events.push(...obGd.diff(before, e));
  }
  return { e, inputs, events };
}

test("Geometry Dash: Beobachter ändern nichts, Ereignisse passen zum Spiel", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const plain = runGd(seed, false);
    const seen = runGd(seed, true);
    assert.equal(state(seen.e), state(plain.e), `Seed ${seed}: Zustand weicht ab`);
    const server = GE.simulate(seed, seen.inputs);
    assert.equal(server.score, seen.e.cells);
    const jumps = seen.events.filter((x) => x.type === "jump").length;
    const lands = seen.events.filter((x) => x.type === "land").length;
    assert.ok(jumps >= 1, `Seed ${seed}: kein Sprung erkannt`);
    assert.ok(lands >= jumps - 1 && lands <= jumps + 1, `Seed ${seed}: ${jumps} Sprünge, ${lands} Landungen`);
    assert.equal(seen.events.filter((x) => x.type === "crash" || x.type === "won").length, seen.e.gameOver ? 1 : 0);
  }
});

// ---------- 2048 ----------
test("2048: slidePlan rechnet jeden Zug wie die Engine", () => {
  const r = rng(2048);
  const values = [0, 0, 0, 2, 2, 4, 4, 8, 16, 32, 64, 128];
  for (let n = 0; n < 4000; n++) {
    const board = Array.from({ length: 16 }, () => values[Math.floor(r() * values.length)]);
    for (const dir of G2.ACTIONS) {
      const e = new G2.Engine(n);
      e.board = board.slice();
      e.gameOver = false;
      const score = e.score;
      const plan = slidePlan(board, dir);
      const changed = e.move(dir);
      assert.equal(plan.changed, changed, `Zug ${dir} auf ${board}`);
      if (!changed) continue;
      const withoutSpawn = e.board.slice();
      withoutSpawn[e.lastSpawn] = 0;
      assert.deepEqual(plan.board, withoutSpawn, `Zug ${dir} auf ${board}`);
      assert.equal(plan.gained, e.score - score);
      // Jede Kachel kommt an ihrem Ziel an.
      const landed = new Array(16).fill(0);
      for (const m of plan.moves) landed[m.to] += m.value;
      assert.deepEqual(landed, plan.board);
      assert.equal(plan.moves.length, board.filter(Boolean).length);
    }
  }
});

test("2048: slidePlan liest das Brett nur", () => {
  const board = [2, 2, 4, 4, 0, 8, 8, 0, 2, 0, 2, 2, 16, 16, 16, 16];
  const copy = board.slice();
  for (const dir of ["L", "R", "U", "D"]) slidePlan(board, dir);
  assert.deepEqual(board, copy);
});
