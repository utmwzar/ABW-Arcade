// Effekte im Spielfeld: Partikel, Wackeln, Blitze, Spuren und kurze Texte.
// Regeln: .claude/skills/motion-gaming.
//
// Die Effekte haben eine eigene Uhr (update(dt) je Frame) und lesen nie aus
// einer Engine; was passiert ist, melden die Beobachter in static/js/observe/.
// Partikel kommen aus einem festen Vorrat, voll wird der älteste ersetzt.
// Gezeichnet wird in Spielkoordinaten, also mit derselben Transformation wie
// das Spielfeld (static/js/canvas.js).

const FLASH_GAP = 334;   // höchstens drei Blitze pro Sekunde (Lichtempfindlichkeit)

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const rand = (a, b) => a + Math.random() * (b - a);
const span = (v) => (Array.isArray(v) ? v : [v, v]);
const pick = (c) => (Array.isArray(c) ? c[(Math.random() * c.length) | 0] : c);

/**
 * width, height: Größe des Spielfelds in Spielkoordinaten (Blitz ohne Rechteck).
 * motion: () => "full" | "reduced" | "off" (fx.motion). Bei "reduced" gibt es
 * kein Wackeln, keine Spuren und knapp ein Drittel der Partikel, Texte steigen
 * nicht; bei "off" nichts.
 */
