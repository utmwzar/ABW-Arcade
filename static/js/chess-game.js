// Eine Schachpartie: Brett, Spieler, Zugliste mit Nachspielen, Remis und
// Aufgabe, Spielende mit Elo-Änderung. Regeln prüft allein der Server; diese
// Seite zeigt seinen Stand und schickt Züge.

import { Board } from "./chess-board.js";
import { replay, applyMove, notation, spoken, material, rc, isWhite, NAMES } from "./chess-notation.js";
import { toast, ask } from "./shell.js";
import { get as pref, subscribe } from "./prefs.js";
import { countTo } from "./fx.js";

const page = document.querySelector("[data-game-id]");
const GAME_ID = page.dataset.gameId;
const $ = (sel) => page.querySelector(sel);
const fmt = (n) => Number(n).toLocaleString("de-DE");

const REASON = {
  checkmate: "Schachmatt", stalemate: "Patt", resign: "Aufgabe", draw_agreed: "Remis vereinbart",
  fifty_move: "50-Züge-Regel", repetition: "dreifache Stellungswiederholung", material: "zu wenig Material",
};
const ERRORS = {
  illegal_move: "Dieser Zug ist nicht erlaubt.",
  not_your_turn: "Du bist gerade nicht am Zug.",
  not_active: "Die Partie ist schon beendet.",
  promotion_required: "Wähle eine Figur für die Umwandlung.",
};

const ui = {
  sub: $("[data-sub]"),
  status: $("[data-status]"),
  live: $("[data-live]"),
  draw: $("[data-draw]"),
  moves: $("[data-moves]"),
  note: $("[data-replay-note]"),
  actions: $("[data-actions]"),
  end: $("[data-end]"),
  bars: { top: $('[data-player="top"]'), bottom: $('[data-player="bottom"]') },
  promo: document.getElementById("promo"),
};

let game = null;          // letzter Stand vom Server
let boards = [];          // Stellungen zur Zugliste
let view = null;          // null = aktuelle Stellung, sonst Zahl der Halbzüge
let sending = false;
let endClosed = false;    // Ergebnis-Karte weggeklickt
const announce = (text) => { ui.live.textContent = text; };

const board = new Board($("[data-board]"), { onMove: move, announce });

// ---------- Darstellung ----------
const opp = (c) => (c === "w" ? "b" : "w");
const key = (c) => (c === "w" ? "white" : "black");

function kingSquare(b, color) {
  const k = color === "w" ? "K" : "k";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (b[r][c] === k) return "abcdefgh"[c] + (8 - r);
  return null;
}

function nameOf(color) {
  const p = game[key(color)];
  return p ? p.name : "?";
}

function outcome() {
  if (game.status !== "finished") return null;
  if (game.result === "draw") return "draw";
  return (game.result === "white") === (game.you === "w") ? "win" : "loss";
}

function statusText() {
  if (game.status === "waiting") return "Warte auf einen Gegner. Sobald jemand beitritt, geht es los.";
  if (game.status === "finished") {
    const reason = REASON[game.end_reason] || game.end_reason;
    return { win: `Du hast gewonnen – ${reason}`, loss: `Du hast verloren – ${reason}`, draw: `Remis – ${reason}` }[outcome()];
  }
  const myTurn = game.turn === game.you;
  if (sending) return game.bot_level ? "Der Bot denkt …" : "Zug wird gesendet …";
  if (myTurn) return game.in_check ? "Du stehst im Schach. Du bist am Zug." : "Du bist am Zug.";
  return (game.in_check ? "Schach! " : "") + `${nameOf(game.turn)} ist am Zug.`;
}

function renderStatus() {
  const text = statusText();
  ui.status.textContent = text;
  ui.status.dataset.tone = game.status === "finished" ? outcome()
    : game.status === "active" && game.turn === game.you && !sending ? "turn" : "";
  document.title = game.status === "active" && game.turn === game.you
    ? "Du bist am Zug · Schach · ABW Arcade" : "Partie · Schach · ABW Arcade";
}

function renderBars() {
  const me = game.you;
  const { captured, balance } = material(game.history);
  for (const [slot, color] of [["bottom", me], ["top", opp(me)]]) {
    const bar = ui.bars[slot];
    const p = game[key(color)];
    bar.querySelector("[data-dot]").className = `dot dot-${color}`;
    bar.querySelector("[data-name]").textContent = p ? p.name : "Noch offen";
    bar.querySelector("[data-rating]").textContent = p && p.rating != null ? fmt(p.rating) : "";
    bar.querySelector("[data-turn]").hidden = !(game.status === "active" && game.turn === color);
    const box = bar.querySelector("[data-captured]");
    box.replaceChildren(...captured[color].map((pc) => Object.assign(document.createElement("img"), {
      src: `/static/chess/pieces/${isWhite(pc) ? "w" : "b"}${pc.toUpperCase()}.svg`, alt: "", className: "cap",
    })));
    const lead = color === "w" ? balance : -balance;
    if (lead > 0) box.append(Object.assign(document.createElement("span"), { className: "lead", textContent: `+${lead}` }));
    box.setAttribute("aria-label", captured[color].length
      ? `Geschlagen: ${captured[color].map((pc) => NAMES[pc.toUpperCase()]).join(", ")}` : "Noch nichts geschlagen");
  }
}

