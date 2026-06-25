"""
Chess bot for the PvB mode. Builds on chess_engine (the single rule
authority): the bot only PICKS a move; applying it goes through
chess_engine.make_move like any player move.

Search: negamax with alpha-beta pruning and capture-first move ordering.
Evaluation: material + piece-square tables (centipawns, White-positive).

Levels:
  easy   — depth 1, large random noise: takes free pieces, misses tactics
  medium — depth 2, slight noise: avoids one-move blunders
  hard   — depth 3, no noise: small tactics, punishes mistakes
"""

import random

import chess_engine as ce

MATE = 100_000
INF = 10 ** 9

PIECE_VALUE = {"P": 100, "N": 320, "B": 330, "R": 500, "Q": 900, "K": 0}

# Piece-square tables for WHITE, indexed [row][col] with row 0 = rank 8
# (same orientation as the engine board). Black mirrors vertically (7 - row).
PST = {
    "P": (
        (0, 0, 0, 0, 0, 0, 0, 0),
        (50, 50, 50, 50, 50, 50, 50, 50),
        (10, 10, 20, 30, 30, 20, 10, 10),
        (5, 5, 10, 25, 25, 10, 5, 5),
        (0, 0, 0, 20, 20, 0, 0, 0),
        (5, -5, -10, 0, 0, -10, -5, 5),
        (5, 10, 10, -20, -20, 10, 10, 5),
        (0, 0, 0, 0, 0, 0, 0, 0),
    ),
    "N": (
        (-50, -40, -30, -30, -30, -30, -40, -50),
        (-40, -20, 0, 0, 0, 0, -20, -40),
        (-30, 0, 10, 15, 15, 10, 0, -30),
        (-30, 5, 15, 20, 20, 15, 5, -30),
        (-30, 0, 15, 20, 20, 15, 0, -30),
        (-30, 5, 10, 15, 15, 10, 5, -30),
        (-40, -20, 0, 5, 5, 0, -20, -40),
        (-50, -40, -30, -30, -30, -30, -40, -50),
    ),
    "B": (
        (-20, -10, -10, -10, -10, -10, -10, -20),
        (-10, 0, 0, 0, 0, 0, 0, -10),
        (-10, 0, 5, 10, 10, 5, 0, -10),
        (-10, 5, 5, 10, 10, 5, 5, -10),
        (-10, 0, 10, 10, 10, 10, 0, -10),
        (-10, 10, 10, 10, 10, 10, 10, -10),
        (-10, 5, 0, 0, 0, 0, 5, -10),
        (-20, -10, -10, -10, -10, -10, -10, -20),
    ),
    "R": (
        (0, 0, 0, 0, 0, 0, 0, 0),
        (5, 10, 10, 10, 10, 10, 10, 5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (0, 0, 0, 5, 5, 0, 0, 0),
    ),
    "Q": (
        (-20, -10, -10, -5, -5, -10, -10, -20),
        (-10, 0, 0, 0, 0, 0, 0, -10),
        (-10, 0, 5, 5, 5, 5, 0, -10),
        (-5, 0, 5, 5, 5, 5, 0, -5),
        (0, 0, 5, 5, 5, 5, 0, -5),
        (-10, 5, 5, 5, 5, 5, 0, -10),
        (-10, 0, 5, 0, 0, 0, 0, -10),
        (-20, -10, -10, -5, -5, -10, -10, -20),
    ),
    "K": (
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-20, -30, -30, -40, -40, -30, -30, -20),
        (-10, -20, -20, -20, -20, -20, -20, -10),
        (20, 20, 0, 0, 0, 0, 20, 20),
        (20, 30, 10, 0, 0, 10, 30, 20),
    ),
}

LEVELS = {
    # level: (search depth, noise in centipawns)
    "easy": (1, 160),
    "medium": (2, 25),
    "hard": (3, 0),
}


def _eval_white(board):
    """Material + PST, positive = good for White."""
    score = 0
    for r in range(8):
        for c in range(8):
            p = board[r][c]
            if p is None:
                continue
            u = p.upper()
            if p.isupper():
                score += PIECE_VALUE[u] + PST[u][r][c]
            else:
                score -= PIECE_VALUE[u] + PST[u][7 - r][c]
    return score


def _eval_side(state):
    e = _eval_white(state["board"])
    return e if state["turn"] == "w" else -e


def _ordered(state, moves):
    """Captures/promotions first, most valuable gain first (helps pruning)."""
    board = state["board"]

    def key(mv):
        gain = 0
        victim = board[mv[2]][mv[3]]
        if victim is not None:
            gain += PIECE_VALUE[victim.upper()]
        elif mv[4] == "ep":
            gain += 100
        if mv[4] == "promo":
            gain += 800
        return -gain

    return sorted(moves, key=key)


def _expand(mv):
    """Promotion moves branch into the realistic choices."""
    if mv[4] == "promo":
        return [(mv, "Q"), (mv, "N")]
    return [(mv, None)]


def _negamax(state, depth, alpha, beta, ply):
    moves = ce.legal_moves(state)
    if not moves:
        return -(MATE - ply) if ce.in_check(state) else 0
    if state["halfmove"] >= 100:
        return 0
    if depth == 0:
        return _eval_side(state)
    best = -INF
    for mv in _ordered(state, moves):
        for base, promo in _expand(mv):
            child = ce._strip(ce._apply(state, base, promo or "Q"))
            score = -_negamax(child, depth - 1, -beta, -alpha, ply + 1)
            if score > best:
                best = score
            if best > alpha:
                alpha = best
            if alpha >= beta:
                return best
    return best


def choose_move(state, level="medium"):
    """Pick a move for the side to move. Returns (from_sq, to_sq, promo|None)
    or None if there is no legal move."""
    depth, noise = LEVELS.get(level, LEVELS["medium"])
    moves = ce.legal_moves(state)
    if not moves:
        return None

    scored = []
    board = state["board"]
    for mv in _ordered(state, moves):
        for base, promo in _expand(mv):
            child = ce._strip(ce._apply(state, base, promo or "Q"))
            score = -_negamax(child, depth - 1, -INF, INF, 1)
            if noise:
                score += random.randint(-noise, noise)
            victim = board[base[2]][base[3]]
            immediate = PIECE_VALUE[victim.upper()] if victim else (100 if base[4] == "ep" else 0)
            if base[4] == "promo":
                immediate += PIECE_VALUE[(promo or "Q").upper()] - 100
            scored.append((score, immediate, base, promo))

    best = max(s for s, _, _, _ in scored)
    best_imm = max(i for s, i, _, _ in scored if s == best)
    top = [(mv, promo) for s, i, mv, promo in scored if s == best and i == best_imm]
    mv, promo = random.choice(top)
    return ce.sq_name(mv[0], mv[1]), ce.sq_name(mv[2], mv[3]), promo