export function createCanvasFx({ width, height, maxParticles = 256, motion = () => "full" } = {}) {
  const pool = [];
  for (let i = 0; i < maxParticles; i++) {
    pool.push({ life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, size: 2, color: "#fff" });
  }
  let next = 0;
  let alive = 0;
  const rects = [];      // Blitze und Spuren: { list, color, alpha, t, ms, kind }
  const texts = [];
  let shaking = null;    // { t, ms, amp }
  let lastFlash = -Infinity;
  const waiting = [];    // settled()

  function emit(x, y, o) {
    const p = pool[next];
    next = (next + 1) % pool.length;
    if (p.life <= 0) alive++;
    const [s0, s1] = span(o.speed ?? [60, 180]);
    const [l0, l1] = span(o.life ?? [300, 600]);
    const [z0, z1] = span(o.size ?? [2, 4]);
    const a = (o.angle ?? 0) + (o.spread ?? Math.PI * 2) * (Math.random() - 0.5);
    const v = rand(s0, s1);
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * v + (o.vx ?? 0);
    p.vy = Math.sin(a) * v + (o.vy ?? 0);
    p.g = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.life = p.max = rand(l0, l1);
    p.size = rand(z0, z1);
    p.color = pick(o.color ?? "#fff");
  }

  // Partikel um (x, y). angle/spread in Bogenmaß (0 = nach rechts, y wächst
  // nach unten), speed px/s, life ms, gravity px/s², vx/vy addieren sich.
  function burst(x, y, o = {}) {
    const m = motion();
    if (m === "off") return;
    const count = o.count ?? 12;
    const n = m === "reduced" ? Math.ceil(count * 0.3) : count;
    for (let i = 0; i < n; i++) emit(x, y, o);
  }

  // Konfetti über die ganze Breite, für gewonnene Spiele.
  function confetti(colors, count = 70) {
    const m = motion();
    if (m === "off") return;
    const n = m === "reduced" ? Math.ceil(count * 0.3) : count;
    for (let i = 0; i < n; i++) {
      emit(rand(0, width), rand(-12, 0), {
        color: colors, angle: Math.PI / 2, spread: 1.1, speed: [40, 170],
        gravity: 240, drag: 0.01, life: [900, 1700], size: [3, 6],
      });
    }
  }

  // Blitz über Rechtecke (ohne: ganzes Feld). Höchstens drei pro Sekunde;
  // nie weiß über das ganze Feld.
  function flash({ rects: list = null, color = "#f0606b", alpha = 0.25, ms = 260 } = {}) {
    if (motion() === "off") return false;
    const t = now();
    if (t - lastFlash < FLASH_GAP) return false;
    lastFlash = t;
    rects.push({ list: list || [{ x: 0, y: 0, w: width, h: height }], color, alpha, t: 0, ms, kind: "flash" });
    return true;
  }

  // Spur: ein Rechteck, das ausblendet (z. B. hinter einem fallenden Stein).
  function trail({ x, y, w, h, color = "#fff", alpha = 0.3, ms = 200 }) {
    if (motion() !== "full") return;
    rects.push({ list: [{ x, y, w, h }], color, alpha, t: 0, ms, kind: "trail" });
  }

  function shake(amp = 4, ms = 300) {
    if (motion() !== "full") return;
    if (shaking && shaking.amp * (1 - shaking.t / shaking.ms) > amp) return;
    shaking = { t: 0, ms, amp };
  }

  function text(x, y, str, { color = "#eeeafe", ms = 900, rise = 18, size = 16 } = {}) {
    const m = motion();
    if (m === "off") return;
    if (texts.length >= 6) texts.shift();
    texts.push({ x, y, str, color, ms, rise: m === "full" ? rise : 0, size, t: 0 });
  }

  const busy = () => alive > 0 || rects.length > 0 || texts.length > 0 || shaking !== null;

  function release() {
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i];
      if (now() - w.start >= w.min && !busy()) {
        waiting.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve();
      }
    }
  }

  // Promise, die erfüllt ist, wenn alle Effekte durch sind: frühestens nach
  // min, spätestens nach max ms (auch wenn kein Frame mehr kommt).
  function settled({ min = 0, max = 900 } = {}) {
    if (motion() === "off") return Promise.resolve();
    return new Promise((resolve) => {
      const w = { start: now(), min, resolve, timer: 0 };
      w.timer = setTimeout(() => {
        const i = waiting.indexOf(w);
        if (i >= 0) waiting.splice(i, 1);
        resolve();
      }, max);
      waiting.push(w);
    });
  }

  function update(dt) {
    const s = dt / 1000;
    if (alive) {
      alive = 0;
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) continue;
        alive++;
        p.vy += p.g * s;
        if (p.drag) {
          const k = Math.pow(1 - p.drag, dt / 16.7);
          p.vx *= k; p.vy *= k;
        }
        p.x += p.vx * s;
        p.y += p.vy * s;
      }
    }
    for (let i = rects.length - 1; i >= 0; i--) {
      rects[i].t += dt;
      if (rects[i].t >= rects[i].ms) rects.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      texts[i].t += dt;
      if (texts[i].t >= texts[i].ms) texts.splice(i, 1);
    }
    if (shaking) {
      shaking.t += dt;
      if (shaking.t >= shaking.ms) shaking = null;
    }
    if (waiting.length) release();
  }

  // Vor dem Zeichnen der Szene, zwischen ctx.save() und ctx.restore().
  function applyShake(ctx) {
    if (!shaking) return;
    const k = 1 - shaking.t / shaking.ms;
    const a = shaking.amp * k * k;
    ctx.translate(Math.round(rand(-a, a)), Math.round(rand(-a, a)));
  }

  // Nach der Szene.
  function draw(ctx) {
    for (const r of rects) {
      const k = r.t / r.ms;
      const a = r.kind === "flash" ? (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8) : 1 - k;
      ctx.globalAlpha = Math.max(0, a) * r.alpha;
      ctx.fillStyle = r.color;
      for (const q of r.list) ctx.fillRect(q.x, q.y, q.w, q.h);
    }
    if (alive) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        const k = p.life / p.max;
        ctx.globalAlpha = k < 0.5 ? k * 2 : 1;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    if (texts.length) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of texts) {
        const k = t.t / t.ms;
        ctx.globalAlpha = k < 0.12 ? k / 0.12 : k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        ctx.font = `${t.size}px "Press Start 2P", monospace`;
        ctx.fillStyle = t.color;
        ctx.fillText(t.str, t.x, t.y - t.rise * k);
      }
    }
    ctx.globalAlpha = 1;
  }

  function reset() {
    for (const p of pool) p.life = 0;
    alive = 0;
    rects.length = 0;
    texts.length = 0;
    shaking = null;
    while (waiting.length) {
      const w = waiting.pop();
      clearTimeout(w.timer);
      w.resolve();
    }
  }

  return { burst, confetti, flash, trail, shake, text, update, applyShake, draw, busy, settled, reset };
}
