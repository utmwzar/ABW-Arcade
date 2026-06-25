/* Chess board page. The server is the only rule authority: it sends the board,
 * whose turn it is and (when it's ours) the legal-move map. We render, collect
 * clicks and POST moves. State refreshes via polling. */
(() => {
  "use strict";

  const shell = document.querySelector(".chess-shell");
  const GAME_ID = shell.dataset.gameId;
  const boardEl = document.getElementById("chessBoard");
  const rowTop = document.getElementById("rowTop");
  const rowBottom = document.getElementById("rowBottom");
  const statusLine = document.getElementById("statusLine");
  const drawBanner = document.getElementById("drawBanner");
  const movelist = document.getElementById("movelist");
  const actionRow = document.getElementById("actionRow");
  const drawBtn = document.getElementById("drawBtn");
  const resignBtn = document.getElementById("resignBtn");
  const promoOverlay = document.getElementById("promoOverlay");

  const GLYPH = {
    P: "♟", N: "♞", B: "♝", R: "♜", Q: "♛", K: "♚",
    p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
  };
  const FILES = "abcdefgh";
  const REASON_DE = {
    checkmate: "Schachmatt", stalemate: "Patt", resign: "Aufgabe",
    draw_agreed: "Remis vereinbart", fifty_move: "50-Züge-Regel",
    repetition: "Stellungswiederholung", material: "totes Material",
  };

  let state = null;
  let selected = null;          // "e2"
  let pendingPromo = null;      // {from, to}
  let lastSig = "";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function sqName(r, c) { return FILES[c] + (8 - r); }

  function lastMoveSquares() {
    if (!state || !state.history.length) return [];
    const m = state.history[state.history.length - 1];
    return [m.from, m.to];
  }

  function kingSquare(color) {
    const k = color === "w" ? "K" : "k";
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (state.board[r][c] === k) return sqName(r, c);
    }
    return null;
  }

  function render() {
    if (!state) return;
    const youAreBlack = state.you === "b";
    const myTurn = state.status === "active" && state.you === state.turn;
    const legal = state.legal || {};
    const targets = selected ? (legal[selected] || []).map((m) => m.to) : [];
    const last = lastMoveSquares();
    const checkSq = state.in_check && state.status === "active" ? kingSquare(state.turn) : null;

    boardEl.innerHTML = "";
    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const r = youAreBlack ? 7 - vr : vr;
        const c = youAreBlack ? 7 - vc : vc;
        const name = sqName(r, c);
        const p = state.board[r][c];
        const sq = document.createElement("div");
        sq.className = `sq ${(r + c) % 2 === 0 ? "light" : "dark"}`;
        sq.dataset.sq = name;
        if (p) {
          sq.innerHTML = `<span class="${p === p.toUpperCase() ? "piece-w" : "piece-b"}">${GLYPH[p]}</span>`;
        }
        if (vc === 7) sq.insertAdjacentHTML("beforeend", `<span class="coord rank">${8 - r}</span>`);
        if (vr === 7) sq.insertAdjacentHTML("beforeend", `<span class="coord file">${FILES[c]}</span>`);
        if (last.includes(name)) sq.classList.add("lastmove");
        if (checkSq === name) sq.classList.add("incheck");
        if (myTurn && legal[name]) sq.classList.add("selectable");
        if (selected === name) sq.classList.add("selected");
        if (targets.includes(name)) {
          sq.classList.add("target", "selectable");
          if (p) sq.classList.add("capture");
        }
        boardEl.appendChild(sq);
      }
    }

    // player rows: opponent on top, you at the bottom
    const meKey = youAreBlack ? "black" : "white";
    const oppKey = youAreBlack ? "white" : "black";
    fillRow(rowTop, state[oppKey], oppKey === "white" ? "w" : "b");
    fillRow(rowBottom, state[meKey], meKey === "white" ? "w" : "b");

    // status
    statusLine.classList.remove("alert", "gold");
    if (state.status === "finished") {
      const reason = REASON_DE[state.end_reason] || state.end_reason;
      let line;
      if (state.result === "draw") line = `Remis — ${reason}`;
      else {
        const winColor = state.result === "white" ? "w" : "b";
        const winner = state.result === "white" ? state.white : state.black;
        const youWon = state.you === winColor;
        line = `${esc(winner ? winner.name : "?")} gewinnt — ${reason}`;
        statusLine.classList.add(youWon ? "gold" : "alert");
      }
      statusLine.textContent = line;
      actionRow.style.display = "none";
    } else {
      actionRow.style.display = "";
      if (state.in_check) {
        statusLine.textContent = myTurn ? "Du stehst im Schach!" : "Schach!";
        statusLine.classList.add("alert");
      } else {
        statusLine.textContent = myTurn ? "Du bist am Zug." : "Warten auf den Gegner …";
      }
    }

    // draw offer banner
    if (state.status === "active" && state.draw_offer) {
      if (state.draw_offer === state.you) {
        drawBanner.style.display = "";
        drawBanner.innerHTML = "Dein Remis-Angebot steht — warten auf Antwort.";
      } else {
        drawBanner.style.display = "";
        drawBanner.innerHTML =
          'Dein Gegner bietet Remis an. ' +
          '<button class="btn btn-sm" data-draw="accept">Annehmen</button> ' +
          '<button class="btn btn-ghost btn-sm" data-draw="decline">Ablehnen</button>';
      }
    } else {
      drawBanner.style.display = "none";
    }
    const isBot = !!state.bot_level;
    drawBtn.style.display = isBot ? "none" : "";
    drawBtn.disabled = !(state.status === "active" && !state.draw_offer);
    document.getElementById("unratedTag").style.display = isBot ? "" : "none";

    // moves: paired by full move
    if (!state.history.length) {
      movelist.innerHTML = '<span class="lobby-empty">Noch keine Züge.</span>';
    } else {
      let html = "";
      for (let i = 0; i < state.history.length; i += 2) {
        const no = i / 2 + 1;
        html += `<span class="mvno">${no}.</span>` +
                `<span class="mv">${fmtMove(state.history[i])}</span>` +
                (state.history[i + 1] ? `<span class="mv">${fmtMove(state.history[i + 1])}</span>` : "");
      }
      movelist.innerHTML = html;
      movelist.scrollTop = movelist.scrollHeight;
    }
  }

  function fillRow(row, player, color) {
    const toMove = state.status === "active" && state.turn === color;
    row.classList.toggle("to-move", toMove);
    row.querySelector(".pname").innerHTML =
      `<span class="dot">${color === "w" ? "○" : "●"}</span>${player ? esc(player.name) : "—"}`;
    row.querySelector(".prating").textContent = (player && player.rating != null) ? player.rating : "";
  }

  function fmtMove(m) {
    if (m.flag === "OO") return "O-O" + (m.check ? "+" : "");
    if (m.flag === "OOO") return "O-O-O" + (m.check ? "+" : "");
    const g = m.piece.toUpperCase() === "P" ? "" : GLYPH[m.piece];
    return `${g}${m.from}${m.capture ? "×" : "–"}${m.to}` +
           (m.promo ? "=" + GLYPH[m.promo] : "") + (m.check ? "+" : "");
  }

  // ---------- server I/O ----------
  function sig(s) {
    return [s.status, s.turn, s.history.length, s.draw_offer, s.result].join("|");
  }

  function adopt(s) {
    state = s;
    const ns = sig(s);
    if (ns !== lastSig) { selected = null; lastSig = ns; }
    render();
  }

  async function poll() {
    try {
      const res = await fetch(`/api/chess/state/${GAME_ID}`);
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (res.status === 403 || res.status === 404) { window.location.href = "/games/chess"; return; }
      adopt(await res.json());
    } catch (e) { /* next poll */ }
  }

  async function sendMove(from, to, promotion) {
    if (state && state.bot_level) {
      statusLine.classList.remove("alert", "gold");
      statusLine.textContent = "Bot denkt …";
    }
    try {
      const res = await fetch(`/api/chess/move/${GAME_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, promotion }),
      });
      const data = await res.json();
      if (res.ok) { selected = null; adopt(data); }
      else { selected = null; poll(); }
    } catch (e) { /* poll will recover */ }
  }

  // ---------- input ----------
  boardEl.addEventListener("click", (e) => {
    const sq = e.target.closest(".sq");
    if (!sq || !state || state.status !== "active") return;
    if (state.you !== state.turn) return;
    const name = sq.dataset.sq;
    const legal = state.legal || {};

    if (selected) {
      const mv = (legal[selected] || []).find((m) => m.to === name);
      if (mv) {
        if (mv.promo) { pendingPromo = { from: selected, to: name }; promoOverlay.style.display = ""; }
        else sendMove(selected, name);
        return;
      }
    }
    selected = legal[name] ? (selected === name ? null : name) : null;
    render();
  });

  promoOverlay.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-promo]");
    if (!btn || !pendingPromo) { promoOverlay.style.display = "none"; pendingPromo = null; return; }
    const { from, to } = pendingPromo;
    pendingPromo = null;
    promoOverlay.style.display = "none";
    sendMove(from, to, btn.dataset.promo);
  });

  drawBtn.addEventListener("click", async () => {
    drawBtn.disabled = true;
    const res = await fetch(`/api/chess/draw/${GAME_ID}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "offer" }),
    });
    if (res.ok) adopt(await res.json()); else poll();
  });

  drawBanner.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-draw]");
    if (!btn) return;
    const res = await fetch(`/api/chess/draw/${GAME_ID}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: btn.dataset.draw }),
    });
    if (res.ok) adopt(await res.json()); else poll();
  });

  resignBtn.addEventListener("click", async () => {
    if (!confirm("Wirklich aufgeben? Die Partie wird als Niederlage gewertet.")) return;
    const res = await fetch(`/api/chess/resign/${GAME_ID}`, { method: "POST" });
    if (res.ok) adopt(await res.json()); else poll();
  });

  poll();
  setInterval(poll, 2000);
})();
