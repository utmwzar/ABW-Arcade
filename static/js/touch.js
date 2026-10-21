// Touch-Steuerung der Arcade-Spiele. Gesten auf dem Spielfeld werden zu genau
// den Aktionen, die auch die Tastatur auslöst; die Spiel-Skripte zeichnen sie
// wie Tastendrücke auf, für Engine und Server ist das dasselbe.
//
// Oben stehen die reinen Erkenner (geprüft in tests/js/touch.test.mjs), unten
// die Anbindung an Pointer Events. Welche Zeiger steuern, bestimmt die
// Einstellung ui.touch: "auto" Touch und Stift, "on" zusätzlich die Maus,
// "off" keiner – dann scrollt ein Wischen über das Spielfeld die Seite.

import { get as pref, subscribe } from "./prefs.js";

// ---------- reine Erkenner ----------

export const TAP_MS = 250;      // länger gehalten ist kein Tippen mehr
export const TAP_SLOP = 10;     // px, die ein Finger beim Tippen wandern darf
export const FLICK_V = 1.1;     // px/ms nach unten: ab hier legt Tetris sofort ab
const FLICK_WINDOW = 80;        // ms, über die die Geschwindigkeit gemessen wird

// Richtung einer Bewegung, oder null, solange sie zu kurz oder zu schräg ist.
// ratio: um wie viel die Hauptachse überwiegen muss.
export function swipeDir(dx, dy, threshold, ratio = 1) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  if (ax > ay && ax >= ay * ratio) return dx > 0 ? "R" : "L";
  if (ay > ax && ay >= ax * ratio) return dy > 0 ? "D" : "U";
  return null;
}

// Wischen: einmal je Berührung (2048) oder fortlaufend (Snake: nach jeder
// erkannten Richtung misst es neu, so lenkt eine Berührung mehrmals).
export function createSwipe({ continuous = false, ratio = 1.25 } = {}) {
  let x0 = 0, y0 = 0, min = 24, active = false, fired = false;
  return {
    down(x, y, threshold = 24) { x0 = x; y0 = y; min = threshold; active = true; fired = false; },
    move(x, y) {
      if (!active || (fired && !continuous)) return null;
      const dir = swipeDir(x - x0, y - y0, min, ratio);
      if (dir) { fired = true; x0 = x; y0 = y; }
      return dir;
    },
    // Beim Loslassen zählt auch eine schräge Bewegung, wenn sie lang genug war.
    up(x, y) {
      if (!active) return null;
      active = false;
      if (fired && !continuous) return null;
      return swipeDir(x - x0, y - y0, min);
    },
    cancel() { active = false; },
  };
}

// Tetris: Tippen dreht; seitlich ziehen bewegt um eine Spalte je Zellbreite;
// nach unten ziehen lässt Zeile für Zeile fallen; schnell nach unten wischen
// legt sofort ab, danach zählt die Berührung nicht mehr. Jeder Schritt liefert
// die Aktionen, die er auslöst (Zeiten in ms, Wege in CSS-Pixeln).
export function createTetrisGesture() {
  let g = null;

  function flick(x, y, t) {
    const old = g.hist[0];
    const dt = t - old.t;
    if (dt <= 0) return false;
    const dy = y - old.y;
    return dy / dt >= FLICK_V && y - g.y0 >= 1.5 * g.cell && dy > 2 * Math.abs(x - old.x);
  }

  function step(x, y, t) {
    g.hist.push({ x, y, t });
    while (g.hist.length > 2 && t - g.hist[1].t >= FLICK_WINDOW) g.hist.shift();
    if (!g.moved && Math.hypot(x - g.x0, y - g.y0) > TAP_SLOP) g.moved = true;
    if (flick(x, y, t)) { g.done = true; return ["HARD"]; }
    const out = [];
    // Seitwärts geht vor: Wer schräg zieht, will meist nur verschieben.
    while (x - g.ax >= g.cell) { out.push("R"); g.ax += g.cell; g.ay = y; }
    while (g.ax - x >= g.cell) { out.push("L"); g.ax -= g.cell; g.ay = y; }
    while (y - g.ay >= g.cell && y - g.ay > 1.5 * Math.abs(x - g.ax)) { out.push("SOFT"); g.ay += g.cell; }
    if (out.length) g.acted = true;
    return out;
  }

  return {
    down(x, y, t, cell) {
      g = { x0: x, y0: y, t0: t, ax: x, ay: y, cell, moved: false, acted: false, done: false, hist: [{ x, y, t }] };
    },
    move(x, y, t) {
      if (!g || g.done) return [];
      return step(x, y, t);
    },
    up(x, y, t) {
      if (!g || g.done) { g = null; return []; }
      const out = step(x, y, t);
      const tap = !g.moved && !g.acted && t - g.t0 <= TAP_MS;
      g = null;
      return tap ? ["ROT"] : out;
    },
    cancel() { g = null; },
  };
}

// Breakout: In welche Richtung muss das Paddle, damit seine Mitte zum Finger
// kommt? Die Totzone (halbe Paddle-Geschwindigkeit) verhindert ein Pendeln.
export function followDir(targetX, paddleX, paddleW, dead = 3) {
  const c = paddleX + paddleW / 2;
  if (targetX < c - dead) return "L";
  if (targetX > c + dead) return "R";
  return "S";
}

