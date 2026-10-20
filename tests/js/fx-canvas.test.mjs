// Prüft static/js/fx-canvas.js ohne Browser: mit einem Canvas-Kontext, der
// nur mitschreibt, was gezeichnet wird.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvasFx } from "../../static/js/fx-canvas.js";

function fakeCtx() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1, fillStyle: "", font: "", textAlign: "", textBaseline: "",
    fillRect(x, y, w, h) { calls.push(["rect", x, y, w, h, this.globalAlpha]); },
    fillText(s, x, y) { calls.push(["text", s, x, y]); },
    translate(x, y) { calls.push(["translate", x, y]); },
  };
}

const make = (mode = "full", max = 256) =>
  createCanvasFx({ width: 300, height: 600, maxParticles: max, motion: () => mode });

function run(fx, ms, step = 16) {
  for (let t = 0; t < ms; t += step) fx.update(step);
}

test("Partikel leben ihre Zeit und sind dann weg", () => {
  const fx = make();
  assert.equal(fx.busy(), false);
  fx.burst(10, 10, { count: 20, life: [100, 200] });
  assert.equal(fx.busy(), true);
  const ctx = fakeCtx();
  fx.draw(ctx);
  assert.equal(ctx.calls.filter((c) => c[0] === "rect").length, 20);
  run(fx, 220);
  assert.equal(fx.busy(), false);
});

test("der Vorrat ist begrenzt, Neues ersetzt das Älteste", () => {
  const fx = make("full", 32);
  fx.burst(0, 0, { count: 100, life: 1000 });
  const ctx = fakeCtx();
  fx.draw(ctx);
  assert.equal(ctx.calls.filter((c) => c[0] === "rect").length, 32);
});

test("reduzierte Bewegung: weniger Partikel, kein Wackeln, keine Spuren", () => {
  const fx = make("reduced");
  fx.burst(0, 0, { count: 20 });
  fx.shake(8, 300);
  fx.trail({ x: 0, y: 0, w: 10, h: 100 });
  const ctx = fakeCtx();
  fx.applyShake(ctx);
  fx.draw(ctx);
  assert.equal(ctx.calls.filter((c) => c[0] === "rect").length, 6);
  assert.equal(ctx.calls.filter((c) => c[0] === "translate").length, 0);
});

test("Bewegung aus: gar nichts", () => {
  const fx = make("off");
  fx.burst(0, 0, { count: 20 });
  fx.confetti(["#fff"]);
  fx.shake(8, 300);
  assert.equal(fx.flash(), false);
  fx.text(10, 10, "LEVEL 2");
  assert.equal(fx.busy(), false);
});

test("Wackeln klingt ab und verschiebt nur innerhalb der Stärke", () => {
  const fx = make();
  fx.shake(6, 200);
  for (let i = 0; i < 10; i++) {
    const ctx = fakeCtx();
    fx.applyShake(ctx);
    const [, x, y] = ctx.calls[0];
    assert.ok(Math.abs(x) <= 6 && Math.abs(y) <= 6);
    fx.update(16);
  }
  run(fx, 200);
  assert.equal(fx.busy(), false);
});

test("höchstens drei Blitze pro Sekunde", () => {
  const fx = make();
  assert.equal(fx.flash(), true);
  assert.equal(fx.flash(), false, "direkt danach kein zweiter Blitz");
});

test("settled wartet auf das Ende der Effekte, höchstens max", async () => {
  const fx = make();
  fx.burst(0, 0, { count: 5, life: 50 });
  let done = false;
  const p = fx.settled({ min: 0, max: 5000 }).then(() => { done = true; });
  fx.update(16);
  await Promise.resolve();
  assert.equal(done, false);
  run(fx, 80);
  await p;
  assert.equal(done, true);

  const fx2 = make();
  fx2.burst(0, 0, { count: 5, life: 10000 });
  const t0 = Date.now();
  await fx2.settled({ max: 60 });
  assert.ok(Date.now() - t0 < 1000, "max greift auch ohne Frames");
});

test("reset beendet alles und löst wartende settled auf", async () => {
  const fx = make();
  fx.burst(0, 0, { count: 5, life: 10000 });
  fx.shake(4, 10000);
  const p = fx.settled({ max: 100000 });
  fx.reset();
  await p;
  assert.equal(fx.busy(), false);
});
