#!/usr/bin/env node
/**
 * ABW Arcade — Gleichlauf-Pruefung der Engines
 *
 *     node pruefe-engines.js            alle Spiele
 *     node pruefe-engines.js snake gd   nur diese
 *
 * Wozu das da ist
 * ---------------
 * Der Betrugsschutz der Bestenlisten steht und faellt mit einer einzigen
 * Annahme: <spiel>_engine.py und static/<spiel>_engine.js rechnen bei
 * gleicher Eingabe exakt dasselbe aus. Der Browser spielt mit der JS-Fassung,
 * der Server rechnet mit der Python-Fassung nach — weichen die beiden ab,
 * passiert nichts Lautes. Es werden nur stillschweigend ehrliche Partien
 * abgelehnt oder falsche Punktestaende eingetragen.
 *
 * Genau das prueft dieses Skript: Es wuerfelt Eingabeprotokolle, schickt
 * JEDES davon durch beide Fassungen und vergleicht die Ergebnisse Feld fuer
 * Feld.
 *
 * Die Protokolle entstehen nur EINMAL, hier in JS, und werden unveraendert
 * an Python weitergereicht. Zwei getrennte Generatoren waeren eine zweite
 * Stelle, an der die Seiten auseinanderlaufen koennten.
 *
 * Der Zufall ist geseedet. Ein Fehlschlag ist damit wiederholbar, und ein
 * gruener Lauf heisst bei jedem dasselbe.
 *
 * Braucht node und python3, sonst nichts.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HIER = __dirname;

/**
 * Je Spiel: wie die Eingaben heissen und welche erlaubt sind.
 * Die Werte stammen aus den ACTIONS-Konstanten der Engines — weichen sie
 * dort ab, faellt es hier als Fehlschlag auf.
 *
 * maxLuecke  groesster Tick-Abstand zwischen zwei Eingaben
 */
const SPIELE = {
  tetris:   { schluessel: "action", aktionen: ["L", "R", "ROT", "SOFT", "HARD"], maxLuecke: 12 },
  breakout: { schluessel: "dir",    aktionen: ["L", "R", "S"],                   maxLuecke: 12 },
  g2048:    { schluessel: "dir",    aktionen: ["U", "D", "L", "R"],              maxLuecke: 12 },
  gd:       { schluessel: "dir",    aktionen: ["D", "U"],                        maxLuecke: 12 },

  // Snake erzeugt seine Protokolle anders — siehe snakeProtokoll() weiter unten.
  snake:    { schluessel: "dir",    aktionen: ["U", "D", "L", "R"],              maxLuecke: 5 },
};

const FAELLE_JE_SPIEL = 30;

/** mulberry32 — kleiner, geseedeter PRNG. Nur fuer die Testdaten. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ein Eingabeprotokoll wuerfeln.
 *
 * Die Ticks steigen monoton mit zufaelligen Luecken — so entstehen sowohl
 * Haeufungen (mehrere Aktionen im selben Tick) als auch Pausen, in denen nur
 * die Schwerkraft laeuft. Beides sind Stellen, an denen zwei Fassungen
 * typischerweise auseinanderlaufen.
 */
function protokollWuerfeln(zufall, cfg, anzahl) {
  const { schluessel, aktionen, maxLuecke } = cfg;
  const eingaben = [];
  let tick = 0;
  for (let i = 0; i < anzahl; i++) {
    tick += Math.floor(zufall() * maxLuecke); // 0 heisst: gleicher Tick wie zuvor
    const a = aktionen[Math.floor(zufall() * aktionen.length)];
    eingaben.push({ tick, [schluessel]: a });
  }
  return eingaben;
}

