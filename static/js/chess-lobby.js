// Schach-Lobby: eigene Partien, offene Herausforderungen, Bot, Bilanz und
// Rangliste. Fragt alle paar Sekunden nach und baut nur neu, was sich geändert hat.

import { toast } from "./shell.js";
import { get as pref, set as setPref } from "./prefs.js";

const root = document.querySelector("[data-lobby]");
const meName = root.dataset.me;
const $ = (sel) => root.querySelector(sel);
const fmt = (n) => Number(n).toLocaleString("de-DE");

const REASON = {
  checkmate: "Schachmatt", stalemate: "Patt", resign: "Aufgabe", draw_agreed: "Remis vereinbart",
  fifty_move: "50-Züge-Regel", repetition: "Stellungswiederholung", material: "zu wenig Material",
};
const OUTCOME = { win: "Sieg", loss: "Niederlage", draw: "Remis" };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v; else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function row(main, sub, ...actions) {
  return el("li", { class: "lobby-row" },
    el("span", { class: "lobby-row-text" }, el("span", {}, ...[].concat(main)), sub && el("span", { class: "muted" }, sub)),
    el("span", { class: "lobby-row-actions" }, ...actions));
}

const empty = (text) => el("li", { class: "lobby-empty" }, text);

// ---------- Darstellung, nur bei Änderungen ----------
const shown = {};
function update(name, data, build) {
  const sig = JSON.stringify(data);
  if (shown[name] === sig) return;
  shown[name] = sig;
  build(data);
}

function renderActive(list) {
  const sorted = [...list].sort((a, b) => b.your_turn - a.your_turn);
  $('[data-list="active"]').replaceChildren(...(sorted.length ? sorted.map((g) => row(
    ["gegen ", el("b", {}, g.opponent || "?"), g.your_turn ? [" ", el("span", { class: "tag tag-accent" }, "Du bist am Zug")] : []],
    `${g.moves} ${g.moves === 1 ? "Zug" : "Züge"} · du spielst ${g.you === "w" ? "Weiß" : "Schwarz"}${g.bot ? " · Übung" : ""}`,
    el("a", { class: `btn btn-sm${g.your_turn ? "" : " btn-secondary"}`, href: `/games/chess/${g.id}` }, "Zum Brett"),
  )) : [empty("Gerade läuft keine Partie. Fordere jemanden heraus oder spiel gegen den Bot.")]));
}

function renderOpen(list) {
  $('[data-list="open"]').replaceChildren(...(list.length ? list.map((g) => g.mine
    ? row("Deine Herausforderung", "wartet auf einen Gegner",
      el("button", { class: "btn btn-secondary btn-sm", type: "button", "data-cancel": g.id }, "Zurückziehen"))
    : row(el("b", {}, g.creator), "sucht einen Gegner",
      el("button", { class: "btn btn-sm", type: "button", "data-join": g.id }, "Beitreten")),
  ) : [empty("Keine offene Herausforderung. Mit „Neue Herausforderung“ wartest du auf einen Gegner.")]));
}

function renderFinished(list) {
  $('[data-list="finished"]').replaceChildren(...(list.length ? list.map((g) => row(
    ["gegen ", el("b", {}, g.opponent || "?")],
    REASON[g.reason] || g.reason || "",
    el("span", { class: `outcome outcome-${g.outcome}` }, OUTCOME[g.outcome]),
    el("a", { class: "btn btn-ghost btn-sm", href: `/games/chess/${g.id}` }, "Ansehen"),
  )) : [empty("Noch keine beendete Partie.")]));
}

function renderMe(me) {
  const games = me.wins + me.draws + me.losses;
  $("[data-me-stats]").replaceChildren(...(games
    ? [el("b", {}, fmt(me.rating)), el("span", { class: "muted" },
      `${me.wins} ${me.wins === 1 ? "Sieg" : "Siege"} · ${me.draws} Remis · ${me.losses} ${me.losses === 1 ? "Niederlage" : "Niederlagen"}`)]
    : [el("span", { class: "muted" }, `Noch keine gewertete Partie. Du startest mit Elo ${fmt(me.rating)}.`)]));
}

