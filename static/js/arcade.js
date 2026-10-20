// Gemeinsamer Rahmen der Arcade-Spiele: Start, Pause, Neustart, Spielende mit
// dem vom Server nachgerechneten Ergebnis und das Leaderboard. Regeln, Zeichnen
// und Eingaben bleiben im jeweiligen Spiel-Skript; es meldet sich hier mit
// createArcade() an. Bewegung nach .claude/skills/motion-gaming.

import { animate, countTo, bump, flash, spring, DUR, EASE_IN, EASE_OUT } from "./fx.js";
import { toast } from "./shell.js";

export const fmt = (n) => Number(n || 0).toLocaleString("de-DE");

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const hint = (key) => el("span", { class: "hint" }, key);

function editing(target) {
  return target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])");
}

/**
 * cfg = {
 *   slug, startUrl, finishUrl,
 *   canPause     false für Spiele ohne Zeitablauf (2048)
 *   restart      { title, text }: R fragt nach und startet neu
 *   begin(data)  neues Spiel mit { game_id, seed } aufsetzen
 *   resume()     nach der Pause weiter (Uhr des Spiels zurücksetzen)
 *   inputs()     aufgezeichnete Eingaben für den Abschluss
 *   snapshot()   lokales Ergebnis { score, won, detail } (z. B. für "Beenden")
 *   detail(res)  Zeile unter dem Score aus der Server-Antwort
 *   sync(res)    Anzeige auf die Werte des Servers setzen
 *   board(me)    optional: eigener Stand aus dem Leaderboard (best, rank, players)
 * }
 * Das Spiel fragt arcade.state bzw. arcade.running ab und meldet das Ende mit
 * arcade.over({ score, won, detail }, { reveal }). Das Spiel ist damit sofort
 * vorbei und wird gespeichert; die Ergebniskarte erscheint, sobald die
 * Promise reveal erfüllt ist (Effekte im Spielfeld ausgelaufen).
 */
