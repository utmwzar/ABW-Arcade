"""
Python port of static/g2048_engine.js — must produce bit-identical results so
the server can replay a recorded 2048 game and compute the authoritative score.

2048 has exactly one source of randomness: which empty cell a new tile spawns
in, and whether it is a 2 (90%) or a 4 (10%). Both are driven by the same
seedable mulberry32 PRNG used by the other engines, consumed in a fixed order
(first the cell, then the value), so JS and Python evolve identically from the
same seed and the same move sequence.

Inputs are recorded as { tick, dir }, dir in:  U = up, D = down, L = left,
R = right.  A move that does not change the board is a no-op: it neither
advances the move counter nor consumes RNG (no tile spawns) — exactly as in
real 2048. The game ends when the board is full and no merge is possible.
"""

SIZE = 4
TARGET = 2048                # tile value that flips the "won" flag (play continues)
MAX_MOVES = 100_000          # safety bound on replay length
ACTIONS = ("U", "D", "L", "R")

_MASK = 0xFFFFFFFF


def _u32(x):
    return x & _MASK


def _i32(x):
    x &= _MASK
    return x - 0x100000000 if x & 0x80000000 else x


def _imul(a, b):
    return _i32((_i32(a) * _i32(b)) & _MASK)


def _ushr(x, n):
    return _u32(x) >> n


def _xor(x, y):
    return _i32(_i32(x) ^ _i32(y))


def _or(x, y):
    return _i32(_i32(x) | _i32(y))


class _Rng:
    """mulberry32 — identical 32-bit arithmetic to makeRng() in the JS engine."""

    def __init__(self, seed):
        self.a = _i32(seed)

    def next(self):
        a = _i32(self.a)
        a = _i32(a + 0x6D2B79F5)
        self.a = a
        t = _imul(_xor(a, _ushr(a, 15)), _or(1, a))
        t = _u32(_xor(_i32(t + _imul(_xor(t, _ushr(t, 7)), _or(61, t))), t))
        return _u32(_xor(t, _ushr(t, 14)))


# For each direction, the four "lanes" (lists of board indices, row-major i=r*4+c)
# ordered FROM the edge tiles slide toward. Compressing each lane toward its
# index 0 therefore performs the move for that direction.
def _lanes(direction):
    lanes = []
    if direction == "L":
        for r in range(SIZE):
            lanes.append([r * SIZE + c for c in range(SIZE)])
    elif direction == "R":
        for r in range(SIZE):
            lanes.append([r * SIZE + c for c in range(SIZE - 1, -1, -1)])
    elif direction == "U":
        for c in range(SIZE):
            lanes.append([r * SIZE + c for r in range(SIZE)])
    elif direction == "D":
        for c in range(SIZE):
            lanes.append([r * SIZE + c for r in range(SIZE - 1, -1, -1)])
    return lanes


_LANES = {d: _lanes(d) for d in ACTIONS}


def _compress(vals):
    """Slide+merge a 4-length lane toward index 0. Returns (out, gained, changed)."""
    tiles = [v for v in vals if v != 0]
    out = []
    gained = 0
    i = 0
    n = len(tiles)
    while i < n:
        if i + 1 < n and tiles[i] == tiles[i + 1]:
            merged = tiles[i] * 2
            out.append(merged)
            gained += merged
            i += 2
        else:
            out.append(tiles[i])
            i += 1
    while len(out) < SIZE:
        out.append(0)
    return out, gained, out != vals


class Engine:
    def __init__(self, seed):
        self.size = SIZE
        self.rng = _Rng(seed)
        self.board = [0] * (SIZE * SIZE)
        self.score = 0
        self.moves = 0
        self.highest = 0
        self.won = False
        self.game_over = False
        self.last_spawn = -1          # cell index of the most recent spawn (display only)
        self._spawn()
        self._spawn()
        self._update_status()

    def _spawn(self):
        empties = [i for i in range(SIZE * SIZE) if self.board[i] == 0]
        if not empties:
            self.last_spawn = -1
            return
        cell = empties[self.rng.next() % len(empties)]
        value = 4 if (self.rng.next() % 10) == 0 else 2
        self.board[cell] = value
        self.last_spawn = cell

    def _update_status(self):
        m = max(self.board)
        if m > self.highest:
            self.highest = m
        if m >= TARGET:
            self.won = True
        if 0 in self.board:
            self.game_over = False
            return
        # Board full: game over unless some neighbour pair is equal.
        movable = False
        for r in range(SIZE):
            for c in range(SIZE):
                v = self.board[r * SIZE + c]
                if c + 1 < SIZE and self.board[r * SIZE + c + 1] == v:
                    movable = True
                if r + 1 < SIZE and self.board[(r + 1) * SIZE + c] == v:
                    movable = True
        self.game_over = not movable

    def move(self, direction):
        if self.game_over or direction not in _LANES:
            return False
        work = self.board[:]
        changed = False
        gained = 0
        for lane in _LANES[direction]:
            out, g, ch = _compress([work[i] for i in lane])
            if ch:
                changed = True
            gained += g
            for k in range(SIZE):
                work[lane[k]] = out[k]
        if not changed:
            return False
        self.board = work
        self.score += gained
        self.moves += 1
        self._spawn()
        self._update_status()
        return True


def simulate(seed, inputs, max_moves=MAX_MOVES):
    """Replay a recorded game. inputs: iterable of {"tick": int, "dir": str}."""
    e = Engine(seed)
    count = 0
    for it in inputs:
        if e.game_over or count >= max_moves:
            break
        try:
            d = it["dir"]
        except (KeyError, TypeError):
            continue
        if d not in ACTIONS:
            continue
        e.move(d)
        count += 1
    return {
        "score": e.score,
        "highest": e.highest,
        "moves": e.moves,
        "won": e.won,
        "gameOver": e.game_over,
    }
