/*
 * 2048 frontend.
 * All game RULES live in g2048_engine.js (shared with the server). This file
 * does rendering, input, and RECORDS every board-changing move as { tick, dir }.
 * On game over it posts the recorded log to the server, which replays it and
 * computes the authoritative score. The client never sends a score.
 */
(() => {
  "use strict";

  const GE = window.G2048Engine;
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const bestTileEl = document.getElementById("best-tile");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("startBtn");

  // ---- board geometry (canvas is 460x460) ----
  const SIZE = 4;
  const PAD = 14;
  const GAP = 12;
  const CELL = (canvas.width - 2 * PAD - (SIZE - 1) * GAP) / SIZE; // 99
  const RADIUS = 9;

  const COL_BOARD = "#0b0420";
  const COL_SLOT = "rgba(255,255,255,0.045)";

  // value -> { bg, fg }. Cool → warm progression, the 2048 tile pops cyan.
  const TILES = {
    2:    { bg: "#3a2f63", fg: "#d9d2ff" },
    4:    { bg: "#473a86", fg: "#e9e3ff" },
    8:    { bg: "#6d49c8", fg: "#ffffff" },
    16:   { bg: "#8a3df0", fg: "#ffffff" },
    32:   { bg: "#b249f8", fg: "#ffffff" },
    64:   { bg: "#ff3df0", fg: "#ffffff" },
    128:  { bg: "#ff5277", fg: "#ffffff" },
    256:  { bg: "#ff8c42", fg: "#1a1030" },
    512:  { bg: "#ffb13d", fg: "#1a1030" },
    1024: { bg: "#ffd23f", fg: "#1a1030" },
    2048: { bg: "#00e5e5", fg: "#04121a" },
    4096: { bg: "#3cdc5a", fg: "#052a10" },
  };
  const TILE_HI = { bg: "#9bf6b0", fg: "#04210d" }; // 8192 and beyond

  function tileStyle(v) {
    return TILES[v] || TILE_HI;
  }

  let engine = null;
  let recorded = [];
  let moveIdx = 0;
  let playing = false, finished = false, starting = false;
  let currentGameId = null;
  let wonAnnounced = false;

  // spawn-pop animation (purely visual, never touches engine state)
  let animCell = -1;
  let animStart = 0;
  const ANIM_MS = 110;
  let rafId = null;

  const KEY_DIR = {
    ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
    w: "U", W: "U", s: "D", S: "D", a: "L", A: "L", d: "R", D: "R",
  };

  // ---------- rendering ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function cellXY(i) {
    const r = Math.floor(i / SIZE), c = i % SIZE;
    return { x: PAD + c * (CELL + GAP), y: PAD + r * (CELL + GAP) };
  }

  function fontFor(v) {
    const digits = String(v).length;
    let px = 40;
    if (digits >= 4) px = 27;
    else if (digits === 3) px = 33;
    return `700 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  }

  function drawTile(v, x, y, scale) {
    const size = CELL * scale;
    const off = (CELL - size) / 2;
    const st = tileStyle(v);
    ctx.save();
    if (v >= 2048) {
      ctx.shadowColor = st.bg;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = st.bg;
    roundRect(x + off, y + off, size, size, RADIUS);
    ctx.fill();
    ctx.restore();

    if (scale > 0.55) {
      ctx.fillStyle = st.fg;
      ctx.font = fontFor(v);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = Math.min(1, (scale - 0.55) / 0.45);
      ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 1);
      ctx.globalAlpha = 1;
    }
  }

  function draw(now) {
    ctx.fillStyle = COL_BOARD;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // empty slots
    for (let i = 0; i < SIZE * SIZE; i++) {
      const { x, y } = cellXY(i);
      ctx.fillStyle = COL_SLOT;
      roundRect(x, y, CELL, CELL, RADIUS);
      ctx.fill();
    }
    if (!engine) return;

    let animating = false;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = engine.board[i];
      if (!v) continue;
      const { x, y } = cellXY(i);
      let scale = 1;
      if (i === animCell) {
        const t = (now - animStart) / ANIM_MS;
        if (t < 1) {
          const e = 1 - (1 - t) * (1 - t); // ease-out
          scale = 0.2 + 0.8 * e;
          animating = true;
        }
      }
      drawTile(v, x, y, scale);
    }
    return animating;
  }

  function renderLoop(now) {
    const animating = draw(now);
    if (animating) {
      rafId = requestAnimationFrame(renderLoop);
    } else {
      rafId = null;
    }
  }

  function scheduleDraw() {
    if (rafId === null) rafId = requestAnimationFrame(renderLoop);
  }

  function syncHud() {
    scoreEl.textContent = engine ? Number(engine.score).toLocaleString("de-DE") : 0;
    bestTileEl.textContent = engine ? engine.highest : 0;
  }

  function showOverlay(title, html, showButton) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    startBtn.style.display = showButton ? "" : "none";
    overlay.classList.remove("hidden");
  }

  // ---------- input handling ----------
  function applyMove(dir) {
    if (!playing || finished || !engine || engine.gameOver) return;
    const changed = engine.move(dir);
    if (!changed) return; // no-op move: nothing recorded, no spawn (matches engine)
    recorded.push({ tick: moveIdx, dir: dir });
    moveIdx += 1;
    animCell = engine.lastSpawn;
    animStart = performance.now();
    syncHud();
    scheduleDraw();
    if (engine.won && !wonAnnounced) {
      wonAnnounced = true;
      document.title = "2048 geknackt! · ABW Arcade";
    }
    if (engine.gameOver) finishGame();
  }

  // ---------- start / finish ----------
  async function startGame() {
    if (starting || playing) return;
    if (!GE || !GE.Engine) { showOverlay("FEHLER", "Engine nicht geladen", true); return; }
    starting = true;
    showOverlay("LÄDT …", "Starte Spiel", false);

    let data;
    try {
      const res = await fetch("/api/2048/start", { method: "POST" });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (res.status === 429) {
        starting = false;
        showOverlay("LANGSAM", "Zu viele Spiele in kurzer Zeit – kurz warten", true);
        startBtn.textContent = "Spiel starten";
        return;
      }
      if (!res.ok) throw new Error("start failed");
      data = await res.json();
    } catch (e) {
      starting = false;
      showOverlay("FEHLER", "Server nicht erreichbar", true);
      startBtn.textContent = "Erneut versuchen";
      return;
    }

    currentGameId = data.game_id;
    engine = new GE.Engine(data.seed >>> 0);
    recorded = [];
    moveIdx = 0;
    wonAnnounced = false;
    document.title = "2048 · ABW Arcade";
    animCell = engine.lastSpawn;
    animStart = performance.now();
    playing = true; finished = false; starting = false;

    syncHud();
    overlay.classList.add("hidden");
    scheduleDraw();
  }

  async function finishGame() {
    if (finished) return;
    playing = false;
    finished = true;

    showOverlay(engine.won ? "GESCHAFFT!" : "GAME OVER",
      `Score <b>${Number(engine.score).toLocaleString("de-DE")}</b> &middot; Stein ${engine.highest}`, true);
    startBtn.textContent = "Nochmal spielen";

    try {
      const res = await fetch("/api/2048/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_id: currentGameId, inputs: recorded }),
      });
      if (res.ok) {
        const d = await res.json();
        showOverlay(d.won ? "GESCHAFFT!" : "GAME OVER",
          `Score <b>${Number(d.score).toLocaleString("de-DE")}</b> &middot; Stein ${d.highest}`, true);
        startBtn.textContent = "Nochmal spielen";
        if (d.score !== engine.score) {
          console.warn("client/server score mismatch", { client: engine.score, server: d.score });
        }
      }
    } catch (e) { /* offline — keep local display */ }

    loadLeaderboard();
  }

  // ---------- leaderboard ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function loadLeaderboard() {
    const lbEl = document.getElementById("leaderboard");
    const personalEl = document.getElementById("personal");
    try {
      const res = await fetch("/api/leaderboard?game=2048");
      const data = await res.json();
      const rows = data.leaderboard || [];
      const meName = data.me && data.me.username;

      if (rows.length === 0) {
        lbEl.innerHTML = '<li class="lb-empty">Noch keine Scores – sei der Erste!</li>';
      } else {
        lbEl.innerHTML = rows.map((r, i) => `
          <li>
            <span class="lb-rank">${i + 1}</span>
            <span class="lb-name ${r.username === meName ? "is-me" : ""}">${escapeHtml(r.username)}</span>
            <span class="lb-score">${Number(r.score).toLocaleString("de-DE")}<span class="lb-tile">${r.lines || 0}</span></span>
          </li>`).join("");
      }

      if (data.me && data.me.best > 0) {
        personalEl.innerHTML =
          `Dein Bestwert: <b>${Number(data.me.best).toLocaleString("de-DE")}</b>` +
          (data.me.rank ? ` &middot; Platz ${data.me.rank}` : "");
      } else {
        personalEl.innerHTML = "";
      }
    } catch (e) {
      lbEl.innerHTML = '<li class="lb-empty">Leaderboard nicht erreichbar</li>';
    }
  }

  // ---------- input wiring ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (!playing || finished)) { startGame(); return; }
    if ((e.key === "r" || e.key === "R") && !starting) {
      // R restarts at any time (but not mid-animation request spam)
      if (playing || finished) { e.preventDefault(); finished = true; playing = false; startGame(); }
      return;
    }
    const dir = KEY_DIR[e.key];
    if (dir) { e.preventDefault(); applyMove(dir); }
  });
  startBtn.addEventListener("click", startGame);

  // touch swipe (mobile)
  let touchX = 0, touchY = 0, touching = false;
  canvas.addEventListener("touchstart", (e) => {
    if (!e.touches.length) return;
    touching = true;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!touching || !e.changedTouches.length) return;
    touching = false;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 24) return; // ignore taps
    if (adx > ady) applyMove(dx > 0 ? "R" : "L");
    else applyMove(dy > 0 ? "D" : "U");
  }, { passive: true });
  // stop the page scrolling while swiping on the board
  canvas.addEventListener("touchmove", (e) => { if (touching) e.preventDefault(); }, { passive: false });

  // ---------- init ----------
  syncHud();
  scheduleDraw();
  showOverlay("BEREIT?", 'Drücke <kbd>Enter</kbd> zum Start', true);
  startBtn.textContent = "Spiel starten";
  loadLeaderboard();
})();
