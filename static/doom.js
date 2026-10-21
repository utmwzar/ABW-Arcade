/* DOOM loader.
 * The game itself is Chocolate Doom compiled to WebAssembly (websockets-doom.js
 * + .wasm, GPL). This file only: detects available WADs, fetches the chosen WAD
 * with a progress bar, wires up the Emscripten Module object and starts main().
 * Everything runs client-side; the server just serves static files.
 * Loaded as an ES module so the sound setting comes from js/prefs.js.
 */
import { get as pref } from "./js/prefs.js";

{

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

  // wadName: Name im Spiel (doom1.wad, freedoom1.wad …), file: Datei auf dem Server
  // in ihrer echten Schreibweise (DOOM1.WAD geht auch).
  async function start(wadName, file) {
    if (started) return;
    started = true;
    wadButtons.style.display = "none";
    progWrap.style.display = "";
    titleEl.textContent = "LÄDT";

    let wadBytes, cfgBytes;
    try {
      textEl.textContent = "Spieldaten werden geladen …";
      wadBytes = await fetchWithProgress(BASE + file, (pct) => {
        prog.style.width = pct + "%";
        textEl.textContent = `Spieldaten werden geladen: ${pct} %`;
      });
      cfgBytes = new Uint8Array(await (await fetch(BASE + "default.cfg")).arrayBuffer());
    } catch (e) {
      started = false;
      titleEl.textContent = "KEINE VERBINDUNG";
      textEl.textContent = "Die Spieldaten ließen sich nicht laden. Lade die Seite neu und versuch es noch einmal.";
      wadButtons.style.display = "";
      progWrap.style.display = "none";
      return;
    }

    textEl.textContent = "DOOM startet …";

    const args = ["-iwad", wadName, "-window", "-nogui", "-nomusic",
                  "-config", "default.cfg"];
    // Ton nur, wenn er in den Einstellungen eingeschaltet ist (Standard: stumm).
    if (!pref("doom.sound") || new URLSearchParams(location.search).has("nosound")) args.push("-nosound");

    window.Module = {
      noInitialRun: true,
      canvas,
      arguments: args,
      preRun: [() => {
        Module.FS.writeFile(wadName, wadBytes);
        Module.FS.writeFile("default.cfg", cfgBytes);
      }],
      onRuntimeInitialized: () => {
        overlay.hidden = true;
        fsBtn.disabled = false;
        canvas.focus();
        const main = window.callMain || Module.callMain;
        if (main) {
          main(args);
        } else {
          overlay.hidden = false;
          titleEl.textContent = "STARTFEHLER";
          textEl.textContent = "DOOM ließ sich nicht starten. Lade die Seite neu; wenn es bleibt, sag einem Admin Bescheid.";
          console.error("DOOM: callMain fehlt in websockets-doom.js");
        }
      },
      print: (t) => console.log(t),
      printErr: (t) => console.error(t),
      setStatus: () => {},   // Statusmeldungen der Engine sind englisch und technisch
    };

    const s = document.createElement("script");
    s.src = BASE + "websockets-doom.js";
    s.onerror = () => {
      titleEl.textContent = "STARTFEHLER";
      textEl.textContent = "DOOM ließ sich nicht starten. Lade die Seite neu; wenn es bleibt, sag einem Admin Bescheid.";
      console.error("DOOM: websockets-doom.js nicht gefunden");
    };
    document.body.appendChild(s);
  }

  wadButtons.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-wad]");
    if (btn) start(btn.dataset.wad, btn.dataset.file || btn.dataset.wad);
  });

  fsBtn.addEventListener("click", () => {
    if (window.Module && Module.requestFullscreen) {
      Module.requestFullscreen(false, true);
    } else if (canvas.requestFullscreen) {
      canvas.requestFullscreen();
    }
  });
}
