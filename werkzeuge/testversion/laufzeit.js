// ABW Arcade, lokale Testversion. Dieses Skript ersetzt den Server: Start, Ende und
// Leaderboard laufen im Browser, und jedes Spiel wird mit derselben Engine
// nachgerechnet wie auf dem Server. Die Scores liegen im localStorage dieses
// Browsers. Der Hash waehlt die Seite (#tetris, #snake …); jeder Wechsel laedt die
// Datei neu, damit jedes Spiel in einer frischen Seite startet.
// bauen.py setzt dieses Skript in die HTML-Datei ein und trägt dabei die Spiele ein.
(() => {
  "use strict";
  const GAMES = /*GAMES*/[];
  const USER = "Du";
  const KEY = "abw.lokal.v1.scores";
  const bySlug = new Map(GAMES.map((g) => [g.slug, g]));
  const byApi = new Map(GAMES.map((g) => [g.api, g]));

  // ---------- Scores im Browser ----------
  let fallback = [];   // ohne localStorage (privates Fenster): nur bis zum Neuladen
  function load() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(list)) return list;
    } catch (e) { /* weiter mit fallback */ }
    return fallback.slice();
  }
  function store(list) {
    fallback = list.slice(-500);
    try { localStorage.setItem(KEY, JSON.stringify(fallback)); } catch (e) { /* bleibt im Speicher */ }
  }
  // Wie _standing() im Server, nur mit einem einzigen Spieler.
  function standing(list, slug) {
    const runs = list.filter((r) => r.game === slug && r.score > 0);
    if (!runs.length) return { best: 0, rank: null, players: 0 };
    return { best: Math.max(...runs.map((r) => r.score)), rank: 1, players: 1 };
  }

  // ---------- Server-Ersatz für /api/… ----------
  const runs = new Map();   // game_id -> { game, seed, done }
  const reply = (status, data) => Promise.resolve(new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  }));
  const realFetch = window.fetch.bind(window);
  const BASE = "http://lokal.invalid";

  window.fetch = function (input, init) {
    const raw = typeof input === "string" ? input : (input && input.url) || String(input);
    const url = new URL(raw, BASE);
    if (url.origin !== BASE || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    try {
      return route(url, init || {});
    } catch (e) {
      console.error("Lokaler Server-Ersatz:", e);
      return reply(500, { error: "local_error" });
    }
  };

  function route(url, init) {
    const parts = url.pathname.split("/").filter(Boolean);   // api, <spiel>, start|finish
    if (parts[1] === "leaderboard") return leaderboard(url.searchParams.get("game") || "tetris");
    const g = byApi.get(parts[1]);
    if (g && parts[2] === "start") return start(g);
    if (g && parts[2] === "finish") return finish(g, init.body);
    return reply(404, { error: "not_found" });
  }

  function start(g) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)),
      (b) => b.toString(16).padStart(2, "0")).join("");
    runs.set(id, { game: g.slug, seed, done: false });
    return reply(200, { game_id: id, seed });
  }

  function finish(g, body) {
    let data;
    try { data = JSON.parse(body); } catch (e) { return reply(400, { error: "invalid_payload" }); }
    const run = data && runs.get(data.game_id);
    if (!run) return reply(404, { error: "unknown_game" });
    if (run.game !== g.slug) return reply(409, { error: "wrong_game" });
    if (run.done) return reply(409, { error: "already_finished" });
    if (!Array.isArray(data.inputs)) return reply(400, { error: "invalid_payload" });
    // Wie _replay_limit() im Server: Bei einem Abbruch zählen nur die gespielten Ticks.
    let limit;
    if (data.ticks != null) {
      const t = data.ticks;
      if (!Number.isInteger(t) || t < 0 || data.inputs.some((it) => it.tick >= t)) {
        return reply(400, { error: "invalid_input" });
      }
      limit = t - 0.5;   // simulate() spielt die Ticks 0 bis limit; 0 hieße dort „ohne Grenze“
    }
    run.done = true;

    // Nachrechnen wie der Server: Seed plus Eingaben, sonst nichts.
    const result = window[g.engine].simulate(run.seed, data.inputs, limit);
    const score = Math.trunc(result.score);
    const extra = {};
    let lines = 0, level = 1;
    if (g.slug === "tetris") {
      lines = Math.trunc(result.lines); level = Math.trunc(result.level);
      Object.assign(extra, { lines, level });
    } else if (g.slug === "snake") {
      lines = extra.length = Math.trunc(result.length);
    } else if (g.slug === "breakout") {
      lines = extra.bricks = Math.trunc(result.bricks);
    } else if (g.slug === "2048") {
      lines = extra.highest = Math.trunc(result.highest);
    }
    if (g.slug !== "tetris") extra.won = Boolean(result.won);

    const list = load();
    const before = standing(list, g.slug);
    list.push({ game: g.slug, score, lines, level, at: new Date().toISOString() });
    store(list);
    const after = standing(list, g.slug);
    return reply(200, {
      ok: true,
      standing: { ...after, previous_best: before.best, previous_rank: before.rank,
                  new_best: score > before.best },
      score, ...extra, game_over: Boolean(result.gameOver),
    });
  }

  function leaderboard(slug) {
    const list = load();
    const st = standing(list, slug);
    const top = st.best > 0 ? list.find((r) => r.game === slug && r.score === st.best) : null;
    const rows = top ? [{ username: USER, score: top.score, lines: top.lines, level: top.level }] : [];
    return reply(200, { leaderboard: rows, me: { username: USER, ...st } });
  }

  // ---------- Hub: Stand aus dem Browser eintragen ----------
  const num = (n) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  function ago(iso) {   // wie der Filter „ago“ im Server
    const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (minutes < 1) return "gerade eben";
    if (minutes < 60) return `vor ${minutes} Min.`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    const days = Math.floor(hours / 24);
    if (days < 7) return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
    const d = new Date(iso), two = (x) => String(x).padStart(2, "0");
    return `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  }

  function fillHub(list) {
    for (const a of document.querySelectorAll("a.capsule")) {
      const st = standing(list, a.getAttribute("href").replace(/^#/, ""));
      const stat = a.querySelector(".capsule-stat");
      if (!stat || !st.best) continue;
      stat.innerHTML = `<span class="stat-label">Highscore</span>
        <span class="stat-value stat-gold">${num(st.best)}</span>
        <span class="stat-note">Platz ${st.rank} von ${st.players}</span>`;
    }
    const title = document.getElementById("recent-title");
    const panel = title && title.closest("section");
    const recent = list.filter((r) => bySlug.has(r.game)).slice(-5).reverse();
    if (!panel || !recent.length) return;
    const rows = recent.map((r) => {
      const g = bySlug.get(r.game);
      const isBest = r.score > 0 && r.score === standing(list, r.game).best;
      return `<li class="hub-row">
          <span class="hub-row-text">
            <span class="hub-game" style="--game: var(--game-${g.slug})">${g.title}</span>
            <time class="muted" datetime="${r.at.replace(/\.\d+Z$/, "Z")}">${ago(r.at)}</time>
          </span>
          <span class="hub-score">
            ${isBest ? '<span class="tag tag-gold">Highscore</span>' : ""}
            <b>${num(r.score)}</b>
          </span>
        </li>`;
    }).join("");
    panel.innerHTML = `<h2 class="panel-title" id="recent-title">Zuletzt gespielt</h2>
      <ul class="hub-list">${rows}</ul>
      <p class="hint-text hub-panel-note"><svg class="icon" aria-hidden="true"><use href="#i-shield"/></svg>Jeder Score ist lokal nachgerechnet.</p>`;
  }

  // ---------- Seite wählen und starten ----------
  const key = () => decodeURIComponent(location.hash.replace(/^#/, ""));
  const game = bySlug.get(key());
  let pageId = "page-hub";
  if (game) {
    pageId = "page-" + game.slug;
  } else {
    // „Weiterspielen“ zeigt wie im Hub des Servers das zuletzt gespielte Spiel.
    const list = load();
    const last = list.length ? list[list.length - 1] : null;
    if (last && bySlug.has(last.game)) pageId = "page-hub-" + last.game;
  }
  const tpl = document.getElementById(pageId);
  document.title = tpl.dataset.title;
  document.body.className = tpl.dataset.bodyClass || "";
  document.getElementById("css-" + tpl.dataset.css).media = "all";
  document.currentScript.before(tpl.content.cloneNode(true));
  if (!game) fillHub(load());
  for (const id of tpl.dataset.js.split(" ")) {
    const s = document.createElement("script");
    s.textContent = document.getElementById(id).textContent;
    document.body.append(s);
  }
  // Nur Seitenwechsel laden neu; Sprungmarken wie #main bleiben auf der Seite.
  window.addEventListener("hashchange", () => {
    const k = key();
    if (k === "" || bySlug.has(k)) location.reload();
  });
})();