// Steuert dieser Zeiger bei dieser Einstellung?
export function accepts(pointerType, setting) {
  if (setting === "off") return false;
  if (pointerType === "mouse") return setting === "on";
  return true;   // touch, pen oder unbekannt
}

// ---------- Anbindung an Pointer Events ----------

const setting = () => pref("ui.touch");

// Wischen und Halten brauchen ein Spielfeld, das selbst nicht scrollt.
function claimTouch(el) {
  const apply = () => { el.style.touchAction = setting() === "off" ? "" : "none"; };
  apply();
  subscribe("ui.touch", apply);
  // Langes Drücken öffnet sonst das Kontextmenü über dem Spielfeld.
  el.addEventListener("contextmenu", (e) => { if (setting() !== "off") e.preventDefault(); });
}

// Abbruch bei Fensterwechsel: dort kommt kein pointerup mehr an.
function onLeave(fn) {
  window.addEventListener("blur", fn);
  document.addEventListener("visibilitychange", () => { if (document.hidden) fn(); });
}

// Ein Zeiger zur Zeit, mit Capture, damit ein Finger außerhalb des Spielfelds
// weiter zählt. Ein Abbruch (Systemgeste, Fensterwechsel) geht an onCancel,
// damit nichts gedrückt hängen bleibt.
function bindPointer(el, { onDown, onMove, onUp, onCancel }) {
  let id = null;
  claimTouch(el);
  const cancel = () => {
    if (id === null) return;
    id = null;
    onCancel();
  };
  el.addEventListener("pointerdown", (e) => {
    if (id !== null || !accepts(e.pointerType, setting()) || e.button !== 0) return;
    id = e.pointerId;
    try { el.setPointerCapture(id); } catch { /* ohne Capture geht es auch */ }
    e.preventDefault();
    onDown(e);
  });
  el.addEventListener("pointermove", (e) => { if (e.pointerId === id) onMove(e); });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== id) return;
    id = null;
    onUp(e);
  });
  el.addEventListener("pointercancel", (e) => { if (e.pointerId === id) cancel(); });
  el.addEventListener("lostpointercapture", (e) => { if (e.pointerId === id) cancel(); });
  onLeave(cancel);
}

// Wischen; onSwipe(dir) mit "U" | "D" | "L" | "R". threshold darf von der
// Größe des Spielfelds abhängen: (rect) => px.
export function bindSwipe(el, { threshold = 24, continuous = false, onSwipe }) {
  const sw = createSwipe({ continuous });
  bindPointer(el, {
    onDown(e) {
      const min = typeof threshold === "function" ? threshold(el.getBoundingClientRect()) : threshold;
      sw.down(e.clientX, e.clientY, min);
    },
    onMove(e) { const d = sw.move(e.clientX, e.clientY); if (d) onSwipe(d); },
    onUp(e) { const d = sw.up(e.clientX, e.clientY); if (d) onSwipe(d); },
    onCancel() { sw.cancel(); },
  });
}

// Tetris-Gesten; onStart() zu Beginn jeder Berührung, onAction(action) mit
// "L" | "R" | "ROT" | "SOFT" | "HARD".
export function bindTetris(el, { cols, onStart, onAction }) {
  const tg = createTetrisGesture();
  const emit = (actions) => actions.forEach(onAction);
  bindPointer(el, {
    onDown(e) {
      if (onStart) onStart();
      tg.down(e.clientX, e.clientY, e.timeStamp, el.getBoundingClientRect().width / cols);
    },
    onMove(e) { emit(tg.move(e.clientX, e.clientY, e.timeStamp)); },
    onUp(e) { emit(tg.up(e.clientX, e.clientY, e.timeStamp)); },
    onCancel() { tg.cancel(); },
  });
}

// Breakout: onMove(x) mit x zwischen 0 und 1 (Anteil der Spielfeldbreite),
// null beim Loslassen.
export function bindFollow(el, { onMove }) {
  const at = (e) => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  bindPointer(el, {
    onDown(e) { onMove(at(e)); },
    onMove(e) { onMove(at(e)); },
    onUp() { onMove(null); },
    onCancel() { onMove(null); },
  });
}

// Halten (Geometry Dash): gehalten, solange mindestens ein Finger liegt.
// mouse: true lässt die Maus unabhängig von der Einstellung zu.
// onPress() bekommt jede neue Berührung, auch wenn schon gehalten wird.
export function bindHold(el, { onChange, onPress, mouse = false }) {
  const down = new Set();
  claimTouch(el);
  const ok = (e) => (mouse && e.pointerType === "mouse") || accepts(e.pointerType, setting());
  const release = () => {
    if (!down.size) return;
    down.clear();
    onChange(false);
  };
  el.addEventListener("pointerdown", (e) => {
    if (!ok(e) || e.button !== 0) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* ohne Capture geht es auch */ }
    if (onPress && onPress() === false) return;
    const was = down.size;
    down.add(e.pointerId);
    if (!was) onChange(true);
  });
  const lift = (e) => {
    if (!down.delete(e.pointerId)) return;
    if (!down.size) onChange(false);
  };
  el.addEventListener("pointerup", lift);
  el.addEventListener("pointercancel", lift);
  el.addEventListener("lostpointercapture", lift);
  onLeave(release);
}
