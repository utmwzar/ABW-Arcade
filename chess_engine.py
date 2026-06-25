"""
Server-authoritative chess engine.

Unlike the arcade games there is no client engine and no replay: every move is
sent to the server, validated against the full rules here, and applied to the
stored game state. The client only renders what the server returns.

Board representation: 8x8 list of lists, row 0 = rank 8 (FEN order).
White pieces are uppercase ("PNBRQK"), black lowercase, empty = None.
Squares use algebraic names ("e4") at the API boundary.

State dict (JSON-serialisable):
{
  "board":   [[...8 cols...] x 8 rows],
  "turn":    "w" | "b",
  "castling": {"K": bool, "Q": bool, "k": bool, "q": bool},
  "ep":      "e3" | None,          # en-passant target square
  "halfmove": int,                  # for the 50-move rule
  "fullmove": int,
  "history": [ {"from","to","piece","capture","promo","flag","check"} ... ],
  "positions": { fen_key: count }   # for threefold repetition
}

Supported endings: checkmate, stalemate, 50-move rule, threefold repetition,
insufficient material. Resignation / draw agreement are handled by the caller.
"""

FILES = "abcdefgh"

START_BOARD = [
    ["r", "n", "b", "q", "k", "b", "n", "r"],
    ["p"] * 8,
    [None] * 8,
    [None] * 8,
    [None] * 8,
    [None] * 8,
    ["P"] * 8,
    ["R", "N", "B", "Q", "K", "B", "N", "R"],
]

KNIGHT_D = ((-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1))
KING_D = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
BISHOP_D = ((-1, -1), (-1, 1), (1, -1), (1, 1))
ROOK_D = ((-1, 0), (1, 0), (0, -1), (0, 1))


def sq_name(r, c):
    return FILES[c] + str(8 - r)


def sq_rc(name):
    return 8 - int(name[1]), FILES.index(name[0])


def initial_state():
    state = {
        "board": [row[:] for row in START_BOARD],
        "turn": "w",
        "castling": {"K": True, "Q": True, "k": True, "q": True},
        "ep": None,
        "halfmove": 0,
        "fullmove": 1,
        "history": [],
        "positions": {},
    }
    state["positions"][position_key(state)] = 1
    return state


def position_key(state):
    """FEN-like key (placement, turn, castling, ep) for repetition detection."""
    rows = []
    for r in range(8):
        row, empty = "", 0
        for c in range(8):
            p = state["board"][r][c]
            if p is None:
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += p
        if empty:
            row += str(empty)
        rows.append(row)
    cas = state["castling"]
    cas_s = "".join(k for k in "KQkq" if cas[k]) or "-"
    return "/".join(rows) + " " + state["turn"] + " " + cas_s + " " + (state["ep"] or "-")


def is_white(p):
    return p is not None and p.isupper()


def color_of(p):
    return "w" if p.isupper() else "b"


def find_king(board, color):
    k = "K" if color == "w" else "k"
    for r in range(8):
        for c in range(8):
            if board[r][c] == k:
                return r, c
    return None


def square_attacked(board, r, c, by):
    """Is (r, c) attacked by side `by` ('w'/'b')?"""
    # pawns
    if by == "w":
        for dc in (-1, 1):
            rr, cc = r + 1, c + dc
            if 0 <= rr < 8 and 0 <= cc < 8 and board[rr][cc] == "P":
                return True
    else:
        for dc in (-1, 1):
            rr, cc = r - 1, c + dc
            if 0 <= rr < 8 and 0 <= cc < 8 and board[rr][cc] == "p":
                return True
    # knights
    kn = "N" if by == "w" else "n"
    for dr, dc in KNIGHT_D:
        rr, cc = r + dr, c + dc
        if 0 <= rr < 8 and 0 <= cc < 8 and board[rr][cc] == kn:
            return True
    # king
    kg = "K" if by == "w" else "k"
    for dr, dc in KING_D:
        rr, cc = r + dr, c + dc
        if 0 <= rr < 8 and 0 <= cc < 8 and board[rr][cc] == kg:
            return True
    # sliders
    bi, ro, qu = ("B", "R", "Q") if by == "w" else ("b", "r", "q")
    for dr, dc in BISHOP_D:
        rr, cc = r + dr, c + dc
        while 0 <= rr < 8 and 0 <= cc < 8:
            p = board[rr][cc]
            if p is not None:
                if p == bi or p == qu:
                    return True
                break
            rr += dr
            cc += dc
    for dr, dc in ROOK_D:
        rr, cc = r + dr, c + dc
        while 0 <= rr < 8 and 0 <= cc < 8:
            p = board[rr][cc]
            if p is not None:
                if p == ro or p == qu:
                    return True
                break
            rr += dr
            cc += dc
    return False


def in_check(state, color=None):
    color = color or state["turn"]
    board = state["board"]
    kp = find_king(board, color)
    if kp is None:
        return False
    return square_attacked(board, kp[0], kp[1], "b" if color == "w" else "w")