/**
 * Snake: ein Protokoll erzeugen, in dem die Schlange wirklich frisst.
 *
 * Zufaellige Richtungen reichen hier nicht. Auf 20x20 findet eine planlos
 * herumirrende Schlange fast nie Futter — der Test verglich dadurch nur
 * Partien mit Punktestand 0 und liess ausgerechnet Fressen und Wachsen
 * ungeprueft, also die Stellen, an denen zwei Fassungen am ehesten
 * auseinanderlaufen.
 *
 * Deshalb steuert hier ein einfacher Spieler: Er laeuft aufs Futter zu und
 * meidet Wand und eigenen Koerper. Er benutzt dafuer die JS-Engine selbst
 * als Auskunft (Kopfposition, Futter, Richtung) — es wird keine Spiellogik
 * nachgebaut, sondern nur eine realistische Partie aufgezeichnet. Geprueft
 * wird danach wie bei allen anderen: Python muss dasselbe Protokoll zum
 * selben Ergebnis nachrechnen.
 *
 * In 15 % der Ticks greift er absichtlich daneben, damit nicht nur der
 * Ideallauf abgedeckt ist.
 */
const SNAKE_DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
const SNAKE_OPP = { U: "D", D: "U", L: "R", R: "L" };

function snakeProtokoll(zufall, seed, maxTicks) {
  const mod = require(path.join(HIER, "static", "snake_engine.js"));
  const e = new mod.Engine(seed);
  const eingaben = [];

  for (let tick = 0; tick < maxTicks && !e.gameOver; tick++) {
    const [hx, hy] = e.snake[0];
    let wunsch = [];
    if (e.food) {
      const [fx, fy] = e.food;
      if (fx < hx) wunsch.push("L");
      else if (fx > hx) wunsch.push("R");
      if (fy < hy) wunsch.push("U");
      else if (fy > hy) wunsch.push("D");
      if (zufall() < 0.5) wunsch.reverse(); // mal waagerecht, mal senkrecht zuerst
    }
    if (zufall() < 0.15) wunsch = []; // absichtlich danebengreifen

    const belegt = new Set(e.snake.map(([x, y]) => x + "," + y));
    const gangbar = (d) => {
      if (d === SNAKE_OPP[e.dir]) return false;
      const [dx, dy] = SNAKE_DIRS[d];
      const nx = hx + dx, ny = hy + dy;
      if (nx < 0 || nx >= e.cols || ny < 0 || ny >= e.rows) return false;
      return !belegt.has(nx + "," + ny);
    };

    const ausweich = ["U", "D", "L", "R"].filter((d) => d !== e.dir);
    const kandidaten = wunsch.concat([e.dir], ausweich).filter(gangbar);
    const d = kandidaten.length ? kandidaten[0] : e.dir;

    // Nur echte Wechsel aufzeichnen. Auf Ticks ohne Eintrag behaelt die
    // Engine beim Nachspielen ohnehin ihre Richtung bei.
    if (d !== e.dir) eingaben.push({ tick, dir: d });
    e.tick([d]);
  }
  return eingaben;
}

/**
 * Tetris: ein Protokoll erzeugen, in dem tatsaechlich Reihen geraeumt werden.
 *
 * Auch hier reicht Zufall nicht. Zufaellig fallende Steine tuermen sich, das
 * Spiel endet, und geraeumt wird nie eine einzige Reihe — nachgemessen: 0 in
 * 30 Faellen. Der gesamte Punktestand kam aus Drop-Punkten. Damit blieb
 * ausgerechnet LINE_SCORES ungeprueft, also die Punktetabelle selbst, und mit
 * ihr Levelaufstieg und levelabhaengige Fallgeschwindigkeit.
 *
 * Deshalb waehlt hier eine einfache Bewertung die Ablage: volle Reihen zaehlen
 * viel, Loecher und Hoehe kosten. Kollision und Landepunkt kommen aus der
 * Engine selbst (_collides), nur das Drehen der Matrix ist nachgebildet.
 *
 * Diese Auswahl muss weder optimal noch ueberhaupt richtig sein — sie erzeugt
 * nur Eingaben. Gespielt und gewertet wird danach ausschliesslich von den
 * echten Engines. Ein Fehler hier fuehrt zu schlechteren Ablagen, nicht zu
 * einem falschen Testergebnis.
 */
function dreheMatrix(m) {
  const n = m.length;
  const aus = [];
  for (let i = 0; i < n; i++) aus.push(new Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) aus[x][n - 1 - y] = m[y][x];
  return aus;
}

