#!/usr/bin/env python3
"""
Python-Seite der Gleichlauf-Pruefung.

Wird von pruefe-engines.js aufgerufen, nicht von Hand. Liest die Faelle als
JSON von stdin, schickt jeden durch die passende Python-Engine und schreibt
die Ergebnisse als JSON nach stdout.

Bewusst ein einziger Prozessstart fuer alle Faelle: Ein Interpreterstart je
Fall kostet mehr Zeit als das Nachrechnen selbst.

Eingabe:  [{"spiel": "snake", "seed": 123, "eingaben": [{"tick": 0, "dir": "U"}, ...]}, ...]
Ausgabe:  [{"ok": true, "wert": {...}} | {"ok": false, "fehler": "..."}, ...]
"""

import json
import sys
import traceback

import tetris_engine
import snake_engine
import breakout_engine
import g2048_engine
import gd_engine

ENGINES = {
    "tetris": tetris_engine,
    "snake": snake_engine,
    "breakout": breakout_engine,
    "g2048": g2048_engine,
    "gd": gd_engine,
}


def main() -> int:
    try:
        faelle = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Eingabe war kein gueltiges JSON: {e}", file=sys.stderr)
        return 1

    ergebnisse = []
    for fall in faelle:
        spiel = fall.get("spiel")
        modul = ENGINES.get(spiel)
        if modul is None:
            ergebnisse.append({"ok": False, "fehler": f"unbekanntes Spiel: {spiel!r}"})
            continue
        try:
            wert = modul.simulate(fall["seed"], fall["eingaben"])
            # Ein Abbruch waere hier ein Fehler der Engine, kein Testfehler —
            # deshalb wird er als solcher gemeldet statt das Skript zu killen.
            ergebnisse.append({"ok": True, "wert": wert})
        except Exception:
            ergebnisse.append({
                "ok": False,
                "fehler": traceback.format_exc(limit=3).strip().replace("\n", " | "),
            })

    json.dump(ergebnisse, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
