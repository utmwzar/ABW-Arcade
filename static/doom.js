/* DOOM loader.
 * The game itself is Chocolate Doom compiled to WebAssembly (websockets-doom.js
 * + .wasm, GPL). This file only: detects available WADs, fetches the chosen WAD
 * with a progress bar, wires up the Emscripten Module object and starts main().
 * Everything runs client-side; the server just serves static files.
 */
(() => {
  "use strict";

  const BASE = "/static/doom/";
  const canvas = document.getElementById("canvas");
  const overlay = document.getElementById("doomOverlay");
  const titleEl = document.getElementById("doomTitle");
  const textEl = document.getElementById("doomText");
  const wadButtons = document.getElementById("wadButtons");
  const progWrap = document.getElementById("doomProgressWrap");
  const prog = document.getElementById("doomProgress");
  const fsBtn = document.getElementById("fsBtn");

  let started = false;

  // Offer original WADs if the admin dropped them into static/doom/.
  async function detectWads() {
    for (const wad of ["doom1.wad", "doom2.wad"]) {
      try {
        const res = await fetch(BASE + wad, { method: "HEAD" });
        if (res.ok) {
          const btn = document.createElement("button");
          btn.className = "btn";
          btn.dataset.wad = wad;
          btn.textContent = `Starten (${wad})`;
          wadButtons.appendChild(btn);
        }
      } catch (e) { /* not present */ }
    }
  }

  async function fetchWithProgress(url, onPct) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const total = Number(res.headers.get("Content-Length")) || 0;
    if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const buf = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.set(value, got);
      got += value.length;
      onPct(Math.round((got / total) * 100));
    }
    return buf;
  }

  async function start(wadName) {
    if (started) return;
    started = true;
    wadButtons.style.display = "none";
    progWrap.style.display = "";
    titleEl.textContent = "LÄDT …";

    let wadBytes, cfgBytes;
    try {
      textEl.textContent = `${wadName} wird geladen`;
      wadBytes = await fetchWithProgress(BASE + wadName, (pct) => {
        prog.style.width = pct + "%";
        textEl.textContent = `${wadName} wird geladen — ${pct}%`;
      });
      cfgBytes = new Uint8Array(await (await fetch(BASE + "default.cfg")).arrayBuffer());
    } catch (e) {
      started = false;
      titleEl.textContent = "FEHLER";
      textEl.textContent = "Download fehlgeschlagen — Seite neu laden und erneut versuchen.";
      wadButtons.style.display = "";
      progWrap.style.display = "none";
      return;
    }

    textEl.textContent = "Engine startet …";

    const args = ["-iwad", wadName, "-window", "-nogui", "-nomusic",
                  "-config", "default.cfg"];
    if (new URLSearchParams(location.search).has("nosound")) args.push("-nosound");

    window.Module = {
      noInitialRun: true,
      canvas,
      arguments: args,
      preRun: [() => {
        Module.FS.writeFile(wadName, wadBytes);
        Module.FS.writeFile("default.cfg", cfgBytes);
      }],
      onRuntimeInitialized: () => {
        overlay.classList.add("hidden");
        fsBtn.disabled = false;
        canvas.focus();
        const main = window.callMain || Module.callMain;
        if (main) {
          main(args);
        } else {
          overlay.classList.remove("hidden");
          titleEl.textContent = "FEHLER";
          textEl.textContent = "Engine-Einstieg (callMain) nicht gefunden.";
        }
      },
      print: (t) => console.log(t),
      printErr: (t) => console.error(t),
      setStatus: (t) => { if (t) textEl.textContent = t; },
    };

    const s = document.createElement("script");
    s.src = BASE + "websockets-doom.js";
    s.onerror = () => {
      titleEl.textContent = "FEHLER";
      textEl.textContent = "Engine (websockets-doom.js) nicht gefunden.";
    };
    document.body.appendChild(s);
  }

  wadButtons.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-wad]");
    if (btn) start(btn.dataset.wad);
  });

  fsBtn.addEventListener("click", () => {
    if (window.Module && Module.requestFullscreen) {
      Module.requestFullscreen(false, true);
    } else if (canvas.requestFullscreen) {
      canvas.requestFullscreen();
    }
  });

  detectWads();
})();