function ablageBewerten(grid, m, px, py) {
  const zeilen = grid.length, spalten = grid[0].length;
  const g = grid.map((r) => r.slice());
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      const by = py + y, bx = px + x;
      if (m[y][x] && by >= 0 && by < zeilen && bx >= 0 && bx < spalten) g[by][bx] = m[y][x];
    }
  }
  let voll = 0;
  for (let y = 0; y < zeilen; y++) if (g[y].every((c) => c)) voll++;
  let loecher = 0, hoehe = 0;
  for (let x = 0; x < spalten; x++) {
    let oben = -1;
    for (let y = 0; y < zeilen; y++) if (g[y][x]) { oben = y; break; }
    if (oben < 0) continue;
    hoehe = Math.max(hoehe, zeilen - oben);
    for (let y = oben + 1; y < zeilen; y++) if (!g[y][x]) loecher++;
  }
  return voll * 160 - loecher * 22 - hoehe * 3;
}

function tetrisProtokoll(seed, maxStuecke) {
  const mod = require(path.join(HIER, "static", "tetris_engine.js"));
  const e = new mod.Engine(seed);
  e.start();

  const eingaben = [];
  let tick = 0;

  for (let n = 0; n < maxStuecke && !e.gameOver && e.current; n++) {
    let m = e.current.matrix;
    let beste = null;
    for (let rot = 0; rot < 4; rot++) {
      for (let x = -3; x <= 10; x++) {
        if (e._collides({ matrix: m, x, y: 0 })) continue;
        let y = 0;
        while (!e._collides({ matrix: m, x, y: y + 1 })) y++;
        const wert = ablageBewerten(e.grid, m, x, y);
        if (!beste || wert > beste.wert) beste = { rot, x, wert };
      }
      m = dreheMatrix(m);
    }
    if (!beste) break;

    const tu = (aktion) => { eingaben.push({ tick, action: aktion }); e.applyAction(aktion); };
    for (let i = 0; i < beste.rot; i++) tu("ROT");
    // Schutz gegen Endlosschleifen: Stoesst der Stein an, aendert sich x nicht.
    let schutz = 0;
    while (e.current && e.current.x > beste.x && schutz++ < 12) tu("L");
    schutz = 0;
    while (e.current && e.current.x < beste.x && schutz++ < 12) tu("R");
    tu("HARD");
    tick++;
  }
  return eingaben;
}