function renderBoard({ animate }) {
  const live = view === null;
  const ply = live ? game.history.length : view;
  const position = live ? game.board : boards[ply];
  board.setOrientation(game.you === "b" ? "b" : "w");
  board.setPosition(position, { animate });
  const last = ply > 0 ? game.history[ply - 1] : null;
  const toMove = ply % 2 === 0 ? "w" : "b";
  const mate = game.end_reason === "checkmate" && ply === game.history.length;
  board.setMarks({
    last: last ? [last.from, last.to] : null,
    check: last && last.check ? kingSquare(position, toMove) : null,
    mate,
  });
  board.setLegal(live && !sending && game.status === "active" && game.turn === game.you ? game.legal : null);
}

function renderMoves() {
  const atEnd = ui.moves.scrollHeight - ui.moves.scrollTop - ui.moves.clientHeight < 8;
  const shown = view === null ? game.history.length : view;
  const items = [];
  for (let i = 0; i < game.history.length; i += 2) {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { className: "mvno", textContent: `${i / 2 + 1}.` }));
    for (const j of [i, i + 1]) {
      const m = game.history[j];
      if (!m) break;
      const mate = game.end_reason === "checkmate" && j === game.history.length - 1;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mv";
      b.dataset.ply = j + 1;
      b.textContent = notation(m, { mate });
      b.setAttribute("aria-label", `${j % 2 ? "Schwarz" : "Weiß"}: ${spoken(m, { mate })}`);
      if (j + 1 === shown) b.setAttribute("aria-current", "step");
      li.append(b);
    }
    items.push(li);
  }
  if (!items.length) {
    items.push(Object.assign(document.createElement("li"), { className: "moves-empty", textContent: "Noch keine Züge." }));
  }
  ui.moves.replaceChildren(...items);
  if (view === null ? atEnd || sending : false) ui.moves.scrollTop = ui.moves.scrollHeight;
  const cur = ui.moves.querySelector("[aria-current]");
  if (view !== null && cur) cur.scrollIntoView({ block: "nearest" });

  const n = game.history.length;
  page.querySelectorAll("[data-nav]").forEach((btn) => {
    const to = btn.dataset.nav;
    btn.disabled = n === 0 || ((to === "first" || to === "prev") && shown === 0) ||
      ((to === "next" || to === "live") && view === null);
  });
  ui.note.hidden = view === null;
  if (view !== null) {
    ui.note.querySelector("[data-note-text]").textContent = view === 0
      ? "Du siehst die Startstellung."
      : `Du siehst die Stellung nach Zug ${Math.ceil(view / 2)} von ${view % 2 ? "Weiß" : "Schwarz"}.`;
  }
}

function renderDraw() {
  const offer = game.status === "active" && game.draw_offer;
  ui.draw.hidden = !offer;
  if (!offer) return;
  const text = ui.draw.querySelector("[data-draw-text]");
  const mine = game.draw_offer === game.you;
  text.textContent = mine ? "Du hast Remis angeboten. Warte auf die Antwort."
    : `${nameOf(opp(game.you))} bietet Remis an.`;
  ui.draw.querySelector("[data-draw-actions]").hidden = mine;
}

function renderActions() {
  const active = game.status === "active";
  ui.actions.hidden = !active;
  const drawBtn = ui.actions.querySelector('[data-act="draw"]');
  drawBtn.hidden = !!game.bot_level;
  drawBtn.disabled = !!game.draw_offer || sending;
  ui.actions.querySelector('[data-act="resign"]').disabled = sending;
}

function renderSub() {
  const opponent = nameOf(opp(game.you));
  const parts = [`gegen ${opponent}`, `du spielst ${game.you === "w" ? "Weiß" : "Schwarz"}`];
  if (game.bot_level) parts.push("ohne Elo-Wertung");
  ui.sub.textContent = game.status === "waiting" ? "Wartet auf einen Gegner" : parts.join(" · ");
}

