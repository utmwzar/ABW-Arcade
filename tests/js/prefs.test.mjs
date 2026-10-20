// Prüft static/js/prefs.js gegen Fake-Speicher: Defaults, Validierung,
// kaputte Werte, gesperrter Speicher und Abgleich zwischen Tabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrefs, SCHEMA } from "../../static/js/prefs.js";

class FakeStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

class ThrowingStorage {
  getItem() { throw new Error("SecurityError"); }
  setItem() { throw new Error("SecurityError"); }
  removeItem() { throw new Error("SecurityError"); }
}

class FullStorage extends FakeStorage {
  setItem() { throw new Error("QuotaExceededError"); }
}

const quiet = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};

test("ohne gespeicherte Werte gelten die Defaults", () => {
  const p = createPrefs(new FakeStorage());
  for (const [key, spec] of Object.entries(SCHEMA)) {
    assert.deepEqual(p.get(key), spec.default, key);
  }
});

test("gültige Werte werden als JSON unter abw.v1.* gespeichert", () => {
  const s = new FakeStorage();
  const p = createPrefs(s);
  assert.equal(p.set("chess.coords", false), true);
  assert.equal(s.getItem("abw.v1.chess.coords"), "false");
  assert.equal(p.get("chess.coords"), false);
  p.set("help.seen", ["tetris", "snake"]);
  assert.deepEqual(p.get("help.seen"), ["tetris", "snake"]);
});

test("ungültige Werte werden abgelehnt und nichts wird geschrieben", () => {
  const s = new FakeStorage();
  const p = createPrefs(s);
  quiet(() => {
    assert.equal(p.set("ui.motion", "wild"), false);
    assert.equal(p.set("chess.hints", "ja"), false);
    assert.equal(p.set("help.seen", ["<script>"]), false);
    assert.equal(p.set("help.seen", new Array(17).fill("tetris")), false);
  });
  assert.equal(s.m.size, 0);
});

test("ein kaputter gespeicherter Wert fällt auf den Default zurück", () => {
  const s = new FakeStorage();
  s.setItem("abw.v1.ui.touch", "{nicht json");
  s.setItem("abw.v1.chess.botLevel", JSON.stringify("unbesiegbar"));
  const p = createPrefs(s);
  assert.equal(p.get("ui.touch"), "auto");
  assert.equal(p.get("chess.botLevel"), "medium");
});

test("gesperrter Speicher: alles läuft im Arbeitsspeicher weiter", () => {
  const p = createPrefs(new ThrowingStorage());
  assert.equal(p.get("ui.motion"), "system");
  assert.equal(p.set("ui.motion", "reduced"), true);
  assert.equal(p.get("ui.motion"), "reduced");
});

test("volles Kontingent beim Schreiben: der Wert gilt für diese Sitzung", () => {
  const p = createPrefs(new FullStorage());
  assert.equal(p.set("doom.sound", false), true);
  assert.equal(p.get("doom.sound"), false);
});

test("zurückgegebene Listen sind Kopien", () => {
  const p = createPrefs(new FakeStorage());
  p.set("help.seen", ["tetris"]);
  p.get("help.seen").push("snake");
  assert.deepEqual(p.get("help.seen"), ["tetris"]);
});

test("subscribe meldet eigene Änderungen und solche aus anderen Tabs", () => {
  const s = new FakeStorage();
  const p = createPrefs(s);
  const seen = [];
  const off = p.subscribe("chess.hints", (v) => seen.push(v));
  p.set("chess.hints", false);
  s.setItem("abw.v1.chess.hints", "true");           // ein anderer Tab schreibt
  p.onStorageEvent({ key: "abw.v1.chess.hints" });
  p.onStorageEvent({ key: "fremd.schluessel" });      // wird ignoriert
  off();
  p.set("chess.hints", false);
  assert.deepEqual(seen, [false, true]);
});

test("unbekannte Schlüssel sind ein Programmierfehler", () => {
  const p = createPrefs(new FakeStorage());
  assert.throws(() => p.get("score.tetris"));
  assert.throws(() => p.set("score.tetris", 1));
});
