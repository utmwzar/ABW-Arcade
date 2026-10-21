// Prüft die reinen Teile von static/js/fx.js (in Node gibt es kein DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spring, reduceKeyframes, motion, animate } from "../../static/js/fx.js";
import { set, reset } from "../../static/js/prefs.js";

function points(easing) {
  assert.match(easing, /^linear\(.+\)$/);
  return easing.slice("linear(".length, -1).split(",").map(Number);
}

test("die Feder endet genau bei 1 und schwingt höchstens 4 % über", () => {
  const { easing, duration } = spring();
  const p = points(easing);
  assert.equal(p[0], 0);
  assert.equal(p.at(-1), 1);
  assert.ok(Math.max(...p) <= 1.04, `Überschwingen ${Math.max(...p)}`);
  assert.ok(duration >= 100 && duration <= 1200, `Dauer ${duration}`);
});

test("eine stark gedämpfte Feder schwingt nicht über", () => {
  const p = points(spring({ stiffness: 170, damping: 40 }).easing);
  assert.ok(Math.max(...p) <= 1);
});

test("reduzierte Bewegung behält nur die Deckkraft", () => {
  const kf = [
    { opacity: 0, transform: "translateY(12px)" },
    { opacity: 1, transform: "none" },
  ];
  assert.deepEqual(reduceKeyframes(kf), [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(reduceKeyframes([{ transform: "scale(1)" }, { transform: "scale(1.1)" }]), null);
});

test("motion() folgt der Einstellung, System ohne Medienabfrage heißt voll", () => {
  reset("ui.motion");
  assert.equal(motion(), "full");
  set("ui.motion", "reduced");
  assert.equal(motion(), "reduced");
  set("ui.motion", "off");
  assert.equal(motion(), "off");
  reset("ui.motion");
});

test("ohne animierbares Element passiert nichts", () => {
  assert.equal(animate(null, [{ opacity: 0 }, { opacity: 1 }]), null);
  assert.equal(animate({}, [{ opacity: 0 }, { opacity: 1 }]), null);
});