/** Die Faelle fuer ein Spiel aufbauen. Immer dieselben, weil geseedet. */
function faelleBauen(spiel) {
  const cfg = SPIELE[spiel];
  const zufall = rng(0x5eed ^ [...spiel].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const faelle = [];
  for (let i = 0; i < FAELLE_JE_SPIEL; i++) {
    // Auch der Sonderfall "gar keine Eingabe" gehoert dazu: Dann laeuft die
    // Partie allein durch Schwerkraft bzw. endet sofort.
    const anzahl = i === 0 ? 0 : Math.floor(zufall() * 250) + 1;
    const seed = Math.floor(zufall() * 0xffffffff) >>> 0;

    // Snake und Tetris bekommen gesteuerte Partien, sonst wuerden ihre
    // wichtigsten Regeln nie ausgeloest (siehe die Kommentare oben).
    // Bei Tetris bleibt jeder dritte Fall zufaellig: Planloses Spiel endet
    // frueh und trifft dadurch andere Stellen — Spielende, Ueberlauf beim
    // Spawn, reine Drop-Punkte ohne Reihe.
    let eingaben;
    if (anzahl === 0) {
      eingaben = [];
    } else if (spiel === "snake") {
      eingaben = snakeProtokoll(zufall, seed, 1500);
    } else if (spiel === "tetris" && i % 3 !== 0) {
      eingaben = tetrisProtokoll(seed, 120);
    } else {
      eingaben = protokollWuerfeln(zufall, cfg, anzahl);
    }
    faelle.push({ spiel, seed, eingaben });
  }
  return faelle;
}

/** Ein Fall durch die JS-Fassung schicken. */
function jsLauf(fall) {
  const modul = require(path.join(HIER, "static", `${fall.spiel}_engine.js`));
  if (typeof modul.simulate !== "function") {
    throw new Error(`static/${fall.spiel}_engine.js exportiert kein simulate()`);
  }
  return modul.simulate(fall.seed, fall.eingaben);
}

/**
 * Vorsorge gegen veralteten Bytecode.
 *
 * Python entscheidet anhand von Zeitstempel UND Dateigroesse, ob ein .pyc in
 * __pycache__ noch gilt. Eine Aenderung, die die Groesse nicht veraendert
 * (etwa 1 -> 2 in einer Konstanten) und innerhalb derselben Sekunde wie der
 * letzte Lauf passiert, wird dabei nicht bemerkt: Python nimmt den alten
 * Bytecode.
 *
 * Fuer diesen Pruefstand waere das der schlimmste denkbare Fehler — er
 * meldete gruen, waehrend er die vorige Fassung der Engine testet. Deshalb
 * werden die zwischengespeicherten Engines vor jedem Lauf entfernt, und die
 * Python-Seite legt keine neuen an.
 */
function bytecodeVerwerfen() {
  const cache = path.join(HIER, "__pycache__");
  let entfernt = 0;
  try {
    for (const datei of fs.readdirSync(cache)) {
      if (/_engine\..*\.pyc$/.test(datei)) {
        fs.unlinkSync(path.join(cache, datei));
        entfernt++;
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e; // kein __pycache__ ist der Normalfall
  }
  return entfernt;
}

/** Alle Faelle in einem Rutsch durch die Python-Fassung schicken. */
function pythonLauf(faelle) {
  const python = process.env.PYTHON || "python3";
  bytecodeVerwerfen();
  const ergebnis = spawnSync(python, ["-B", path.join(HIER, "pruefe_engines.py")], {
    input: JSON.stringify(faelle),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (ergebnis.error) {
    throw new Error(
      `${python} liess sich nicht starten: ${ergebnis.error.message}\n` +
      `Anderer Interpreter: PYTHON=/pfad/zu/python node pruefe-engines.js`
    );
  }
  if (ergebnis.status !== 0) {
    throw new Error(`Die Python-Seite brach ab:\n${ergebnis.stderr || ergebnis.stdout}`);
  }
  return JSON.parse(ergebnis.stdout);
}

/**
 * Zwei Ergebnisse vergleichen. Gibt eine Liste der Abweichungen zurueck,
 * leer heisst gleich.
 *
 * Verglichen werden auch die Schluessel selbst: Faellt auf einer Seite ein
 * Feld weg, ist das ebenso eine Abweichung wie ein falscher Wert.
 */
function vergleichen(ausJs, ausPy) {
  const abweichungen = [];
  const schluessel = new Set([...Object.keys(ausJs || {}), ...Object.keys(ausPy || {})]);
  for (const k of [...schluessel].sort()) {
    const a = ausJs ? ausJs[k] : undefined;
    const b = ausPy ? ausPy[k] : undefined;
    // JSON macht aus Pythons True ein true — normalisieren, damit nicht
    // Datentypen als Unterschied gemeldet werden, wo keiner ist.
    const na = typeof a === "boolean" ? Number(a) : a;
    const nb = typeof b === "boolean" ? Number(b) : b;
    if (na !== nb) abweichungen.push({ feld: k, js: a, py: b });
  }
  return abweichungen;
}

function main() {
  const gewuenscht = process.argv.slice(2);
  const spiele = gewuenscht.length ? gewuenscht : Object.keys(SPIELE);

  for (const s of spiele) {
    if (!SPIELE[s]) {
      console.error(`Unbekanntes Spiel: ${s}`);
      console.error(`Bekannt sind: ${Object.keys(SPIELE).join(", ")}`);
      process.exit(2);
    }
  }

  console.log(`Gleichlauf-Pruefung: ${spiele.length} Spiel(e), je ${FAELLE_JE_SPIEL} Faelle\n`);

  const alleFaelle = spiele.flatMap(faelleBauen);

  // Erst JS, dann Python — die Python-Seite laeuft als ein einziger
  // Prozessstart fuer alle Faelle, sonst kostet der Interpreterstart mehr
  // Zeit als die Rechnung.
  const jsErgebnisse = alleFaelle.map((f) => {
    try {
      return { ok: true, wert: jsLauf(f) };
    } catch (e) {
      return { ok: false, fehler: String(e && e.message ? e.message : e) };
    }
  });
  const pyErgebnisse = pythonLauf(alleFaelle);

  let fehlgeschlagen = 0;
  // Neben Treffer/Fehler wird mitgezaehlt, was die Faelle ueberhaupt
  // ausloesen. Ein Test, bei dem jede Partie sofort mit 0 Punkten endet,
  // wuerde zwar gruen leuchten, aber nichts pruefen — das soll man sehen.
  const proSpiel = new Map(
    spiele.map((s) => [s, { geprueft: 0, fehler: 0, maxScore: 0, mitPunkten: 0, maxDauer: 0 }])
  );

  for (let i = 0; i < alleFaelle.length; i++) {
    const fall = alleFaelle[i];
    const js = jsErgebnisse[i];
    const py = pyErgebnisse[i];
    const zaehler = proSpiel.get(fall.spiel);
    zaehler.geprueft++;

    if (!js.ok || !py.ok) {
      zaehler.fehler++;
      fehlgeschlagen++;
      if (zaehler.fehler <= 2) {
        console.log(`FEHLER  ${fall.spiel}  seed=${fall.seed}  ${fall.eingaben.length} Eingaben`);
        if (!js.ok) console.log(`  JS brach ab:     ${js.fehler}`);
        if (!py.ok) console.log(`  Python brach ab: ${py.fehler}`);
        console.log("");
      }
      continue;
    }

    const score = Number(js.wert.score) || 0;
    const dauer = Number(js.wert.ticks !== undefined ? js.wert.ticks : js.wert.moves) || 0;
    if (score > zaehler.maxScore) zaehler.maxScore = score;
    if (score > 0) zaehler.mitPunkten++;
    if (dauer > zaehler.maxDauer) zaehler.maxDauer = dauer;

    const abw = vergleichen(js.wert, py.wert);
    if (abw.length) {
      zaehler.fehler++;
      fehlgeschlagen++;
      // Nur die ersten beiden je Spiel ausfuehrlich — bei echtem Drift
      // sind sonst alle 30 gleich, und die Ausgabe wird unlesbar.
      if (zaehler.fehler <= 2) {
        console.log(`ABWEICHUNG  ${fall.spiel}  seed=${fall.seed}  ${fall.eingaben.length} Eingaben`);
        for (const a of abw) {
          console.log(`  ${a.feld.padEnd(12)}JS: ${JSON.stringify(a.js)}   Python: ${JSON.stringify(a.py)}`);
        }
        console.log(`  Fall wiederholen: node pruefe-engines.js ${fall.spiel}`);
        console.log("");
      }
    }
  }

  console.log("Ergebnis");
  console.log("--------");
  console.log("  Spiel      Faelle  Zustand        davon mit Punkten   hoechster Score   laengste Partie");
  for (const [spiel, z] of proSpiel) {
    const zustand = z.fehler === 0 ? "ok" : `${z.fehler} abweichend`;
    console.log(
      `  ${spiel.padEnd(10)} ${String(z.geprueft).padStart(4)}   ${zustand.padEnd(14)} ` +
      `${String(z.mitPunkten + "/" + z.geprueft).padStart(13)}   ${String(z.maxScore).padStart(15)}   ` +
      `${String(z.maxDauer).padStart(15)}`
    );
  }
  console.log("");
  console.log("  Die letzten drei Spalten sagen, ob die Faelle die Engines wirklich");
  console.log("  beschaeftigt haben. Stehen dort ueberall Nullen, prueft der Test nichts.");

  if (fehlgeschlagen) {
    console.log(`\n${fehlgeschlagen} von ${alleFaelle.length} Faellen weichen ab.`);
    console.log("Die Python- und die JS-Fassung rechnen nicht mehr gleich —");
    console.log("Bestenlisten sind damit unzuverlaessig, bis das behoben ist.");
    process.exit(1);
  }

  console.log(`\nAlle ${alleFaelle.length} Faelle stimmen ueberein.`);
}

main();