function renderEnd() {
  const res = outcome();
  if (!res || endClosed) { ui.end.hidden = true; return; }
  if (!ui.end.hidden) return;
  const title = { win: "DU HAST GEWONNEN", loss: "DU HAST VERLOREN", draw: "REMIS" }[res];
  ui.end.querySelector("[data-end-title]").textContent = title;
  const moves = Math.ceil(game.history.length / 2);
  const reason = REASON[game.end_reason] || game.end_reason;
  ui.end.querySelector("[data-end-reason]").textContent =
    `${reason} ${moves ? `im ${moves}. Zug ` : ""}gegen ${nameOf(opp(game.you))}`;
  const eloBox = ui.end.querySelector("[data-end-elo]");
  const me = game[key(game.you)];
  const delta = game.rating_delta ? game.rating_delta[key(game.you)] : null;
  if (delta != null && me && me.rating != null) {
    const num = Object.assign(document.createElement("b"), { textContent: fmt(me.rating - delta) });
    const d = Object.assign(document.createElement("span"), {
      className: `delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`,
      textContent: `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta)} Elo`,
    });
    eloBox.replaceChildren(num, d);
    countTo(num, me.rating - delta, me.rating, { ms: 700, format: fmt });
  } else {
    eloBox.replaceChildren(game.bot_level ? "Übungspartie, ohne Elo-Wertung" : "");
  }
  ui.end.querySelector('[data-end-act="again"]').hidden = !game.bot_level;
  ui.end.querySelector('[data-end-act="lobby"]').hidden = !!game.bot_level;
  ui.end.hidden = false;
  ui.end.querySelector(".overlay-card").focus({ preventScroll: true });
  announce(`${statusText()}.`);
}

function render({ animate = true } = {}) {
  renderSub();
  renderStatus();
  renderBars();
  renderBoard({ animate });
  renderMoves();
  renderDraw();
  renderActions();
  renderEnd();
}

// ---------- Stand vom Server übernehmen ----------
function adopt(s, { animate = true } = {}) {
  if (game && s.version < game.version) return;   // veraltete Antwort
  const first = !game;
  if (!first && s.version === game.version && s.status === game.status) return;
  const joined = game && game.status === "waiting" && s.status === "active";
  const lastBefore = game ? game.history.length : 0;
  game = s;
  boards = replay(s.history);
  render({ animate: animate && !first });
  if (joined) toast(`${nameOf(opp(game.you))} ist beigetreten. Du spielst ${game.you === "w" ? "Weiß" : "Schwarz"}.`);
  if (!first && s.history.length > lastBefore && s.turn === s.you && s.status === "active") {
    const m = s.history[s.history.length - 1];
    announce(`${nameOf(opp(s.you))}: ${spoken(m)}. Du bist am Zug.`);
  }
}

// ---------- Abfragen ----------
let timer = null;
let failures = 0;

function pace() {
  if (!game) return 2000;
  if (game.status === "finished") return null;
  if (game.status === "waiting") return 3000;
  return game.turn === game.you ? 6000 : 2000;   // am Zug: nur auf Remis oder Aufgabe achten
}

function schedule(ms) {
  clearTimeout(timer);
  if (ms != null) timer = setTimeout(poll, ms);
}

async function poll() {
  if (document.hidden) return;   // weiter beim Zurückkommen (visibilitychange)
  try {
    const res = await fetch(`/api/chess/state/${GAME_ID}`, { cache: "no-store" });
    if (res.status === 401) { location.assign(`/login?next=${encodeURIComponent(location.pathname)}`); return; }
    if (res.status === 403 || res.status === 404) { location.assign("/games/chess"); return; }
    if (!res.ok) throw new Error(String(res.status));
    failures = 0;
    const s = await res.json();
    if (!sending) adopt(s);
  } catch (e) {
    failures += 1;
  }
  const base = pace();
  schedule(base == null ? null : Math.min(30000, base * 2 ** Math.min(failures, 4)));
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { clearTimeout(timer); poll(); }
});

// ---------- Züge ----------
// Für die sofortige Anzeige: Sonderzüge aus der Stellung erkennen.
function guess(b, from, to, promo) {
  const [fr, fc] = rc(from);
  const [tr, tc] = rc(to);
  const piece = b[fr][fc];
  const kind = piece.toUpperCase();
  let flag = null;
  if (kind === "K" && Math.abs(tc - fc) === 2) flag = tc > fc ? "OO" : "OOO";
  else if (kind === "P" && fc !== tc && !b[tr][tc]) flag = "ep";
  else if (promo) flag = "promo";
  return { from, to, piece, capture: b[tr][tc], promo, flag, check: false };
}

