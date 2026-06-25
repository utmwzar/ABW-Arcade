"""
Python port of static/engine.js — must produce bit-identical results so the
server can replay a recorded game and compute the authoritative score.

The 32-bit integer arithmetic mirrors JavaScript's |0, >>>, ^, | and
Math.imul semantics exactly (verified by a cross-check against the JS engine).
"""

COLS, ROWS = 10, 20

SHAPES = {
    "I": [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    "O": [[2, 2], [2, 2]],
    "T": [[0, 3, 0], [3, 3, 3], [0, 0, 0]],
    "S": [[0, 4, 4], [4, 4, 0], [0, 0, 0]],
    "Z": [[5, 5, 0], [0, 5, 5], [0, 0, 0]],
    "J": [[6, 0, 0], [6, 6, 6], [0, 0, 0]],
    "L": [[0, 0, 7], [7, 7, 7], [0, 0, 0]],
}
TYPES = ["I", "O", "T", "S", "Z", "J", "L"]
LINE_SCORES = [0, 40, 100, 300, 1200]
KICKS = [0, -1, 1, -2, 2]
ACTIONS = ("L", "R", "ROT", "SOFT", "HARD")

_MASK = 0xFFFFFFFF


def _u32(x):
    return x & _MASK


def _i32(x):
    x &= _MASK
    return x - 0x100000000 if x & 0x80000000 else x


def _imul(a, b):
    """JS Math.imul: signed 32-bit multiply, low 32 bits."""
    return _i32((_i32(a) * _i32(b)) & _MASK)


def _ushr(x, n):
    """JS >>> : unsigned right shift on a 32-bit value."""
    return _u32(x) >> n


def _xor(x, y):
    return _i32(_i32(x) ^ _i32(y))


def _or(x, y):
    return _i32(_i32(x) | _i32(y))


def gravity_ticks(level):
    return max(2, 32 - (level - 1) * 3)


class _Rng:
    """mulberry32 returning unsigned 32-bit integers."""

    def __init__(self, seed):
        self.a = _i32(seed)

    def next(self):
        a = _i32(self.a)
        a = _i32(a + 0x6D2B79F5)
        self.a = a
        t = _imul(_xor(a, _ushr(a, 15)), _or(1, a))
        t = _u32(_xor(_i32(t + _imul(_xor(t, _ushr(t, 7)), _or(61, t))), t))
        return _u32(_xor(t, _ushr(t, 14)))


def _shape_matrix(t):
    return [row[:] for row in SHAPES[t]]


def _rotate_cw(m):
    n = len(m)
    out = [[0] * n for _ in range(n)]
    for y in range(n):
        for x in range(n):
            out[x][n - 1 - y] = m[y][x]
    return out


class Engine:
    def __init__(self, seed):
        self.seed = _u32(seed)
        self.rng = _Rng(self.seed)
        self.bag = []
        self.grid = [[0] * COLS for _ in range(ROWS)]
        self.score = 0
        self.lines = 0
        self.level = 1
        self.gravity_counter = 0
        self.game_over = False
        self.current = None
        self.next_type = None
        self._started = False

    def _draw_type(self):
        if not self.bag:
            self.bag = TYPES[:]
            for i in range(len(self.bag) - 1, 0, -1):
                j = self.rng.next() % (i + 1)
                self.bag[i], self.bag[j] = self.bag[j], self.bag[i]
        return self.bag.pop()

    def start(self):
        if self._started:
            return
        self._started = True
        self.next_type = self._draw_type()
        self._spawn()

    def _make_piece(self, t):
        matrix = _shape_matrix(t)
        return {"type": t, "matrix": matrix, "x": (COLS - len(matrix[0])) // 2, "y": 0}

    def _spawn(self):
        self.current = self._make_piece(self.next_type)
        self.next_type = self._draw_type()
        if self._collides(self.current):
            self.game_over = True

    def _collides(self, p):
        m = p["matrix"]
        for y in range(len(m)):
            for x in range(len(m[y])):
                if not m[y][x]:
                    continue
                bx, by = p["x"] + x, p["y"] + y
                if bx < 0 or bx >= COLS or by >= ROWS:
                    return True
                if by >= 0 and self.grid[by][bx]:
                    return True
        return False

    def _merge(self, p):
        m = p["matrix"]
        for y in range(len(m)):
            for x in range(len(m[y])):
                if m[y][x] and p["y"] + y >= 0:
                    self.grid[p["y"] + y][p["x"] + x] = m[y][x]

    def _clear_lines(self):
        cleared = 0
        y = ROWS - 1
        while y >= 0:
            if all(self.grid[y][x] for x in range(COLS)):
                del self.grid[y]
                self.grid.insert(0, [0] * COLS)
                cleared += 1
                y += 1
            y -= 1
        if cleared:
            self.score += LINE_SCORES[cleared] * self.level
            self.lines += cleared
            self.level = self.lines // 10 + 1

    def _lock(self):
        self._merge(self.current)
        self._clear_lines()
        self.gravity_counter = 0
        self._spawn()

    def apply_action(self, action):
        if self.game_over or self.current is None:
            return
        p = self.current
        if action == "L":
            p["x"] -= 1
            if self._collides(p):
                p["x"] += 1
        elif action == "R":
            p["x"] += 1
            if self._collides(p):
                p["x"] -= 1
        elif action == "ROT":
            prev_matrix, px = p["matrix"], p["x"]
            p["matrix"] = _rotate_cw(p["matrix"])
            ok = False
            for k in KICKS:
                p["x"] = px + k
                if not self._collides(p):
                    ok = True
                    break
            if not ok:
                p["matrix"], p["x"] = prev_matrix, px
        elif action == "SOFT":
            p["y"] += 1
            if self._collides(p):
                p["y"] -= 1
                self._lock()
            else:
                self.score += 1
                self.gravity_counter = 0
        elif action == "HARD":
            dist = 0
            while not self._collides(p):
                p["y"] += 1
                dist += 1
            p["y"] -= 1
            dist -= 1
            if dist > 0:
                self.score += dist * 2
            self._lock()

    def gravity_step(self):
        if self.game_over or self.current is None:
            return
        self.gravity_counter += 1
        if self.gravity_counter >= gravity_ticks(self.level):
            self.gravity_counter = 0
            p = self.current
            p["y"] += 1
            if self._collides(p):
                p["y"] -= 1
                self._lock()


def simulate(seed, inputs, max_ticks=5_000_000):
    """Replay a recorded game. inputs: iterable of {"tick": int, "action": str}."""
    e = Engine(seed)
    e.start()
    if e.game_over:
        return {"score": e.score, "lines": e.lines, "level": e.level,
                "gameOver": True, "ticks": 0}

    by_tick = {}
    last_tick = 0
    for it in inputs:
        try:
            t = int(it["tick"])
            a = it["action"]
        except (KeyError, TypeError, ValueError):
            continue
        if a not in ACTIONS or t < 0:
            continue
        if t > last_tick:
            last_tick = t
        by_tick.setdefault(t, []).append(a)

    end_tick = last_tick + 100000
    tick = 0
    while not e.game_over and tick <= end_tick and tick <= max_ticks:
        for a in by_tick.get(tick, ()):
            e.apply_action(a)
            if e.game_over:
                break
        if e.game_over:
            break
        e.gravity_step()
        tick += 1

    return {"score": e.score, "lines": e.lines, "level": e.level,
            "gameOver": e.game_over, "ticks": tick}
