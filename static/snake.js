/*
 * Snake frontend.
 * All game RULES live in snake_engine.js (shared with the server). This file
 * does rendering, input and the fixed-timestep loop, and RECORDS every
 * direction change as { tick, dir }. On game over it posts the recorded log to
 * the server, which replays it and computes the authoritative score. The
 * client never sends a score.
 *
 * The loop matches snake_engine.simulate() exactly: per tick we pass the
 * directions recorded at that tick to engine.tick(), then advance.
 */
(() => {
  "use strict";

  const SE = window.SnakeEngine;
  const COLS = SE ? SE.COLS : 20;
  const ROWS = SE ? SE.ROWS : 20;

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const CELL = canvas.width / COLS;            // 440 / 20 = 22

  const scoreEl = document.getElementById("score");
  const lengthEl = document.getElementById("length");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("startBtn");

  const COL_BG = "#07021a";
  const COL_GRID = "rgba(150,120,255,0.06)";
  const COL_BODY = "#3cdc5a";
  const COL_HEAD = "#9bf6b0";
  const COL_FOOD = "#ff3df0";

  // Wall-clock per tick. Speeds up slightly as the snake grows. Only affects
  // feel — the server replays the recorded ticks regardless of real time.
  const BASE_TICK_MS = 130;
  const MIN_TICK_MS = 70;
  const MAX_CATCHUP = 4;

  let engine = null;
  let recorded = [];
  let tickCount = 0;
  let pending = [];
  let accMs = 0;
  let lastFrame = 0;
  let playing = false, paused = false, finished = false, starting = false;
  let currentGameId = null;
  let rafId = null;

  function tickMs() {
    if (!engine) return BASE_TICK_MS;
    return Math.max(MIN_TICK_MS, BASE_TICK_MS - engine.score * 3);
  }

  // ---------- rendering ----------
  function cell(x, y, color, inset) {
    const p = inset || 1;
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL + p, y * CELL + p, CELL - 2 * p, CELL - 2 * p);
  }

  function draw() {
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = COL_GRID;
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, canvas.height); ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(canvas.width, y * CELL); ctx.stroke();
    }

    if (!engine) return;

    if (engine.food) {
      const fx = engine.food[0], fy = engine.food[1];
      ctx.save();
      ctx.shadowColor = COL_FOOD;
      ctx.shadowBlur = 12;
      ctx.fillStyle = COL_FOOD;
      ctx.beginPath();
      ctx.arc(fx * CELL + CELL / 2, fy * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const s = engine.snake;
    for (let i = s.length - 1; i >= 0; i--) {
      cell(s[i][0], s[i][1], i === 0 ? COL_HEAD : COL_BODY, i === 0 ? 1 : 2);
    }
  }

  function syncHud() {
    scoreEl.textContent = engine ? engine.score : 0;
    lengthEl.textContent = engine ? engine.snake.length : 3;
  }

  function showOverlay(title, html, showButton) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    startBtn.style.display = showButton ? "" : "none";
    overlay.classList.remove("hidden");
  }

  // ---------- loop (mirrors snake_engine.simulate tick order) ----------
  function stepTick() {
    let dirs = null;
    if (pending.length) {
      dirs = pending.slice();
      for (let i = 0; i < pending.length; i++) recorded.push({ tick: tickCount, dir: pending[i] });
      pending.length = 0;
    }
    engine.tick(dirs);
    tickCount++;
    syncHud();
  }

  function frame(now) {
    if (!playing) return;
    if (paused) { lastFrame = now; rafId = requestAnimationFrame(frame); return; }

    let dt = now - lastFrame;
    lastFrame = now;
    if (dt > 250) dt = 250;
    accMs += dt;

    let steps = 0;
    const step = tickMs();
    while (accMs >= step && steps < MAX_CATCHUP && !engine.gameOver) {
      stepTick();
      accMs -= step;
      steps++;
    }
    draw();
    if (engine.gameOver) { finishGame(); return; }
    rafId = requestAnimationFrame(frame);
  }

  // ---------- start / finish ----------
  async function startGame() {
    if (starting || playing) return;
    if (!SE || !SE.Engine) { showOverlay("FEHLER", "Engine nicht geladen", true); return; }
    starting = true;
    showOverlay("LÄDT …", "Starte Spiel", false);

    let data;
    try {
      const res = await fetch("/api/snake/start", { method: "POST" });
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
    engine = new SE.Engine(data.seed >>> 0);
    recorded = [];
    tickCount = 0;
    pending.length = 0;
    accMs = 0;
    lastFrame = performance.now();
    paused = false; finished = false; playing = true; starting = false;

    syncHud();
    overlay.classList.add("hidden");
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

    const localLine = `Score <b>${engine.score}</b> &middot; Länge ${engine.snake.length}`;
    showOverlay("GAME OVER", localLine, true);
    startBtn.textContent = "Nochmal spielen";

    try {
      const res = await fetch("/api/snake/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_id: currentGameId, inputs: recorded }),
      });
      if (res.ok) {
        const d = await res.json();
        const title = d.won ? "GEWONNEN!" : "GAME OVER";
        showOverlay(title, `Score <b>${d.score}</b> &middot; Länge ${d.length}`, true);
        startBtn.textContent = "Nochmal spielen";
        if (d.score !== engine.score) {
          console.warn("client/server score mismatch", { client: engine.score, server: d.score });
        }
      }
    } catch (e) { /* offline — keep local display */ }

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
      const res = await fetch("/api/leaderboard?game=snake");
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
  const KEY_DIR = {
    ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
    w: "U", s: "D", a: "L", d: "R", W: "U", S: "D", A: "L", D: "R",
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (!playing || finished)) { startGame(); return; }
    if (e.key === "p" || e.key === "P") { togglePause(); return; }
    if (!playing || paused || (engine && engine.gameOver)) return;
    const dir = KEY_DIR[e.key];
    if (dir) {
      e.preventDefault();
      pending.push(dir);   // applied at the next tick (deterministic)
    }
  });
  startBtn.addEventListener("click", startGame);

  // ---------- init ----------
  syncHud();
  draw();
  showOverlay("BEREIT?", 'Drücke <kbd>Enter</kbd> zum Start', true);
  startBtn.textContent = "Spiel starten";
  loadLeaderboard();
})();
