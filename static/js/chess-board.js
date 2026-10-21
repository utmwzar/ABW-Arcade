// Schachbrett als Bauteil. Die 64 Felder entstehen einmal; die Figuren liegen
// als eigene Ebene darüber und gleiten bei jedem Zug an ihr neues Feld
// (Rochade und en passant inklusive). Bedienung: Klick-Klick, Ziehen mit Maus
// oder Finger (Pointer Events) und Tastatur (Pfeile, Enter, Esc).
// Regeln kennt das Brett nicht: Welche Züge gehen, sagt der Server.

import { FILES, NAMES, isWhite, sqName } from "./chess-notation.js";

const SRC = (p) => `/static/chess/pieces/${isWhite(p) ? "w" : "b"}${p.toUpperCase()}.svg`;
const DRAG_PX = 5;

function label(sq, p) {
  if (!p) return `${sq}, leer`;
  const type = p.toUpperCase();
  const color = isWhite(p) ? "weiß" : "schwarz";
  return `${sq}, ${color}${type === "Q" ? "e" : "er"} ${NAMES[type]}`;   // die Dame, der Rest
}

export class Board {
  /**
   * root: leeres Element. opts.onMove(from, to, { promo }) wird bei einem
   * erlaubten Zug gerufen; opts.announce(text) für Ansagen an Screenreader.
   */
  constructor(root, { onMove, announce } = {}) {
    this.root = root;
    this.onMove = onMove || (() => {});
    this.announce = announce || (() => {});
    this.orientation = "w";
    this.board = null;
    this.legal = null;          // { from: [{to, promo}] } oder null = keine Eingabe
    this.selected = null;
    this.cursor = "e2";
    this.pieces = new Map();    // Feld -> { el, p }
    this.drag = null;

    root.classList.add("board");
    this.grid = document.createElement("div");
    this.grid.className = "board-grid";
    this.grid.setAttribute("role", "grid");
    this.grid.setAttribute("aria-label", "Schachbrett");
    // Koordinaten als eigene Ebene, nicht in den Feldern: Der Name eines Feldes
    // ("a8, schwarzer Turm") soll genau das sein, was dort zu lesen ist.
    this.coords = document.createElement("div");
    this.coords.className = "board-coords";
    this.coords.setAttribute("aria-hidden", "true");
    this.layer = document.createElement("div");
    this.layer.className = "board-pieces";
    this.layer.setAttribute("aria-hidden", "true");
    root.append(this.grid, this.coords, this.layer);

    this.squares = new Map();
    for (let y = 0; y < 8; y++) {
      const row = document.createElement("div");
      row.setAttribute("role", "row");
      row.className = "board-row";
      for (let x = 0; x < 8; x++) {
        const el = document.createElement("div");
        el.setAttribute("role", "gridcell");
        el.tabIndex = -1;
        row.append(el);
      }
      this.grid.append(row);
    }
    this.layout();

    root.addEventListener("pointerdown", (e) => this.down(e));
    root.addEventListener("pointermove", (e) => this.move(e));
    root.addEventListener("pointerup", (e) => this.up(e));
    root.addEventListener("pointercancel", () => this.cancelDrag());
    this.grid.addEventListener("keydown", (e) => this.key(e));
    this.grid.addEventListener("focusin", (e) => {
      const sq = e.target.dataset && e.target.dataset.sq;
      if (sq) this.cursor = sq;
    });
  }

  // ---------- Darstellung ----------
  /** Welches Feld steht an Bildschirmposition (x, y)? */
  at(x, y) {
    return this.orientation === "w" ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
  }