def _pseudo_moves(state):
    """Pseudo-legal moves for the side to move (king safety filtered later).

    Yields (fr, fc, tr, tc, flag) — flag in: None, 'dbl', 'ep', 'OO', 'OOO',
    'promo' (promotion piece chosen by caller)."""
    board = state["board"]
    turn = state["turn"]
    white = turn == "w"
    ep = state["ep"]
    for r in range(8):
        for c in range(8):
            p = board[r][c]
            if p is None or color_of(p) != turn:
                continue
            u = p.upper()
            if u == "P":
                d = -1 if white else 1
                start_row = 6 if white else 1
                promo_row = 0 if white else 7
                rr = r + d
                if 0 <= rr < 8 and board[rr][c] is None:
                    yield (r, c, rr, c, "promo" if rr == promo_row else None)
                    if r == start_row and board[r + 2 * d][c] is None:
                        yield (r, c, r + 2 * d, c, "dbl")
                for dc in (-1, 1):
                    cc = c + dc
                    if not (0 <= cc < 8) or not (0 <= rr < 8):
                        continue
                    t = board[rr][cc]
                    if t is not None and color_of(t) != turn:
                        yield (r, c, rr, cc, "promo" if rr == promo_row else None)
                    elif ep is not None and (rr, cc) == sq_rc(ep):
                        yield (r, c, rr, cc, "ep")
            elif u == "N":
                for dr, dc in KNIGHT_D:
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < 8 and 0 <= cc < 8:
                        t = board[rr][cc]
                        if t is None or color_of(t) != turn:
                            yield (r, c, rr, cc, None)
            elif u == "K":
                for dr, dc in KING_D:
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < 8 and 0 <= cc < 8:
                        t = board[rr][cc]
                        if t is None or color_of(t) != turn:
                            yield (r, c, rr, cc, None)
                # castling
                cas = state["castling"]
                home = 7 if white else 0
                if r == home and c == 4:
                    enemy = "b" if white else "w"
                    if cas["K" if white else "k"]:
                        if (board[home][5] is None and board[home][6] is None
                                and board[home][7] == ("R" if white else "r")
                                and not square_attacked(board, home, 4, enemy)
                                and not square_attacked(board, home, 5, enemy)
                                and not square_attacked(board, home, 6, enemy)):
                            yield (r, c, home, 6, "OO")
                    if cas["Q" if white else "q"]:
                        if (board[home][1] is None and board[home][2] is None
                                and board[home][3] is None
                                and board[home][0] == ("R" if white else "r")
                                and not square_attacked(board, home, 4, enemy)
                                and not square_attacked(board, home, 3, enemy)
                                and not square_attacked(board, home, 2, enemy)):
                            yield (r, c, home, 2, "OOO")
            else:
                dirs = BISHOP_D if u == "B" else ROOK_D if u == "R" else BISHOP_D + ROOK_D
                for dr, dc in dirs:
                    rr, cc = r + dr, c + dc
                    while 0 <= rr < 8 and 0 <= cc < 8:
                        t = board[rr][cc]
                        if t is None:
                            yield (r, c, rr, cc, None)
                        else:
                            if color_of(t) != turn:
                                yield (r, c, rr, cc, None)
                            break
                        rr += dr
                        cc += dc