function renderRanking(list) {
  $("[data-ranking]").replaceChildren(...(list.length ? list.map((r, i) => el("tr", { class: r.username === meName ? "is-me" : null },
    el("td", { class: "num" }, String(i + 1)),
    el("td", {}, r.username),
    el("td", { class: "num elo" }, fmt(r.rating)),
    el("td", { class: "num" }, String(r.wins)),
    el("td", { class: "num" }, String(r.draws)),
    el("td", { class: "num" }, String(r.losses)),
  )) : [el("tr", {}, el("td", { colspan: "6", class: "lobby-empty" }, "Noch keine gewertete Partie."))]));
}

// ---------- Abfragen ----------
let myOpen = null;      // eigene offene Herausforderungen beim letzten Abruf
let timer = null;
let failures = 0;

async function refresh() {
  clearTimeout(timer);
  if (document.hidden) return;
  try {
    const res = await fetch("/api/chess/lobby", { cache: "no-store" });
    if (res.status === 401) { location.assign("/login?next=/games/chess"); return; }
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    failures = 0;
    // Hat jemand eine eigene Herausforderung angenommen?
    if (myOpen) {
      for (const g of data.active) {
        if (myOpen.has(g.id)) {
          toast(`${g.opponent} hat deine Herausforderung angenommen.`, { action: "Zum Brett", href: `/games/chess/${g.id}`, ms: 10000 });
        }
      }
    }
    myOpen = new Set(data.open.filter((g) => g.mine).map((g) => g.id));
    update("active", data.active, renderActive);
    update("open", data.open, renderOpen);
    update("finished", data.finished, renderFinished);
    update("me", data.me, renderMe);
    update("ranking", data.ratings, renderRanking);
  } catch (e) {
    failures += 1;
  }
  timer = setTimeout(refresh, Math.min(30000, 3000 * 2 ** Math.min(failures, 3)));
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

// ---------- Aktionen ----------
const msg = (name, text) => { $(`[data-msg="${name}"]`).textContent = text || ""; };

async function post(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, status: 0, data: {} };
  }
}

root.addEventListener("click", async (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const join = t.closest("[data-join]");
  const cancel = t.closest("[data-cancel]");
  if (join) {
    join.disabled = true;
    const r = await post(`/api/chess/join/${join.dataset.join}`);
    if (r.ok) { location.assign(`/games/chess/${join.dataset.join}`); return; }
    msg("open", r.status === 0 ? "Keine Verbindung zum Server." : "Diese Herausforderung ist nicht mehr offen.");
    join.disabled = false;
    refresh();
  } else if (cancel) {
    cancel.disabled = true;
    await post(`/api/chess/cancel/${cancel.dataset.cancel}`);
    msg("open", "");
    refresh();
  } else if (t.closest("[data-create]")) {
    const btn = t.closest("[data-create]");
    btn.disabled = true;
    const r = await post("/api/chess/create");
    btn.disabled = false;
    msg("open", r.ok ? "" : r.data.error === "already_waiting"
      ? "Du hast schon eine offene Herausforderung. Zieh sie zurück oder warte auf einen Gegner."
      : "Die Herausforderung ließ sich nicht anlegen.");
    refresh();
  } else if (t.closest("[data-bot]")) {
    const btn = t.closest("[data-bot]");
    btn.disabled = true;
    const r = await post("/api/chess/create", { mode: "bot", level: pref("chess.botLevel"), color: pref("chess.botColor") });
    if (r.ok) { location.assign(`/games/chess/${r.data.game_id}`); return; }
    btn.disabled = false;
    msg("bot", r.data.error === "too_many_bot_games"
      ? "Du hast schon drei laufende Bot-Partien. Beende erst eine davon."
      : "Die Bot-Partie ließ sich nicht anlegen.");
  }
});

// Bot-Stärke und Farbe merkt sich der Browser (prefs.js).
for (const name of ["botLevel", "botColor"]) {
  const keyName = `chess.${name}`;
  for (const input of root.querySelectorAll(`input[name="${name}"]`)) {
    input.checked = input.value === pref(keyName);
    input.addEventListener("change", () => { if (input.checked) setPref(keyName, input.value); });
  }
}

refresh();
