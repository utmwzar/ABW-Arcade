/*
 * Geometry Dash frontend.
 * All game RULES live in gd_engine.js (shared with the server). This file does
 * rendering, input and the fixed-timestep loop, and RECORDS every jump-button
 * toggle as { tick, dir } (D = press, U = release). On game over it posts the
 * recorded log to the server, which replays it through the identical engine and
 * computes the authoritative distance. The client never sends a score.
 *
 * Desktop only (keyboard + mouse) — no touch handling.
 * The cube's spin is purely cosmetic and never affects collision.
 */
(() => {
  "use strict";

  const GE = window.GDEngine;
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("startBtn");

  // ---- view geometry (canvas buffer is 900x280; CSS scales it) ----
  const W = canvas.width, H = canvas.height;
  const CELLPX = 36;
  const PXFP = CELLPX / GE.CELL;        // screen px per fp unit
  const GROUND_Y = H - 44;              // y of the floor's top surface
  const CUBE_X = 150;                   // cube's fixed left edge on screen

  const COL_PADDLE = "#5b8cff";
  const COL_CUBE = "#5b8cff";
  const COL_CUBE_IN = "#cfe0ff";
  const COL_SPIKE = "#ff4566";
  const COL_SPIKE_HI = "#ff90a4";
  const COL_BLOCK = "#4a3a8a";
  const COL_BLOCK_TOP = "#a98cff";
  const COL_FLOOR = "#15102a";
  const COL_GRID = "rgba(140,120,255,0.06)";

  const TICK_MS = 16;                   // ~60 ticks/s; server replays ticks regardless
  const MAX_CATCHUP = 5;

  let engine = null;
  let recorded = [];
  let tickCount = 0;
  let pending = null;                   // queued toggle not yet committed to a tick
  let held = false, lastHeld = false;
  let accMs = 0, lastFrame = 0;
  let playing = false, finished = false, starting = false;
  let currentGameId = null;
  let rafId = null;
  let cubeAngle = 0;                    // cosmetic only
  let trail = [];

  // ---------- helpers ----------
  function sx(worldX) { return CUBE_X + (worldX - engine.worldX) * PXFP; }
  function syForHeight(h) { return GROUND_Y - h * PXFP; }

  // ---------- rendering ----------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b0524");
    g.addColorStop(1, "#05030f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // scrolling vertical grid
    const wx = engine ? engine.worldX : 0;
    const step = CELLPX * 2;
    const off = ((wx * PXFP) % step);
    ctx.strokeStyle = COL_GRID;
    ctx.lineWidth = 1;
    for (let x = -off; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GROUND_Y); ctx.stroke();
    }
    for (let y = GROUND_Y - step; y > 0; y -= step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  function drawFloor() {
    ctx.fillStyle = COL_FLOOR;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = COL_PADDLE;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y + 1); ctx.lineTo(W, GROUND_Y + 1); ctx.stroke();
    // moving floor ticks
    const wx = engine ? engine.worldX : 0;
    const step = CELLPX;
    const off = ((wx * PXFP) % step);
    ctx.strokeStyle = "rgba(91,140,255,0.18)";
    ctx.lineWidth = 1;
    for (let x = -off; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, GROUND_Y + 6); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  function drawObstacles() {
    const leftFp = engine.worldX - (CUBE_X / PXFP) - GE.CELL;
    const rightFp = engine.worldX + ((W - CUBE_X) / PXFP) + GE.CELL;
    for (let i = 0; i < engine.obstacles.length; i++) {
      const ob = engine.obstacles[i];
      if (ob.x1 < leftFp || ob.x0 > rightFp) continue;
      if (ob.kind === GE.SPIKE) {
        // derive cell footprint from the (inset) hitbox so triangles look right
        const cellLeft = ob.x0 - GE.SPIKE_INSET;
        const widthCells = Math.round(((ob.x1 - ob.x0) + 2 * GE.SPIKE_INSET) / GE.CELL);
        for (let c = 0; c < widthCells; c++) {
          const bx = sx(cellLeft + c * GE.CELL);
          const bw = CELLPX;
          const apexH = GE.CELL;            // visual height ~1 cell
          ctx.fillStyle = COL_SPIKE;
          ctx.beginPath();
          ctx.moveTo(bx + 2, GROUND_Y);
          ctx.lineTo(bx + bw - 2, GROUND_Y);
          ctx.lineTo(bx + bw / 2, syForHeight(apexH));
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = COL_SPIKE_HI;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else {
        const x = sx(ob.x0);
        const w = (ob.x1 - ob.x0) * PXFP;
        const topY = syForHeight(ob.top);
        ctx.fillStyle = COL_BLOCK;
        ctx.fillRect(x, topY, w, GROUND_Y - topY);
        ctx.fillStyle = COL_BLOCK_TOP;
        ctx.fillRect(x, topY, w, 4);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, topY + 0.5, w - 1, GROUND_Y - topY - 1);
      }
    }
  }

  function drawCube() {
    const bottomY = GROUND_Y - engine.y * PXFP;
    const cx = CUBE_X + CELLPX / 2;
    const cy = bottomY - CELLPX / 2;

    // trail
    for (let i = 0; i < trail.length; i++) {
      const a = (i + 1) / (trail.length + 1) * 0.28;
      ctx.fillStyle = `rgba(91,140,255,${a})`;
      const s = CELLPX * (0.5 + 0.5 * (i + 1) / trail.length);
      ctx.fillRect(trail[i].x - s / 2, trail[i].y - s / 2, s, s);
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(cubeAngle);
    ctx.shadowColor = "rgba(91,140,255,0.6)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = COL_CUBE;
    const r = 6;
    roundRect(-CELLPX / 2, -CELLPX / 2, CELLPX, CELLPX, r);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COL_CUBE_IN;
    const inner = CELLPX * 0.34;
    roundRect(-inner / 2, -inner / 2, inner, inner, 3);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    drawBackground();
    if (!engine) { drawFloor(); return; }
    drawObstacles();
    drawFloor();
    drawCube();
  }

  function syncHud() {
    scoreEl.textContent = engine ? engine.cells : 0;
  }

  function showOverlay(title, html, showButton) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    startBtn.style.display = showButton ? "" : "none";
    overlay.classList.remove("hidden");
  }

  // ---------- loop (mirrors gd_engine.simulate tick order) ----------
  function stepTick() {
    let events = null;
    if (pending !== null) {
      events = [pending];
      recorded.push({ tick: tickCount, dir: pending });
      pending = null;
    }
    engine.tick(events);
    tickCount++;

    // cosmetic spin + trail
    if (!engine.onGround) cubeAngle += 0.12;
    else {
      // ease the spin back to an upright quarter
      const q = Math.round(cubeAngle / (Math.PI / 2)) * (Math.PI / 2);
      cubeAngle += (q - cubeAngle) * 0.5;
      if (Math.abs(q - cubeAngle) < 0.02) cubeAngle = 0;
    }
    trail.push({ x: CUBE_X + CELLPX / 2, y: GROUND_Y - engine.y * PXFP - CELLPX / 2 });
    if (trail.length > 6) trail.shift();

    syncHud();
  }

  function frame(now) {
    if (!playing) return;
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

  // turn the held button into a recorded toggle when it changes
  function updateHold() {
    if (held !== lastHeld) {
      pending = held ? "D" : "U";
      lastHeld = held;
    }
  }

  // ---------- start / finish ----------
  async function startGame() {
    if (starting || playing) return;
    if (!GE || !GE.Engine) { showOverlay("FEHLER", "Engine nicht geladen", true); return; }
    starting = true;
    showOverlay("LÄDT …", "Starte Lauf", false);

    let data;
    try {
      const res = await fetch("/api/geometry-dash/start", { method: "POST" });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (res.status === 429) {
        starting = false;
        showOverlay("LANGSAM", "Zu viele Läufe in kurzer Zeit – kurz warten", true);
        startBtn.textContent = "Lauf starten";
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
    tickCount = 0;
    pending = null;
    held = false; lastHeld = false;
    cubeAngle = 0; trail = [];
    accMs = 0;
    lastFrame = performance.now();
    finished = false; playing = true; starting = false;

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

    showOverlay(engine.won ? "DURCHGESPIELT!" : "GAME OVER",
      `Distanz <b>${engine.cells}</b> Zellen`, true);
    startBtn.textContent = "Nochmal";

    try {
      const res = await fetch("/api/geometry-dash/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_id: currentGameId, inputs: recorded }),
      });
      if (res.ok) {
        const d = await res.json();
        showOverlay(d.won ? "DURCHGESPIELT!" : "GAME OVER",
          `Distanz <b>${d.score}</b> Zellen`, true);
        startBtn.textContent = "Nochmal";
        if (d.score !== engine.cells) {
          console.warn("client/server distance mismatch", { client: engine.cells, server: d.score });
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
      const res = await fetch("/api/leaderboard?game=geometry-dash");
      const data = await res.json();
      const rows = data.leaderboard || [];
      const meName = data.me && data.me.username;

      if (rows.length === 0) {
        lbEl.innerHTML = '<li class="lb-empty">Noch keine Läufe – sei der Erste!</li>';
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
          `Deine beste Distanz: <b>${Number(data.me.best).toLocaleString("de-DE")}</b>` +
          (data.me.rank ? ` &middot; Platz ${data.me.rank}` : "");
        if (bestEl) bestEl.textContent = data.me.best;
      } else {
        personalEl.innerHTML = "";
      }
    } catch (e) {
      lbEl.innerHTML = '<li class="lb-empty">Leaderboard nicht erreichbar</li>';
    }
  }

  // ---------- input (desktop only) ----------
  const JUMP_KEYS = [" ", "ArrowUp", "w", "W", "Spacebar", "Up"];
  document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") {
      if (!starting) { playing = false; finished = false; startGame(); }
      e.preventDefault(); return;
    }
    if (JUMP_KEYS.indexOf(e.key) !== -1) {
      e.preventDefault();
      if (!playing || finished) { startGame(); return; }
      if (!e.repeat) { held = true; updateHold(); }
      return;
    }
    if (e.key === "Enter" && (!playing || finished)) { startGame(); }
  });
  document.addEventListener("keyup", (e) => {
    if (JUMP_KEYS.indexOf(e.key) !== -1) { held = false; updateHold(); }
  });
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (!playing || finished) { startGame(); return; }
    held = true; updateHold();
  });
  window.addEventListener("mouseup", () => { if (held) { held = false; updateHold(); } });
  startBtn.addEventListener("click", (e) => { e.preventDefault(); startGame(); });

  // ---------- init ----------
  syncHud();
  draw();
  showOverlay("BEREIT?", 'Drücke <kbd>Leertaste</kbd> zum Springen und Starten', true);
  startBtn.textContent = "Lauf starten";
  loadLeaderboard();
})();
