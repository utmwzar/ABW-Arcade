"""Zufallspartien aus chess_engine.py als JSON, für tests/js/chess-notation.test.mjs.

Jede Partie enthält die Zugliste, wie der Server sie sendet, und die Stellung
nach jedem Halbzug. Sonderzüge (Rochade, en passant, Umwandlung) werden
bevorzugt gespielt, damit jeder Fall sicher vorkommt.
"""

import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

import chess_engine as ce  # noqa: E402

SPECIAL = ("OO", "OOO", "ep", "promo")


def play(seed, max_plies=180):
    rnd = random.Random(seed)
    state = ce.initial_state()
    boards = []
    for _ in range(max_plies):
        moves = ce.legal_moves(state)
        if not moves:
            break
        special = [m for m in moves if m[4] in SPECIAL]
        mv = rnd.choice(special) if special and rnd.random() < 0.8 else rnd.choice(moves)
        promo = rnd.choice("QRBN") if mv[4] == "promo" else None
        state, info = ce.make_move(state, ce.sq_name(mv[0], mv[1]), ce.sq_name(mv[2], mv[3]), promo)
        boards.append(state["board"])
        if info["status"] == "finished":
            break
    return {"history": state["history"], "boards": boards}


if __name__ == "__main__":
    json.dump([play(seed) for seed in range(1, 31)], sys.stdout)
