/* Chess lobby: polls /api/chess/lobby, renders lists, handles create/join/cancel. */
(() => {
  "use strict";

  const openList = document.getElementById("openList");
  const activeList = document.getElementById("activeList");
  const finishedList = document.getElementById("finishedList");
  const rankingBody = document.getElementById("rankingBody");
  const myStats = document.getElementById("myStats");
  const createBtn = document.getElementById("createBtn");

  const REASON_DE = {
    checkmate: "Schachmatt", stalemate: "Patt", resign: "Aufgabe",
    draw_agreed: "Remis vereinbart", fifty_move: "50-Züge-Regel",
    repetition: "Stellungswiederholung", material: "totes Material",
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function post(url) {
    const res = await fetch(url, { method: "POST" });
    let data = {};
    try { data = await res.json(); } catch (e) { /* keep {} */ }
    return { ok: res.ok, status: res.status, data };
  }

  async function refresh() {
    let data;
    try {
      const res = await fetch("/api/chess/lobby");
      if (res.status === 401) { window.location.href = "/login"; return; }
      data = await res.json();
    } catch (e) { return; }

    // open games
    if (!data.open.length) {
      openList.innerHTML = '<li class="lobby-empty">Keine offene Partie — erstell die erste.</li>';
    } else {
      openList.innerHTML = data.open.map((g) => `
        <li>
          <span>${g.mine ? "Deine Partie" : esc(g.creator)} <span class="lobby-meta">wartet auf Gegner</span></span>
          ${g.mine
            ? `<button class="btn btn-ghost btn-sm" data-cancel="${g.id}">Zurückziehen</button>`
            : `<button class="btn btn-sm" data-join="${g.id}">Beitreten</button>`}
        </li>`).join("");
    }

    // my active games
    if (!data.active.length) {
      activeList.innerHTML = '<li class="lobby-empty">Keine laufende Partie.</li>';
    } else {
      activeList.innerHTML = data.active.map((g) => `
        <li>
          <span>gegen <b>${esc(g.opponent || "—")}</b>
            <span class="lobby-meta">· ${g.moves} Züge</span>
            ${g.your_turn ? '<span class="turn-pill">du bist dran</span>' : ""}</span>
          <a class="btn btn-sm" href="/games/chess/${g.id}">Zum Brett</a>
        </li>`).join("");
    }

    // finished
    if (!data.finished.length) {
      finishedList.innerHTML = '<li class="lobby-empty">Noch keine beendete Partie.</li>';
    } else {
      const word = { win: "Sieg", loss: "Niederlage", draw: "Remis" };
      finishedList.innerHTML = data.finished.map((g) => `
        <li>
          <span>gegen <b>${esc(g.opponent || "—")}</b>
            <span class="lobby-meta">· ${REASON_DE[g.reason] || g.reason || ""}</span></span>
          <span class="outcome-${g.outcome}">${word[g.outcome]}</span>
        </li>`).join("");
    }

    // ranking
    if (!data.ratings.length) {
      rankingBody.innerHTML = '<tr><td colspan="6" class="lobby-empty">Noch keine gewerteten Partien.</td></tr>';
    } else {
      rankingBody.innerHTML = data.ratings.map((r, i) => `
        <tr>
          <td>${i + 1}</td><td>${esc(r.username)}</td>
          <td class="num elo">${r.rating}</td>
          <td class="num">${r.wins}</td><td class="num">${r.draws}</td><td class="num">${r.losses}</td>
        </tr>`).join("");
    }

    myStats.innerHTML = `Elo <b class="elo">${data.me.rating}</b> &nbsp;·&nbsp; ` +
      `${data.me.wins} Siege, ${data.me.draws} Remis, ${data.me.losses} Niederlagen`;
  }

  document.addEventListener("click", async (e) => {
    const join = e.target.closest("[data-join]");
    const cancel = e.target.closest("[data-cancel]");
    if (join) {
      join.disabled = true;
      const r = await post(`/api/chess/join/${join.dataset.join}`);
      if (r.ok) window.location.href = `/games/chess/${join.dataset.join}`;
      else { join.disabled = false; refresh(); }
    } else if (cancel) {
      cancel.disabled = true;
      await post(`/api/chess/cancel/${cancel.dataset.cancel}`);
      refresh();
    }
  });

  createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    const r = await post("/api/chess/create");
    createBtn.disabled = false;
    if (!r.ok && r.data.error === "already_waiting") {
      alert("Du hast bereits eine offene Partie — zieh sie zurück oder warte auf einen Gegner.");
    }
    refresh();
  });

  const botBtn = document.getElementById("botBtn");
  botBtn.addEventListener("click", async () => {
    botBtn.disabled = true;
    const body = {
      mode: "bot",
      level: document.getElementById("botLevel").value,
      color: document.getElementById("botColor").value,
    };
    let r;
    try {
      const res = await fetch("/api/chess/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      r = { ok: res.ok, data: await res.json() };
    } catch (e) { r = { ok: false, data: {} }; }
    botBtn.disabled = false;
    if (r.ok) { window.location.href = `/games/chess/${r.data.game_id}`; return; }
    if (r.data.error === "too_many_bot_games") {
      alert("Du hast schon drei laufende Bot-Partien — beende erst eine davon.");
    }
    refresh();
  });

  refresh();
  setInterval(refresh, 3000);
})();
