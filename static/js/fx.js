// Bewegung für Overlays, Zahlen und Schachfiguren – ohne React, mit der
// Web Animations API. Regeln: .claude/skills/motion-gaming.
//
// Jede Funktion fragt motion() und hält sich daran: "off" setzt sofort den
// Endzustand, "reduced" blendet nur noch (keine Wege, kein Wackeln). Die
// globale CSS-Regel für reduzierte Bewegung erfasst element.animate() nicht,
// darum prüft dieses Modul selbst.

import { get as getPref } from "./prefs.js";

export const DUR = { short: 120, base: 200, long: 320 };
export const EASE_OUT = "cubic-bezier(.2, .8, .2, 1)";
export const EASE_IN = "cubic-bezier(.4, 0, 1, 1)";

const reducedQuery = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export function motion() {
  const p = getPref("ui.motion");
  if (p !== "system") return p;
  return reducedQuery && reducedQuery.matches ? "reduced" : "full";
}

// Eine gedämpfte Feder als CSS-Kurve linear(...). Bei den Standardwerten
// schwingt sie knapp über (~2 %), nie sichtbar federnd.
export function spring({ stiffness = 210, damping = 22, mass = 1 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const pos = (t) => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);   // gedämpft ohne Überschwingen
  };
  let settle = 0.1;
  for (let t = 0; t < 3; t += 1 / 240) {
    if (Math.abs(1 - pos(t)) > 0.001) settle = t;
  }
  const steps = 32;
  const points = [];
  for (let i = 0; i <= steps; i++) points.push(+pos(settle * i / steps).toFixed(4));
  points[steps] = 1;
  return { easing: `linear(${points.join(", ")})`, duration: Math.round(settle * 1000) };
}

const supportsLinear = typeof CSS !== "undefined" && CSS.supports &&
  CSS.supports("animation-timing-function", "linear(0, 1)");

function springOr(fallback) {
  return supportsLinear ? spring() : { easing: EASE_OUT, duration: fallback };
}

// Bei reduzierter Bewegung bleibt nur die Deckkraft übrig.
export function reduceKeyframes(keyframes) {
  const kept = keyframes
    .filter((k) => "opacity" in k)
    .map((k) => ({ opacity: k.opacity, ...(k.offset !== undefined ? { offset: k.offset } : {}) }));
  return kept.length >= 2 ? kept : null;
}

// Animation | null. Ohne Animation liegt das Element sofort im Endzustand,
// weil die Keyframes nur auf dem Weg dorthin gelten (fill: "backwards").
export function animate(el, keyframes, opts = {}) {
  const m = motion();
  if (!el || typeof el.animate !== "function" || m === "off") return null;
  const frames = m === "reduced" ? reduceKeyframes(keyframes) : keyframes;
  if (!frames) return null;
  const options = {
    duration: DUR.base,
    easing: EASE_OUT,
    fill: "backwards",
    ...opts,
  };
  if (m === "reduced") options.duration = Math.min(options.duration, DUR.base);
  return el.animate(frames, options);
}

const done = (a) => (a ? a.finished.catch(() => {}) : Promise.resolve());

const ENTER = {
  up: [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
  scale: [{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }],
  fade: [{ opacity: 0 }, { opacity: 1 }],
};
const EXIT = {
  down: [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px)" }],
  scale: [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.98)" }],
  fade: [{ opacity: 1 }, { opacity: 0 }],
};

// Zeigt das Element (hidden = false) und blendet es ein.
export function enter(el, { from = "up", delay = 0 } = {}) {
  if (!el) return Promise.resolve();
  el.hidden = false;
  const timing = from === "scale" ? springOr(DUR.long) : { duration: DUR.long, easing: EASE_OUT };
  return done(animate(el, ENTER[from] || ENTER.up, { ...timing, delay }));
}

// Blendet aus und versteckt das Element danach (hidden = true). Ausblenden
// ist kürzer als Einblenden.
export function exit(el, { to = "fade" } = {}) {
  if (!el) return Promise.resolve();
  const a = animate(el, EXIT[to] || EXIT.fade, { duration: DUR.base, easing: EASE_IN, fill: "forwards" });
  return done(a).then(() => {
    el.hidden = true;
    if (a) a.cancel();   // die gehaltene Endstellung darf ein späteres enter() nicht stören
  });
}

// Höchstens `max` Elemente gestaffelt; alle weiteren erscheinen mit dem letzten.
export function stagger(els, make, { step = 30, max = 6 } = {}) {
  return Array.from(els).map((el, i) => make(el, Math.min(i, max - 1) * step));
}

// FLIP: el steht schon an der neuen Stelle, first ist sein altes Rechteck.
export function flip(el, first, { duration = DUR.base, easing = EASE_OUT } = {}) {
  if (!el || !first) return null;
  const last = el.getBoundingClientRect();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (!dx && !dy) return null;
  return animate(el, [
    { transform: `translate(${dx}px, ${dy}px)` },
    { transform: "none" },
  ], { duration, easing });
}

// Zählt eine Zahl hoch. Bei reduzierter Bewegung steht sofort der Endwert da.
export function countTo(el, from, to, { ms = 600, format = (n) => n.toLocaleString("de-DE") } = {}) {
  if (!el) return Promise.resolve();
  if (motion() !== "full" || from === to) {
    el.textContent = format(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
}

export function bump(el) {
  return animate(el, [
    { transform: "scale(1)" }, { transform: "scale(1.06)", offset: 0.4 }, { transform: "scale(1)" },
  ], { duration: DUR.long });
}

export function shake(el) {
  return animate(el, [
    { transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(5px)" },
    { transform: "translateX(-3px)" }, { transform: "translateX(0)" },
  ], { duration: 260, easing: "linear" });
}

// Kurzes Aufleuchten über einem Element, etwa einer neuen Zeile im Leaderboard.
// Lichtblitze höchstens dreimal pro Sekunde.
let lastFlash = 0;
export function flash(el, { color = "var(--flash, currentColor)", strength = 0.22 } = {}) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!el || motion() === "off" || now - lastFlash < 333) return null;
  lastFlash = now;
  const glow = document.createElement("span");
  glow.setAttribute("aria-hidden", "true");
  glow.style.cssText = `position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:${color};opacity:0`;
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  el.appendChild(glow);
  const a = glow.animate([{ opacity: 0 }, { opacity: strength, offset: 0.25 }, { opacity: 0 }],
    { duration: 600, easing: EASE_OUT });
  a.finished.catch(() => {}).then(() => glow.remove());
  return a;
}