export function createArcade(cfg) {
  const ui = {
    overlay: $("#overlay"),
    card: $("#overlay .overlay-card"),
    title: $("#overlay-title"),
    body: $("#overlay-text"),
    primary: $("#startBtn"),
    secondary: $("#overlay-secondary"),
    pause: $("[data-pause]"),
    live: $("#arcade-live"),
    board: $("#leaderboard"),
    personal: $("#personal"),
  };

  const startBody = [...ui.body.childNodes];  // Ziel und Steuerung aus der Vorlage
  let state = "idle";     // idle | starting | playing | paused | confirm | over
  let gameId = null;
  let shown = !ui.overlay.hidden;
  let fade = null;
  let result = null;      // { local, payload, scoreEl, detailEl, statusEl }
  let actions = { primary: start };   // der Startbildschirm kommt fertig aus der Vorlage

  const announce = (text) => { if (ui.live) ui.live.textContent = text; };

  // ---------- Overlay ----------
  function setButton(btn, spec) {
    if (!btn) return;
    btn.hidden = !spec;
    if (!spec) return;
    btn.disabled = !!spec.busy;
    btn.replaceChildren(spec.label, ...(spec.key ? [" ", hint(spec.key)] : []));
  }

  function view({ title, body, primary, secondary }) {
    ui.title.textContent = title;
    ui.body.replaceChildren(...body);
    actions = { primary: primary && primary.run, secondary: secondary && secondary.run };
    setButton(ui.primary, primary);
    setButton(ui.secondary, secondary);
    if (fade) { fade.cancel(); fade = null; }
    ui.overlay.classList.remove("is-leaving");
    ui.overlay.hidden = false;
    if (!shown) {
      shown = true;
      animate(ui.overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: DUR.base, easing: EASE_OUT });
      const s = spring();
      animate(ui.card, [{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }],
        CSS.supports("animation-timing-function", "linear(0, 1)") ? s : { duration: DUR.long, easing: EASE_OUT });
    }
    // Der Fokus geht auf die Karte, nicht auf den Knopf: Wer beim Game Over noch die
    // Leertaste hält, soll nicht beim Loslassen sofort "Nochmal" auslösen. Enter
    // wählt die Hauptaktion, Tab erreicht die Knöpfe.
    ui.card.focus({ preventScroll: true });
  }

  function hide() {
    if (!shown) return;
    shown = false;
    if (document.activeElement && ui.overlay.contains(document.activeElement)) document.activeElement.blur();
    // Schon beim Ausblenden gehören Finger und Maus dem Spielfeld.
    ui.overlay.classList.add("is-leaving");
    const a = animate(ui.overlay, [{ opacity: 1 }, { opacity: 0 }],
      { duration: DUR.base, easing: EASE_IN, fill: "forwards" });
    fade = a;
    const done = () => {
      if (fade !== a) return;
      fade = null;
      ui.overlay.hidden = true;
      ui.overlay.classList.remove("is-leaving");
      if (a) a.cancel();
    };
    if (a) a.finished.then(done, done); else done();
  }

  ui.primary.addEventListener("click", () => actions.primary && actions.primary());
  if (ui.secondary) ui.secondary.addEventListener("click", () => actions.secondary && actions.secondary());

  // Knopf im Werte-Panel: Pause, oder bei Spielen ohne Pause (2048) „Neues
  // Spiel“ mit Rückfrage – so geht beides auch ohne Tastatur.
  function syncPause() {
    if (!ui.pause) return;
    if (cfg.canPause) {
      ui.pause.hidden = !(state === "playing" || state === "paused");
      ui.pause.replaceChildren(icon(state === "paused" ? "play" : "pause"),
        state === "paused" ? "Weiter" : "Pause", " ", hint("P"));
    } else {
      ui.pause.hidden = !(cfg.restart && state === "playing");
      ui.pause.replaceChildren(icon("retry"), "Neues Spiel", " ", hint("R"));
    }
  }

  // ---------- Start ----------
  function startView(busy) {
    return {
      title: "BEREIT?",
      body: startBody,
      primary: { label: busy ? "Lädt …" : ui.primary.dataset.label, key: busy ? null : "Enter", busy, run: start },
    };
  }

  function failView(kind) {
    const texts = {
      auth: ["ABGEMELDET", "Deine Anmeldung ist abgelaufen. Melde dich neu an, dann geht es weiter."],
      busy: ["KURZE PAUSE", "Du hast in der letzten Stunde sehr viele Spiele gestartet. Warte ein paar Minuten und versuch es dann noch einmal."],
      offline: ["KEINE VERBINDUNG", "Der Server antwortet gerade nicht. Prüfe die Verbindung und versuch es noch einmal."],
      server: ["SERVERFEHLER", "Der Server konnte das Spiel nicht starten. Versuch es gleich noch einmal; wenn es bleibt, sag einem Admin Bescheid."],
    };
    const [title, text] = texts[kind];
    const login = () => window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    return {
      title,
      body: [el("p", {}, text)],
      primary: kind === "auth"
        ? { label: "Neu anmelden", run: login }
        : { label: "Erneut versuchen", key: "Enter", run: start },
    };
  }

  async function start() {
    if (state === "starting" || state === "playing" || state === "paused" || state === "confirm") return;
    if (state === "idle") view(startView(true));
    else setButton(ui.primary, { label: "Lädt …", busy: true });
    state = "starting";
    let res;
    try {
      res = await fetch(cfg.startUrl, { method: "POST" });
    } catch (e) {
      state = "idle";
      view(failView("offline"));
      return;
    }
    if (!res.ok) {
      state = "idle";
      view(failView(res.status === 401 ? "auth" : res.status === 429 ? "busy" : "server"));
      return;
    }
    const data = await res.json();
    gameId = data.game_id;
    result = null;
    state = "playing";
    hide();
    cfg.begin(data);
    syncPause();
    announce("Das Spiel läuft.");
  }

  // ---------- Pause ----------
  function pause(reason) {
    if (state !== "playing" || !cfg.canPause) return;
    state = "paused";
    syncPause();
    view({
      title: "PAUSE",
      body: [el("p", {}, reason === "auto"
        ? "Angehalten, weil du das Fenster gewechselt hast. Es geht genau hier weiter."
        : "Das Spiel ist angehalten. Es geht genau hier weiter.")],
      primary: { label: "Weiter", key: "P", run: resume },
      secondary: { label: "Beenden", run: () => finish(cfg.snapshot()) },
    });
    announce("Pause.");
  }

  function resume() {
    if (state !== "paused" && state !== "confirm") return;
    state = "playing";
    hide();
    syncPause();
    if (cfg.resume) cfg.resume();
    announce("Weiter.");
  }

  // ---------- Neustart mit Rückfrage ----------
  function askRestart() {
    if (state !== "playing" && state !== "paused") return;
    state = "confirm";
    syncPause();
    view({
      title: cfg.restart.title,
      body: [el("p", {}, cfg.restart.text)],
      primary: { label: "Neu starten", key: "Enter", run: restartNow },
      secondary: { label: "Weiterspielen", run: resume },
    });
  }

  function restartNow() {
    if (state !== "confirm") return;
    const local = cfg.snapshot();
    const payload = { game_id: gameId, inputs: cfg.inputs() };
    state = "over";
    saveQuietly(payload, local);
    start();
  }

  // Der vorige Run wird im Hintergrund gewertet; das Ergebnis kommt als Kurzmeldung.
  async function saveQuietly(payload, local) {
    report(await send(payload), payload, local);
  }

  function report(outcome, payload, local) {
    const d = outcome.data || {};
    if (outcome.ok || outcome.kind === "known") {
      toast(outcome.ok && d.standing && d.standing.new_best && d.score > 0
        ? `Neuer Highscore gespeichert: ${fmt(d.score)}`
        : `Score ${fmt(outcome.ok ? d.score : local.score)} gespeichert.`);
      loadLeaderboard();
    } else if (outcome.kind === "rejected") {
      toast(`Score ${fmt(local.score)} wurde vom Server nicht angenommen.`);
    } else {
      toast(`Score ${fmt(local.score)} nicht gespeichert.`, {
        action: "Erneut senden", ms: 12000, onAction: () => saveQuietly(payload, local),
      });
    }
  }

  // ---------- Spielende ----------
  async function send(payload) {
    let res;
    try {
      res = await fetch(cfg.finishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { ok: false, kind: "offline" };
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data };
    if (res.status === 401) return { ok: false, kind: "auth" };
    if (res.status === 409 && data.error === "already_finished") return { ok: false, kind: "known" };
    return { ok: false, kind: res.status >= 500 ? "server" : "rejected" };
  }

  // Das Spiel ist sofort vorbei und wird gespeichert; die Karte kommt, wenn
  // reveal erfüllt ist. Startet vorher schon das nächste Spiel (R, Leertaste),
  // erscheint sie nicht mehr, das Ergebnis kommt dann als Kurzmeldung.
  function finish(local, { reveal = null } = {}) {
    if (state === "over" || state === "idle" || state === "starting") return;
    state = "over";
    syncPause();
    const r = {
      local,
      payload: { game_id: gameId, inputs: cfg.inputs() },
      title: local.won ? "GESCHAFFT!" : "GAME OVER",
      scoreEl: el("p", { class: "result-score" }, "0"),
      detailEl: el("p", { class: "result-detail" }, local.detail || ""),
      statusEl: el("div", { class: "result-status", role: "status" }),
      retry: false,
      shown: false,
    };
    r.counted = new Promise((resolve) => { r.countDone = resolve; });
    result = r;
    save(r);
    const show = () => {
      if (result !== r || r.shown || state !== "over") return;
      r.shown = true;
      view({ title: r.title, body: [r.scoreEl, r.detailEl, r.statusEl], ...resultActions(r.retry) });
      countTo(r.scoreEl, 0, local.score, { ms: 700, format: fmt }).then(r.countDone);
    };
    if (reveal) reveal.then(show, show); else show();
  }

  function status(r, kind, data) {
    const s = r.statusEl;
    s.className = `result-status is-${kind}`;
    const line = (cls, ...kids) => el("p", { class: cls }, ...kids);
    if (kind === "pending") {
      s.replaceChildren(line("status-line", el("span", { class: "spinner", "aria-hidden": "true" }),
        "Der Server rechnet nach …"));
      return;
    }
    if (kind === "saved") {
      const st = data.standing || {};
      const lines = [line("status-line status-ok", icon("check"), "Gespeichert, vom Server nachgerechnet")];
      if (!data.score) {
        lines.push(line("status-note", "Ohne Punkte kommt das Spiel nicht ins Leaderboard."));
      } else if (st.new_best && st.previous_rank == null) {
        lines.push(line("status-line status-gold", icon("trophy"),
          `Dein erster Highscore · Platz ${st.rank} von ${st.players}`));
      } else if (st.new_best) {
        const move = st.previous_rank !== st.rank ? `Platz ${st.previous_rank} → ${st.rank}` : `Platz ${st.rank}`;
        lines.push(line("status-line status-gold", icon("trophy"), `Neuer Highscore · ${move} von ${st.players}`));
        lines.push(line("status-note", `Bisher ${fmt(st.previous_best)}`));
      } else if (st.rank) {
        lines.push(line("status-note", `Dein Highscore bleibt ${fmt(st.best)} · Platz ${st.rank} von ${st.players}`));
      }
      s.replaceChildren(...lines);
      return;
    }
    if (kind === "known") {
      s.replaceChildren(line("status-line status-ok", icon("check"), "Gespeichert, vom Server nachgerechnet"));
      return;
    }
    const texts = {
      offline: "Nicht gespeichert: keine Verbindung zum Server.",
      server: "Nicht gespeichert: Der Server hat einen Fehler gemeldet.",
      auth: "Nicht gespeichert: Deine Anmeldung ist abgelaufen. Melde dich in einem neuen Tab an und sende dann erneut.",
      rejected: "Nicht gespeichert: Der Server hat dieses Spiel nicht angenommen.",
    };
    const lines = [line("status-line status-error", icon("alert"), texts[kind])];
    if (kind === "auth") {
      lines.push(line("status-note", el("a", { href: "/login", target: "_blank", rel: "noopener" }, "Anmelden (neuer Tab)")));
    }
    s.replaceChildren(...lines);
  }

  function resultActions(retry) {
    return retry
      ? { primary: { label: "Erneut senden", key: "Enter", run: () => save() },
          secondary: { label: "Ohne Speichern weiter", run: start } }
      : { primary: { label: "Nochmal", key: "Enter", run: start },
          secondary: { label: "Alle Spiele", run: () => window.location.assign("/") } };
  }

  function resultButtons(r) {
    const a = resultActions(r.retry);
    setButton(ui.primary, a.primary);
    setButton(ui.secondary, a.secondary);
    actions = { primary: a.primary.run, secondary: a.secondary.run };
  }

  async function save(r = result) {
    r.retry = false;
    status(r, "pending");
    if (r.shown) resultButtons(r);
    const outcome = await send(r.payload);
    if (r !== result) {          // inzwischen läuft schon das nächste Spiel
      report(outcome, r.payload, r.local);
      return;
    }
    if (outcome.ok) {
      const d = outcome.data;
      if (cfg.sync) cfg.sync(d);
      const differs = d.score !== r.local.score;
      // Darf nicht vorkommen: Client und Server rechnen mit derselben Engine.
      if (differs) console.warn("Client- und Server-Score weichen ab", { client: r.local.score, server: d.score });
      r.counted.then(async () => {
        if (differs) await countTo(r.scoreEl, r.local.score, d.score, { ms: 400, format: fmt });
        if (d.standing && d.standing.new_best && d.score > 0) bump(r.scoreEl);
      });
      if (cfg.detail) r.detailEl.textContent = cfg.detail(d);
      if (d.won && !r.local.won) {
        r.title = "GESCHAFFT!";
        if (r.shown) ui.title.textContent = r.title;
      }
      status(r, "saved", d);
      const st = d.standing || {};
      announce(`${d.won ? "Geschafft" : "Game Over"}. Score ${fmt(d.score)}. Gespeichert` +
        (st.rank ? `, Platz ${st.rank} von ${st.players}.` : "."));
      loadLeaderboard({ highlight: true });
      return;
    }
    status(r, outcome.kind);
    if (outcome.kind === "known") { loadLeaderboard({ highlight: true }); return; }
    announce("Game Over. Score nicht gespeichert.");
    if (outcome.kind !== "rejected") {
      r.retry = true;
      if (r.shown) resultButtons(r);
    }
  }

  // ---------- Leaderboard ----------
  async function loadLeaderboard({ highlight = false } = {}) {
    if (!ui.board) return;
    let data;
    try {
      const res = await fetch(`/api/leaderboard?game=${encodeURIComponent(cfg.slug)}`);
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch (e) {
      ui.board.replaceChildren(el("li", { class: "lb-empty" }, "Das Leaderboard ist gerade nicht erreichbar."));
      return;
    }
    const me = data.me || {};
    const rows = data.leaderboard || [];
    if (cfg.board && data.me) cfg.board(data.me);
    if (!rows.length) {
      ui.board.replaceChildren(el("li", { class: "lb-empty" }, "Noch keine Scores. Der erste Score mit Punkten steht hier."));
    } else {
      ui.board.replaceChildren(...rows.map((r, i) => el("li", { class: r.username === me.username ? "is-me" : null },
        el("span", { class: "lb-rank" }, String(i + 1)),
        el("span", { class: "lb-name" }, r.username),
        el("span", { class: "lb-score" }, fmt(r.score)))));
    }
    if (ui.personal) {
      ui.personal.replaceChildren(...(me.best > 0
        ? ["Dein Highscore: ", el("b", {}, fmt(me.best)), ` · Platz ${me.rank} von ${me.players}`]
        : ["Noch kein Score mit Punkten."]));
    }
    if (highlight) {
      const mine = ui.board.querySelector("li.is-me");
      if (mine) flash(mine, { color: "var(--accent)" });
    }
  }

  // ---------- Tastatur und Fensterwechsel ----------
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || editing(e.target)) return;
    if (document.querySelector("dialog[open]")) return;
    const k = e.key;
    if (k === "Enter") {
      if (e.repeat) return;
      // Ein fokussierter Knopf oder Link behält seine eigene Bedeutung.
      if (e.target instanceof Element && e.target.closest("button, a, summary")) return;
      if (state === "confirm") { e.preventDefault(); restartNow(); }
      else if (shown && actions.primary && !ui.primary.disabled && !ui.primary.hidden) { e.preventDefault(); actions.primary(); }
      return;
    }
    if (k === "p" || k === "P" || k === "Escape") {
      if (state === "playing") { e.preventDefault(); pause("key"); }
      else if (state === "paused") { e.preventDefault(); resume(); }
      else if (state === "confirm" && k === "Escape") { e.preventDefault(); resume(); }
      return;
    }
    if ((k === "r" || k === "R") && cfg.restart && !e.repeat) {
      if (state === "playing" || state === "paused") { e.preventDefault(); askRestart(); }
      else if (state === "over" || state === "idle") { e.preventDefault(); start(); }
    }
  });

  const autoPause = () => { if (state === "playing") pause("auto"); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) autoPause(); });
  window.addEventListener("blur", autoPause);
  document.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-settings-open]")) autoPause();
  });
  if (ui.pause) {
    ui.pause.addEventListener("click", () => {
      if (!cfg.canPause) askRestart();
      else if (state === "paused") resume();
      else pause("key");
    });
  }

  loadLeaderboard();

  return {
    get state() { return state; },
    get running() { return state === "playing"; },
    start,
    over: finish,
    pause: () => pause("key"),
  };
}
