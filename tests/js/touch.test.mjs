// Prüft die Gesten-Erkenner aus static/js/touch.js mit erfundenen Fingerbahnen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  swipeDir, createSwipe, createTetrisGesture, followDir, accepts, TAP_MS,
} from "../../static/js/touch.js";

const require = createRequire(import.meta.url);
const BE = require("../../static/breakout_engine.js");

// Fingerbahn: Punkte [x, y, t] von down über move bis up.
function play(gesture, cell, points) {
  const [first, ...rest] = points;
  gesture.down(first[0], first[1], first[2], cell);
  const out = [];
  rest.forEach(([x, y, t], i) => {
    out.push(...(i === rest.length - 1 ? gesture.up(x, y, t) : gesture.move(x, y, t)));
  });
  return out;
}

// Gleichmäßige Bahn von a nach b in `ms`, ein Punkt je 16 ms.
function path(a, b, ms, t0 = 0) {
  const n = Math.max(1, Math.round(ms / 16));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    pts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, t0 + ms * k]);
  }
  return pts;
}

test("swipeDir: erst ab der Schwelle und nur mit klarer Hauptachse", () => {
  assert.equal(swipeDir(10, 0, 24), null);
  assert.equal(swipeDir(30, 5, 24), "R");
  assert.equal(swipeDir(-30, 5, 24), "L");
  assert.equal(swipeDir(3, 40, 24), "D");
  assert.equal(swipeDir(3, -40, 24), "U");
  assert.equal(swipeDir(30, 28, 24, 1.25), null, "zu schräg");
  assert.equal(swipeDir(30, 28, 24), "R", "ohne Verhältnis zählt die längere Achse");
});

test("Wischen einmal je Berührung (2048)", () => {
  const sw = createSwipe();
  sw.down(100, 100, 24);
  assert.equal(sw.move(110, 102), null);
  assert.equal(sw.move(130, 104), "R");
  assert.equal(sw.move(180, 104), null, "eine Berührung, ein Zug");
  assert.equal(sw.up(180, 104), null);

  sw.down(100, 100, 24);
  assert.equal(sw.up(104, 98), null, "Tippen ist kein Wischen");

  sw.down(100, 100, 24);
  assert.equal(sw.move(120, 118), null, "schräg und noch kurz");
  assert.equal(sw.up(130, 126), "R", "beim Loslassen zählt die längere Achse");
});

test("Wischen fortlaufend (Snake): eine Berührung lenkt mehrmals", () => {
  const sw = createSwipe({ continuous: true });
  const dirs = [];
  sw.down(200, 200, 18);
  for (const [x, y] of [[200, 190], [200, 175], [190, 175], [170, 176], [170, 196]]) {
    const d = sw.move(x, y);
    if (d) dirs.push(d);
  }
  const last = sw.up(170, 200);
  if (last) dirs.push(last);
  assert.deepEqual(dirs, ["U", "L", "D"]);
});

test("Tetris: Tippen dreht, langes Drücken tut nichts", () => {
  assert.deepEqual(play(createTetrisGesture(), 30, [[50, 50, 0], [53, 52, 60], [53, 52, 120]]), ["ROT"]);
  assert.deepEqual(play(createTetrisGesture(), 30, [[50, 50, 0], [52, 50, TAP_MS + 100]]), []);
});

test("Tetris: seitlich ziehen bewegt je Zellbreite eine Spalte", () => {
  const right = play(createTetrisGesture(), 30, path([50, 300], [155, 304], 400));
  assert.deepEqual(right, ["R", "R", "R"]);
  const g = createTetrisGesture();
  const out = play(g, 30, [...path([50, 300], [115, 300], 200), ...path([115, 300], [20, 302], 300, 216)]);
  assert.deepEqual(out, ["R", "R", "L", "L", "L"]);
});

test("Tetris: langsam nach unten zieht Zeile für Zeile, schräg nur seitwärts", () => {
  assert.deepEqual(play(createTetrisGesture(), 30, path([100, 100], [102, 195], 600)), ["SOFT", "SOFT", "SOFT"]);
  const diagonal = play(createTetrisGesture(), 30, path([100, 100], [190, 160], 600));
  assert.deepEqual(diagonal, ["R", "R", "R"]);
});

test("Tetris: schnell nach unten wischen legt ab, danach zählt die Berührung nicht mehr", () => {
  const g = createTetrisGesture();
  const flick = path([100, 100], [104, 220], 80);
  const out = play(g, 30, [...flick, [104, 400, 120], [200, 400, 200]]);
  assert.equal(out.filter((a) => a === "HARD").length, 1);
  assert.equal(out.at(-1), "HARD", "nach dem Ablegen kommt nichts mehr");
  assert.ok(!out.includes("R"));
});

test("Tetris: kurzes schnelles Zucken nach unten ist kein Ablegen", () => {
  const out = play(createTetrisGesture(), 30, path([100, 100], [100, 130], 20));
  assert.ok(!out.includes("HARD"), JSON.stringify(out));
});

test("Breakout: das Paddle folgt dem Finger und pendelt nicht", () => {
  const maxX = BE.W - BE.PADDLE_W;
  for (let trial = 0; trial < 300; trial++) {
    let x = Math.floor(Math.random() * (maxX + 1));
    let dir = "S";
    const target = Math.random() * BE.W;
    let changes = 0;
    for (let tick = 0; tick < 120; tick++) {
      const want = followDir(target, x, BE.PADDLE_W);
      if (want !== dir) { dir = want; changes++; }
      x += (dir === "L" ? -1 : dir === "R" ? 1 : 0) * BE.PADDLE_SPEED;
      x = Math.max(0, Math.min(maxX, x));
    }
    const c = x + BE.PADDLE_W / 2;
    const wall = x === 0 || x === maxX;
    assert.ok(Math.abs(c - target) <= 3 || wall, `Ziel ${target}, Mitte ${c}`);
    assert.ok(changes <= 2, `${changes} Richtungswechsel für ein festes Ziel`);
  }
});

test("Welche Zeiger steuern", () => {
  assert.equal(accepts("touch", "auto"), true);
  assert.equal(accepts("pen", "auto"), true);
  assert.equal(accepts("mouse", "auto"), false);
  assert.equal(accepts("mouse", "on"), true);
  assert.equal(accepts("touch", "off"), false);
});