def _apply(state, mv, promo="Q"):
    """Apply (fr,fc,tr,tc,flag) to a DEEP-COPIED state and return it.

    `promo` is 'Q','R','B','N' (case-insensitive)."""
    fr, fc, tr, tc, flag = mv
    s = {
        "board": [row[:] for row in state["board"]],
        "turn": state["turn"],
        "castling": dict(state["castling"]),
        "ep": state["ep"],
        "halfmove": state["halfmove"],
        "fullmove": state["fullmove"],
        # history/positions handled by make_move; keep references out of hot path
    }
    board = s["board"]
    p = board[fr][fc]
    white = p.isupper()
    capture = board[tr][tc]

    board[fr][fc] = None
    if flag == "ep":
        cap_r = tr + (1 if white else -1)
        capture = board[cap_r][tc]
        board[cap_r][tc] = None
    if flag == "promo":
        pp = promo.upper() if promo else "Q"
        if pp not in ("Q", "R", "B", "N"):
            pp = "Q"
        board[tr][tc] = pp if white else pp.lower()
    else:
        board[tr][tc] = p
    if flag == "OO":
        board[tr][7] = None
        board[tr][5] = "R" if white else "r"
    elif flag == "OOO":
        board[tr][0] = None
        board[tr][3] = "R" if white else "r"

    # castling rights
    cas = s["castling"]
    if p == "K":
        cas["K"] = cas["Q"] = False
    elif p == "k":
        cas["k"] = cas["q"] = False
    if (fr, fc) == (7, 0) or (tr, tc) == (7, 0):
        cas["Q"] = False
    if (fr, fc) == (7, 7) or (tr, tc) == (7, 7):
        cas["K"] = False
    if (fr, fc) == (0, 0) or (tr, tc) == (0, 0):
        cas["q"] = False
    if (fr, fc) == (0, 7) or (tr, tc) == (0, 7):
        cas["k"] = False

    s["ep"] = sq_name(fr + ((tr - fr) // 2), fc) if flag == "dbl" else None
    s["halfmove"] = 0 if (p.upper() == "P" or capture is not None) else s["halfmove"] + 1
    if not white:
        s["fullmove"] += 1
    s["turn"] = "b" if white else "w"
    s["_capture"] = capture
    return s


def legal_moves(state):
    """All legal moves as a list of (fr,fc,tr,tc,flag)."""
    out = []
    me = state["turn"]
    for mv in _pseudo_moves(state):
        nxt = _apply(state, mv)
        if not in_check(nxt, me):
            out.append(mv)
    return out


def legal_moves_map(state):
    """{from_sq: [{"to": sq, "promo": bool}, ...]} for the side to move."""
    out = {}
    for fr, fc, tr, tc, flag in legal_moves(state):
        out.setdefault(sq_name(fr, fc), []).append(
            {"to": sq_name(tr, tc), "promo": flag == "promo"}
        )
    return out


def _insufficient_material(board):
    minors = []
    for r in range(8):
        for c in range(8):
            p = board[r][c]
            if p is None or p.upper() == "K":
                continue
            if p.upper() in ("Q", "R", "P"):
                return False
            minors.append((p, r, c))
    if len(minors) <= 1:
        return True  # K vs K, K+B vs K, K+N vs K
    if len(minors) == 2:
        (p1, r1, c1), (p2, r2, c2) = minors
        if p1.upper() == "B" and p2.upper() == "B" and color_of(p1) != color_of(p2):
            if (r1 + c1) % 2 == (r2 + c2) % 2:
                return True  # opposite kings, same-coloured bishops
    return False


def game_status(state):
    """('active', None) or ('finished', reason) with reason in:
    checkmate, stalemate, fifty_move, repetition, material."""
    if _insufficient_material(state["board"]):
        return "finished", "material"
    if state["halfmove"] >= 100:
        return "finished", "fifty_move"
    if state["positions"].get(position_key(state), 0) >= 3:
        return "finished", "repetition"
    if not legal_moves(state):
        return ("finished", "checkmate") if in_check(state) else ("finished", "stalemate")
    return "active", None


def make_move(state, frm, to, promo=None):
    """Validate + apply a move given as square names. Returns (new_state, info)
    or raises ValueError. info = {"flag", "capture", "check", "status", "reason",
    "winner"} — winner is the COLOR that delivered mate, else None."""
    try:
        fr, fc = sq_rc(frm)
        tr, tc = sq_rc(to)
    except (ValueError, IndexError, KeyError):
        raise ValueError("bad_square")

    chosen = None
    for mv in legal_moves(state):
        if (mv[0], mv[1], mv[2], mv[3]) == (fr, fc, tr, tc):
            chosen = mv
            break
    if chosen is None:
        raise ValueError("illegal_move")
    if chosen[4] == "promo":
        if not promo or str(promo).upper() not in ("Q", "R", "B", "N"):
            raise ValueError("promotion_required")

    mover = state["turn"]
    piece = state["board"][fr][fc]
    nxt = _apply(state, chosen, promo or "Q")
    capture = nxt.pop("_capture", None)

    nxt["history"] = state["history"] + [{
        "from": frm, "to": to, "piece": piece,
        "capture": capture, "promo": (promo.upper() if chosen[4] == "promo" else None),
        "flag": chosen[4], "check": in_check(nxt, nxt["turn"]),
    }]
    positions = dict(state["positions"])
    key = position_key(nxt)
    positions[key] = positions.get(key, 0) + 1
    nxt["positions"] = positions

    status, reason = game_status(nxt)
    winner = mover if (status == "finished" and reason == "checkmate") else None
    return nxt, {
        "flag": chosen[4], "capture": capture,
        "check": nxt["history"][-1]["check"],
        "status": status, "reason": reason, "winner": winner,
    }


def perft(state, depth):
    """Node count for engine validation against published reference numbers."""
    if depth == 0:
        return 1
    total = 0
    for mv in legal_moves(state):
        if mv[4] == "promo":
            for pp in ("Q", "R", "B", "N"):
                total += perft(_strip(_apply(state, mv, pp)), depth - 1)
        else:
            total += perft(_strip(_apply(state, mv)), depth - 1)
    return total


def _strip(s):
    s.pop("_capture", None)
    return s


def state_from_fen(fen):
    """Minimal FEN loader for tests."""
    parts = fen.split()
    rows = parts[0].split("/")
    board = []
    for row in rows:
        out = []
        for ch in row:
            if ch.isdigit():
                out.extend([None] * int(ch))
            else:
                out.append(ch)
        board.append(out)
    cas = parts[2] if len(parts) > 2 else "-"
    state = {
        "board": board,
        "turn": parts[1] if len(parts) > 1 else "w",
        "castling": {k: (k in cas) for k in "KQkq"},
        "ep": None if len(parts) < 4 or parts[3] == "-" else parts[3],
        "halfmove": int(parts[4]) if len(parts) > 4 else 0,
        "fullmove": int(parts[5]) if len(parts) > 5 else 1,
        "history": [],
        "positions": {},
    }
    state["positions"][position_key(state)] = 1
    return state
