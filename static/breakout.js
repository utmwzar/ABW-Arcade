/*
 * Breakout frontend.
 * All game RULES live in breakout_engine.js (shared with the server). This file
 * does rendering, input and the fixed-timestep loop, and RECORDS every paddle
 * direction change as { tick, dir }. On game over it posts the recorded log to
 * the server, which replays it and computes the authoritative score. The
 * client never sends a score.
 */
(() => {
  "use strict";

  const BE = window.BreakoutEngine;
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("startBtn");

  const COL_BG = "#07021a";
  const COL_GRID = "rgba(150,120,255,0.05)";
  const COL_PADDLE = "#00e5e5";
  const COL_BALL = "#ece8ff";
  // brick colour per row (top → bottom), from the arcade palette
  const ROW_COLORS = ["#ff3df0", "#b249f8", "#3d7bff", "#00e5e5", "#3cdc5a"];

  const TICK_MS = 16;          // ~60 ticks/s; server replays ticks regardless
  const MAX_CATCHUP = 5;

  let engine = null;
  let recorded = [];
  let tickCount = 0;
  let pendingDir = null;       // latest paddle dir not yet committed to a tick
  let lastDir = "S";
  let accMs = 0;
  let lastFrame = 0;
  let playing = false, paused = false, finished = false, starting = false;
  let currentGameId = null;
  let rafId = null;
  const held = { left: false, right: false };

  // ---------- rendering ----------
  function draw() {
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!engine) return;

    for (let i = 0; i < engine.bricks.length; i++) {
      const b = engine.bricks[i];
      if (!b.alive) continue;
      ctx.fillStyle = ROW_COLORS[b.row % ROW_COLORS.length];
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(b.x, b.y, b.w, 3);
    }

    // paddle
    ctx.fillStyle = COL_PADDLE;
    ctx.fillRect(engine.paddleX, engine.paddleY, engine.paddleW, engine.paddleH);

    // ball
    ctx.save();
    ctx.shadowColor = COL_BALL;
    ctx.shadowBlur = 10;
    ctx.fillStyle = COL_BALL;
    ctx.beginPath();
    ctx.arc(engine.bx, engine.by, engine.ballR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function syncHud() {
    scoreEl.textContent = engine ? engine.score : 0;
    livesEl.textContent = engine ? engine.lives : 3;
  }

  function showOverlay(title, html, showButton) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    startBtn.style.display = showButton ? "" : "none";
    overlay.classList.remove("hidden");
  }

  // ---------- loop (mirrors breakout_engine.simulate tick order) ----------
  function stepTick() {
    let dirs = null;
    if (pendingDir !== null) {
      dirs = [pendingDir];
      recorded.push({ tick: tickCount, dir: pendingDir });
      pendingDir = null;
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
    while (accMs >= TICK_MS && steps < MAX_CATCHUP && !engine.gameOver) {
      stepTick();
      accMs -= TICK_MS;
      steps++;
    }
    draw();
    if (engine.gameOver) { finishGame(); return; }
    rafId = requestAnimationFrame(frame);
  }

  // turn the held keys into a paddle direction, queue it if it changed
  function updateDir() {
    let dir = "S";
    if (held.left && !held.right) dir = "L";
    else if (held.right && !held.left) dir = "R";
    if (dir !== lastDir) { pendingDir = dir; lastDir = dir; }
  }

  // ---------- start / finish ----------
  async function startGame() {
    if (starting || playing) return;
    if (!BE || !BE.Engine) { showOverlay("FEHLER", "Engine nicht geladen", true); return; }
    starting = true;
    showOverlay("LÄDT …", "Starte Spiel", false);

    let data;
    try {
      const res = await fetch("/api/breakout/start", { method: "POST" });
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
    engine = new BE.Engine(data.seed >>> 0);
    recorded = [];
    tickCount = 0;
    pendingDir = null;
    lastDir = "S";
    held.left = held.right = false;
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

    showOverlay(engine.won ? "GESCHAFFT!" : "GAME OVER",
      `Score <b>${engine.score}</b> &middot; ${engine.bricksBroken} Steine`, true);
    startBtn.textContent = "Nochmal spielen";

    try {
      const res = await fetch("/api/breakout/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_id: currentGameId, inputs: recorded }),
      });
      if (res.ok) {
        const d = await res.json();
        showOverlay(d.won ? "GESCHAFFT!" : "GAME OVER",
          `Score <b>${d.score}</b> &middot; ${d.bricks} Steine`, true);
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
      const res = await fetch("/api/leaderboard?game=breakout");
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (!playing || finished)) { startGame(); return; }
    if (e.key === "p" || e.key === "P") { togglePause(); return; }
    if (!playing || paused || (engine && engine.gameOver)) return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { e.preventDefault(); held.left = true; updateDir(); }
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { e.preventDefault(); held.right = true; updateDir(); }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { held.left = false; updateDir(); }
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { held.right = false; updateDir(); }
  });
  startBtn.addEventListener("click", startGame);

  // ---------- init ----------
  syncHud();
  draw();
  showOverlay("BEREIT?", 'Drücke <kbd>Enter</kbd> zum Start', true);
  startBtn.textContent = "Spiel starten";
  loadLeaderboard();
})();
