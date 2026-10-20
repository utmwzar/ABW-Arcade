// Nachspielen und Notation gegen die echte Engine (chess_engine.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { replay, notation, spoken, material, START } from "../../static/js/chess-notation.js";

// Unter Windows heißt der Starter meist "py": PYTHON=py node --test …
const python = process.env.PYTHON || "python3";
const games = JSON.parse(execFileSync(python, [fileURLToPath(new URL("./chess_fixture.py", import.meta.url))],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

test("Nachspielen trifft nach jedem Halbzug die Stellung der Engine", () => {
  const flags = new Set();
  for (const g of games) {
    const boards = replay(g.history);
    assert.equal(boards.length, g.history.length + 1);
    assert.deepEqual(boards[0], START);
    g.history.forEach((m, i) => {
      flags.add(m.flag);
      assert.deepEqual(boards[i + 1], g.boards[i], `Halbzug ${i + 1}: ${m.from}-${m.to} (${m.flag})`);
    });
  }
  for (const f of ["OO", "OOO", "ep", "promo"]) assert.ok(flags.has(f), `kein Zug mit ${f} geprüft`);
});

test("Notation mit deutschen Figurenbuchstaben", () => {
  const m = (o) => ({ capture: null, promo: null, flag: null, check: false, ...o });
  assert.equal(notation(m({ from: "g1", to: "f3", piece: "N" })), "Sg1–f3");
  assert.equal(notation(m({ from: "e4", to: "d5", piece: "P", capture: "p" })), "e4×d5");
  assert.equal(notation(m({ from: "e5", to: "d6", piece: "P", capture: "p", flag: "ep" })), "e5×d6 e. p.");
  assert.equal(notation(m({ from: "e1", to: "g1", piece: "K", flag: "OO", check: true })), "O-O+");
  assert.equal(notation(m({ from: "e8", to: "c8", piece: "k", flag: "OOO" })), "O-O-O");
  assert.equal(notation(m({ from: "e7", to: "e8", piece: "P", flag: "promo", promo: "Q", check: true })), "e7–e8=D+");
  assert.equal(notation(m({ from: "d1", to: "f7", piece: "Q", capture: "p", check: true }), { mate: true }), "Dd1×f7#");
  assert.equal(spoken(m({ from: "g1", to: "f3", piece: "N", check: true })), "Springer g1 nach f3, Schach");
});

test("geschlagene Figuren und Materialvorsprung", () => {
  const history = [
    { from: "e4", to: "d5", piece: "P", capture: "p", promo: null, flag: null, check: false },
    { from: "d8", to: "d5", piece: "q", capture: "P", promo: null, flag: null, check: false },
    { from: "b1", to: "c3", piece: "N", capture: null, promo: null, flag: null, check: false },
    { from: "d5", to: "d2", piece: "q", capture: "P", promo: null, flag: null, check: true },
    { from: "c1", to: "d2", piece: "B", capture: "q", promo: null, flag: null, check: false },
  ];
  const { captured, balance } = material(history);
  assert.deepEqual(captured.w, ["q", "p"]);
  assert.deepEqual(captured.b, ["P", "P"]);
  assert.equal(balance, 1 + 9 - 1 - 1);
});
