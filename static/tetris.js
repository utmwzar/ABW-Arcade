/*
 * Tetris frontend.
 * All game RULES live in engine.js (shared with the server). This file only
 * does rendering, input and the fixed-timestep loop, and it RECORDS every
 * input as { tick, action }. On game over it posts the recorded log to the
 * server, which replays it and computes the authoritative score. The client
 * never sends a score.
 *
 * The loop must match engine.simulate() exactly: for each tick we first apply
 * the inputs recorded at that tick, then one gravityStep, then advance.
 */
(() => {
  "use strict";

  const TE = window.TetrisEngine;
  const CELL = 30;
  const COLS = TE ? TE.COLS : 10;
  const ROWS = TE ? TE.ROWS : 20;

  const COLORS = {
    1: "#00e5e5", 2: "#f5d90a", 3: "#b249f8", 4: "#3cdc5a",
    5: "#ff4d5e", 6: "#3d7bff", 7: "#ff9d2f",
  };

  // Wall-clock per logical tick. Only affects feel/speed, not correctness:
  // the server replays the recorded ticks regardless of real time.
  const TICK_MS = 20;
  const MAX_CATCHUP = 6; // cap ticks processed per frame (avoid stall spirals)

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const nextCanvas = document.getElementById("next");
  const nctx = nextCanvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const linesEl = document.getElementById("lines");
  const levelEl = document.getElementById("level");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("startBtn");

  let engine = null;
  let recorded = [];
  let tickCount = 0;
  let pending = [];
  let accMs = 0;
  let lastFrame = 0;
  let playing = false, paused = false, finished = false, starting = false;
  let currentGameId = null;
  let rafId = null;

  // ---------- rendering ----------
  function drawCell(c, x, y, colorId, size = CELL) {
    const px = x * size, py = y * size;
    c.fillStyle = COLORS[colorId];
    c.fillRect(px + 1, py + 1, size - 2, size - 2);
    c.fillStyle = "rgba(255,255,255,0.18)";
    c.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.14));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(150,120,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, canvas.height); ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(canvas.width, y * CELL); ctx.stroke();
    }

    if (!engine) return;

    const grid = engine.grid;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (grid[y][x]) drawCell(ctx, x, y, grid[y][x]);
    }

    const cur = engine.current;
    if (cur) {
      const gy = engine.ghostY();
      ctx.globalAlpha = 0.18;
      cur.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v) drawCell(ctx, cur.x + x, gy + y, v);
      }));
      ctx.globalAlpha = 1;
      cur.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v && cur.y + y >= 0) drawCell(ctx, cur.x + x, cur.y + y, v);
      }));
    }
  }

  function drawNext() {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!engine || !engine.nextType) return;
    const m = TE.SHAPES[engine.nextType], size = 24;
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    m.forEach((row, y) => row.forEach((v, x) => {
      if (v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }));
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const offX = (nextCanvas.width - w * size) / 2;
    const offY = (nextCanvas.height - h * size) / 2;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!m[y][x]) continue;
        const px = offX + (x - minX) * size, py = offY + (y - minY) * size;
        nctx.fillStyle = COLORS[m[y][x]];
        nctx.fillRect(px + 1, py + 1, size - 2, size - 2);
        nctx.fillStyle = "rgba(255,255,255,0.18)";
        nctx.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.14));
      }
    }
  }

  function syncHud() {
    scoreEl.textContent = engine ? engine.score : 0;
    linesEl.textContent = engine ? engine.lines : 0;
    levelEl.textContent = engine ? engine.level : 1;
  }

  function showOverlay(title, html, showButton) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    startBtn.style.display = showButton ? "" : "none";
    overlay.classList.remove("hidden");
  }

  // ---------- loop (mirrors engine.simulate tick order) ----------
  function stepTick() {
    if (pending.length) {
      for (let i = 0; i < pending.length; i++) {
        recorded.push({ tick: tickCount, action: pending[i] });
        engine.applyAction(pending[i]);
        if (engine.gameOver) break;
      }
      pending.length = 0;
    }
    if (engine.gameOver) return;
    engine.gravityStep();
    tickCount++;
    syncHud();
  }

  function frame(now) {
    if (!playing) return;
    if (paused) { lastFrame = now; rafId = requestAnimationFrame(frame); return; }

    let dt = now - lastFrame;
    lastFrame = now;
    if (dt > 250) dt = 250;        // ignore huge gaps (tab was backgrounded)
    accMs += dt;

    let steps = 0;
    while (accMs >= TICK_MS && steps < MAX_CATCHUP && !engine.gameOver) {
      stepTick();
      accMs -= TICK_MS;
      steps++;
    }
    drawNext();
    draw();

    if (engine.gameOver) { finishGame(); return; }
    rafId = requestAnimationFrame(frame);
  }

  // ---------- start / finish ----------
  async function startGame() {
    if (starting || playing) return;
    if (!TE || !TE.Engine) { showOverlay("FEHLER", "Engine nicht geladen", true); return; }
    starting = true;
    showOverlay("LÄDT …", "Starte Spiel", false);

    let data;
    try {
      const res = await fetch("/api/game/start", { method: "POST" });
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
    engine = new TE.Engine(data.seed >>> 0);
    engine.start();
    recorded = [];
    tickCount = 0;
    pending.length = 0;
    accMs = 0;
    lastFrame = performance.now();
    paused = false; finished = false; playing = true; starting = false;

    syncHud();
    overlay.classList.add("hidden");
    drawNext();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  async function finishGame() {
    if (finished) return;
    playing = false;
    finished = true;
    cancelAnimationFrame(rafId);
    draw();

    const localLine = `Score <b>${Number(engine.score).toLocaleString("de-DE")}</b> &middot; ${engine.lines} Lines &middot; Level ${engine.level}`;
    showOverlay("GAME OVER", localLine, true);
    startBtn.textContent = "Nochmal spielen";

    try {
      const res = await fetch("/api/game/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_id: currentGameId, inputs: recorded }),
      });
      if (res.ok) {
        const d = await res.json();
        // The server's replay is the source of truth for the leaderboard.
        showOverlay("GAME OVER",
          `Score <b>${Number(d.score).toLocaleString("de-DE")}</b> &middot; ${d.lines} Lines &middot; Level ${d.level}`,
          true);
        startBtn.textContent = "Nochmal spielen";
        if (d.score !== engine.score) {
          console.warn("client/server score mismatch", { client: engine.score, server: d.score });
        }
      }
    } catch (e) { /* offline — keep the local display */ }

    loadLeaderboard();
  }

  function togglePause() {
    if (!playing || finished || (engine && engine.gameOver)) return;
    paused = !paused;
    if (paused) {
      showOverlay("PAUSE", 'Drücke <kbd>P</kbd> zum Weiterspielen', false);
    } else {
      overlay.classList.add("hidden");
      lastFrame = performance.now();
    }
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
      const res = await fetch("/api/leaderboard?game=tetris");
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
            <span class="lb-score">${Number(r.score).toLocaleString("de-DE")}</span>
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

  // ---------- input ----------
  const KEY_ACTION = {
    ArrowLeft: "L", ArrowRight: "R", ArrowUp: "ROT", ArrowDown: "SOFT", " ": "HARD",
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (!playing || finished)) { startGame(); return; }
    if (e.key === "p" || e.key === "P") { togglePause(); return; }
    if (!playing || paused || (engine && engine.gameOver)) return;
    const action = KEY_ACTION[e.key];
    if (action) {
      e.preventDefault();
      pending.push(action);   // applied at the next tick (deterministic)
    }
  });
  startBtn.addEventListener("click", startGame);

  // ---------- init ----------
  syncHud();
  draw();
  drawNext();
  showOverlay("BEREIT?", 'Drücke <kbd>Enter</kbd> zum Start', true);
  startBtn.textContent = "Spiel starten";
  loadLeaderboard();
})();