function choosePromotion(color) {
  const dlg = ui.promo;
  if (!dlg || typeof dlg.showModal !== "function") return Promise.resolve("Q");
  dlg.querySelectorAll("[data-promo]").forEach((btn) => {
    btn.querySelector("img").src = `/static/chess/pieces/${color}${btn.dataset.promo}.svg`;
  });
  dlg.returnValue = "";
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue || null), { once: true });
    dlg.showModal();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function move(from, to, { promo }) {
  if (sending || !game || game.status !== "active") return;
  let promotion = null;
  if (promo) {
    promotion = await choosePromotion(game.you);
    if (!promotion) { renderBoard({ animate: true }); return; }
  }
  const before = game;
  sending = true;
  const mine = guess(before.board, from, to, promotion);
  board.setLegal(null);
  board.setPosition(applyMove(before.board, mine), { animate: true });
  board.setMarks({ last: [from, to], check: null, mate: false });
  renderStatus();
  renderActions();

  let res, data;
  try {
    res = await fetch(`/api/chess/move/${GAME_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, promotion, expected_version: before.version }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    sending = false;
    toast("Keine Verbindung. Der Zug wurde nicht gesendet.");
    render();
    schedule(2000);
    return;
  }
  if (res.ok) {
    // Antwortet der Bot im selben Schritt, gleitet sein Zug kurz danach hinterher.
    if (data.history && data.history.length > before.history.length + 1) await sleep(350);
    sending = false;
    adopt(data);
  } else {
    sending = false;
    if (res.status === 401) {
      toast("Deine Anmeldung ist abgelaufen.", { action: "Anmelden", href: `/login?next=${encodeURIComponent(location.pathname)}` });
    } else if (res.status === 409 && data.state) {
      toast("Die Partie hat sich inzwischen geändert. Hier ist der aktuelle Stand.");
      adopt(data.state);
    } else {
      toast(ERRORS[data.error] || "Der Zug wurde nicht angenommen.");
    }
    render();
  }
  schedule(pace());
}

async function post(path, body) {
  try {
    const res = await fetch(`/api/chess/${path}/${GAME_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) adopt(data);
    else if (data.error === "not_active") { toast("Die Partie ist schon beendet."); poll(); }
    else { toast("Das hat nicht geklappt. Versuch es noch einmal."); poll(); }
  } catch (e) {
    toast("Keine Verbindung zum Server.");
  }
}

// ---------- Bedienung ----------
page.addEventListener("click", async (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t || !game) return;
  const nav = t.closest("[data-nav]");
  const ply = t.closest("[data-ply]");
  const act = t.closest("[data-act]");
  const drawAct = t.closest("[data-draw-act]");
  const endAct = t.closest("[data-end-act]");
  if (nav) navigate(nav.dataset.nav);
  else if (ply) showPly(Number(ply.dataset.ply));
  else if (act && act.dataset.act === "resign") {
    if (await ask("Willst du aufgeben? Die Partie zählt dann als verloren.", "Aufgeben")) post("resign");
  } else if (act && act.dataset.act === "draw") {
    post("draw", { action: "offer" });
  } else if (drawAct) {
    post("draw", { action: drawAct.dataset.drawAct });
  } else if (endAct && endAct.dataset.endAct === "view") {
    endClosed = true;
    ui.end.hidden = true;
    board.focus();
  } else if (endAct && endAct.dataset.endAct === "again") {
    endAct.disabled = true;
    try {
      const res = await fetch("/api/chess/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "bot", level: game.bot_level, color: pref("chess.botColor") }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { location.assign(`/games/chess/${data.game_id}`); return; }
      toast(data.error === "too_many_bot_games"
        ? "Du hast schon drei laufende Bot-Partien. Beende erst eine davon."
        : "Die neue Partie ließ sich nicht anlegen.");
    } catch (err) {
      toast("Keine Verbindung zum Server.");
    }
    endAct.disabled = false;
  }
});

function showPly(ply) {
  view = ply >= game.history.length ? null : Math.max(0, ply);
  renderBoard({ animate: true });
  renderMoves();
  const m = view ? game.history[view - 1] : null;
  announce(view === null ? "Aktuelle Stellung." : view === 0 ? "Startstellung." : spoken(m));
}

function navigate(to) {
  const n = game.history.length;
  const cur = view === null ? n : view;
  showPly({ first: 0, prev: cur - 1, next: cur + 1, live: n }[to]);
}

// Pfeiltasten blättern durch die Partie, solange der Fokus nicht auf dem Brett liegt.
document.addEventListener("keydown", (e) => {
  if (!game || e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]")) return;
  const t = e.target instanceof Element ? e.target : null;
  if (t && t.closest(".board-grid, input, textarea, select")) return;
  const map = { ArrowLeft: "prev", ArrowRight: "next", Home: "first", End: "live" };
  if (!map[e.key] || !game.history.length) return;
  e.preventDefault();
  navigate(map[e.key]);
});

// Einstellungen am Brett wirken sofort.
function applyPrefs() {
  board.root.classList.toggle("no-coords", !pref("chess.coords"));
  board.root.classList.toggle("no-hints", !pref("chess.hints"));
}
applyPrefs();
subscribe("chess.coords", applyPrefs);
subscribe("chess.hints", applyPrefs);

poll();