  xy(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]);
    return this.orientation === "w" ? [f, 8 - r] : [7 - f, r - 1];
  }

  layout() {
    this.squares.clear();
    const shade = (sq) => ((FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0 ? "light" : "dark");   // a1 dunkel, h1 hell
    const cells = this.grid.querySelectorAll("[role=gridcell]");
    cells.forEach((el, i) => {
      const sq = this.at(i % 8, Math.floor(i / 8));
      el.className = `sq ${shade(sq)}`;
      el.dataset.sq = sq;
      this.squares.set(sq, el);
    });
    // Ziffern am linken Rand, Buchstaben unten; die Farbe passt zum Feld darunter.
    const coord = (cls, text, sq, i) => {
      const span = Object.assign(document.createElement("span"), { className: `coord ${cls} on-${shade(sq)}`, textContent: text });
      span.style.setProperty("--i", i);
      return span;
    };
    const labels = [];
    for (let i = 0; i < 8; i++) {
      const left = this.at(0, i), bottom = this.at(i, 7);
      labels.push(coord("rank", left[1], left, i), coord("file", bottom[0], bottom, i));
    }
    this.coords.replaceChildren(...labels);
    for (const [sq, piece] of this.pieces) this.place(piece.el, sq);
    this.syncCursor();
    this.paintMarks();
  }

  setOrientation(color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this.layout();
  }

  place(el, sq) {
    const [x, y] = this.xy(sq);
    el.style.setProperty("--x", x);
    el.style.setProperty("--y", y);
  }

  /** Neue Stellung zeigen. Figuren, die sich bewegt haben, gleiten hin. */
  setPosition(board, { animate = true } = {}) {
    const next = new Map();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (board[r][c]) next.set(sqName(r, c), board[r][c]);
    }
    const old = this.pieces;
    const used = new Set();
    const result = new Map();
    // 1) Unveränderte Felder behalten ihre Figur.
    for (const [sq, p] of next) {
      const o = old.get(sq);
      if (o && o.p === p) { result.set(sq, o); used.add(sq); }
    }
    // 2) Bewegte Figuren: nächstgelegene gleiche Figur, die ihr Feld verlassen hat.
    const dist = (a, b) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(a[1] - b[1]);
    for (const [sq, p] of next) {
      if (result.has(sq)) continue;
      let best = null;
      for (const [osq, o] of old) {
        if (used.has(osq) || o.p !== p || (next.get(osq) === p)) continue;
        if (!best || dist(osq, sq) < dist(best, sq)) best = osq;
      }
      if (best) {
        const o = old.get(best);
        used.add(best);
        result.set(sq, o);
        this.place(o.el, sq);
        if (animate) this.lift(o.el);
      } else {
        const el = document.createElement("img");
        el.className = "pc";
        el.alt = "";
        el.draggable = false;
        el.src = SRC(p);
        this.place(el, sq);
        if (animate && this.board) el.classList.add("appear");
        this.layer.append(el);
        result.set(sq, { el, p });
      }
    }
    // 3) Was übrig ist, wurde geschlagen.
    for (const [osq, o] of old) {
      if (used.has(osq)) continue;
      if (animate && this.board) {
        o.el.classList.add("gone");
        setTimeout(() => o.el.remove(), 260);
      } else {
        o.el.remove();
      }
    }
    if (!animate) this.root.classList.add("no-anim");
    this.pieces = result;
    this.board = board;
    for (const [sq, el] of this.squares) el.setAttribute("aria-label", label(sq, next.get(sq)));
    if (!animate) requestAnimationFrame(() => this.root.classList.remove("no-anim"));
    if (this.selected && !(this.legal && this.legal[this.selected])) this.selected = null;
    this.paintMarks();
  }

  lift(el) {
    el.classList.add("moving");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("moving"), 260);
  }

  /** Markierungen: letzter Zug, Schach, Matt. */
  setMarks({ last = null, check = null, mate = false } = {}) {
    this.marks = { last, check, mate };
    this.paintMarks();
  }

  paintMarks() {
    const m = this.marks || {};
    const targets = this.targets();
    for (const [sq, el] of this.squares) {
      el.classList.toggle("last", !!(m.last && m.last.includes(sq)));
      el.classList.toggle("check", m.check === sq && !m.mate);
      el.classList.toggle("mate", m.check === sq && !!m.mate);
      el.classList.toggle("sel", this.selected === sq);
      const t = targets.get(sq);
      el.classList.toggle("target", !!t);
      el.classList.toggle("capture", !!t && !!(this.board && this.pieceAt(sq)));
      el.classList.toggle("movable", !!(this.legal && this.legal[sq]));
    }
  }

  pieceAt(sq) {
    const p = this.pieces.get(sq);
    return p ? p.p : null;
  }

  // ---------- Eingabe ----------
  /** legal = Zugkarte vom Server, wenn du am Zug bist; sonst null. */
  setLegal(legal) {
    this.legal = legal && Object.keys(legal).length ? legal : null;
    if (!this.legal) this.selected = null;
    this.root.classList.toggle("can-move", !!this.legal);
    this.paintMarks();
  }

  targets() {
    const out = new Map();
    if (this.selected && this.legal && this.legal[this.selected]) {
      for (const mv of this.legal[this.selected]) out.set(mv.to, mv);
    }
    return out;
  }

  select(sq) {
    this.selected = sq;
    this.paintMarks();
    if (sq) {
      const p = this.pieceAt(sq);
      const n = (this.legal[sq] || []).length;
      this.announce(`${NAMES[p.toUpperCase()]} ${sq} gewählt, ${n} ${n === 1 ? "Zug" : "Züge"} möglich.`);
    }
  }

  /** Klick oder Enter auf ein Feld. */
  tap(sq) {
    if (!this.legal) return;
    const t = this.targets().get(sq);
    if (t) {
      const from = this.selected;
      this.selected = null;
      this.paintMarks();
      this.onMove(from, sq, { promo: !!t.promo });
      return;
    }
    if (this.legal[sq]) this.select(this.selected === sq ? null : sq);
    else if (this.selected) this.select(null);
  }

  squareFromPoint(e) {
    const rect = this.grid.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.at(x, y);
  }

  down(e) {
    if (e.button !== 0 || !this.legal) return;
    const sq = this.squareFromPoint(e);
    if (!sq) return;
    if (this.legal[sq]) {
      e.preventDefault();
      const piece = this.pieces.get(sq);
      this.drag = { from: sq, x: e.clientX, y: e.clientY, el: piece && piece.el, active: false, id: e.pointerId };
      this.root.setPointerCapture(e.pointerId);
      if (this.selected !== sq) this.select(sq);
      else this.drag.wasSelected = true;
    } else {
      this.tap(sq);
    }
  }

  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
    if (!d.el) return;
    d.active = true;
    const rect = this.layer.getBoundingClientRect();
    const size = rect.width / 8;
    d.el.classList.add("dragging");
    d.el.style.transform = `translate(${e.clientX - rect.left - size / 2}px, ${e.clientY - rect.top - size / 2}px)`;
    const over = this.squareFromPoint(e);
    for (const [sq, el] of this.squares) el.classList.toggle("over", sq === over && this.targets().has(sq));
  }

  up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    for (const el of this.squares.values()) el.classList.remove("over");
    if (d.el) { d.el.classList.remove("dragging"); d.el.style.transform = ""; }
    const sq = this.squareFromPoint(e);
    if (!d.active) {
      // Klick: zweiter Klick auf dieselbe Figur hebt die Auswahl auf.
      if (sq === d.from && d.wasSelected) this.select(null);
      return;
    }
    const t = sq && this.targets().get(sq);
    if (t) {
      if (d.el) this.place(d.el, sq);   // ohne Rückweg-Animation dort liegen lassen
      this.selected = null;
      this.paintMarks();
      this.onMove(d.from, sq, { promo: !!t.promo, dropped: true });
    }
  }

  cancelDrag() {
    if (!this.drag) return;
    if (this.drag.el) { this.drag.el.classList.remove("dragging"); this.drag.el.style.transform = ""; }
    this.drag = null;
  }

  // ---------- Tastatur ----------
  syncCursor() {
    for (const [sq, el] of this.squares) el.tabIndex = sq === this.cursor ? 0 : -1;
  }

  key(e) {
    const steps = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (steps[e.key]) {
      e.preventDefault();
      const [x, y] = this.xy(this.cursor);
      const nx = Math.min(7, Math.max(0, x + steps[e.key][0]));
      const ny = Math.min(7, Math.max(0, y + steps[e.key][1]));
      this.cursor = this.at(nx, ny);
      this.syncCursor();
      this.squares.get(this.cursor).focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.tap(this.cursor);
    } else if (e.key === "Escape" && this.selected) {
      e.preventDefault();
      this.select(null);
      this.announce("Auswahl aufgehoben.");
    }
  }

  focus() {
    const el = this.squares.get(this.cursor);
    if (el) el.focus();
  }
}
