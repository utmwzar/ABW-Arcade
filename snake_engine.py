"""
Python port of static/snake_engine.js — must produce bit-identical results so
the server can replay a recorded Snake game and compute the authoritative score.
"""

COLS, ROWS = 20, 20
DIRS = {"U": (0, -1), "D": (0, 1), "L": (-1, 0), "R": (1, 0)}
OPP = {"U": "D", "D": "U", "L": "R", "R": "L"}
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


class Engine:
    def __init__(self, seed, cols=COLS, rows=ROWS):
        self.cols, self.rows = cols, rows
        self.rng = _Rng(seed)
        cx, cy = cols // 2, rows // 2
        self.snake = [[cx, cy], [cx - 1, cy], [cx - 2, cy]]  # head first
        self.dir = "R"
        self.score = 0
        self.game_over = False
        self.won = False
        self.food = None
        self._spawn_food()

    def _occ(self):
        return {(c[0], c[1]) for c in self.snake}

    def _spawn_food(self):
        occ = self._occ()
        empty = self.cols * self.rows - len(occ)
        if empty <= 0:
            self.food = None
            self.game_over = True
            self.won = True
            return
        r = self.rng.next() % empty
        for y in range(self.rows):
            for x in range(self.cols):
                if (x, y) not in occ:
                    if r == 0:
                        self.food = [x, y]
                        return
                    r -= 1

    def tick(self, dirs):
        if self.game_over:
            return
        if dirs:
            for d in dirs:
                if d in DIRS and d != OPP[self.dir]:
                    self.dir = d
                    break
        h = self.snake[0]
        dv = DIRS[self.dir]
        nx, ny = h[0] + dv[0], h[1] + dv[1]
        if nx < 0 or nx >= self.cols or ny < 0 or ny >= self.rows:
            self.game_over = True
            return
        eating = self.food is not None and nx == self.food[0] and ny == self.food[1]
        occ = self._occ()
        if not eating:
            tail = self.snake[-1]
            occ.discard((tail[0], tail[1]))
        if (nx, ny) in occ:
            self.game_over = True
            return
        self.snake.insert(0, [nx, ny])
        if eating:
            self.score += 1
            self._spawn_food()
        else:
            self.snake.pop()


def simulate(seed, inputs, max_ticks=2_000_000):
    """Replay a recorded game. inputs: iterable of {"tick": int, "dir": str}."""
    e = Engine(seed)
    by_tick = {}
    last_tick = 0
    for it in inputs:
        try:
            t = int(it["tick"])
            d = it["dir"]
        except (KeyError, TypeError, ValueError):
            continue
        if d not in ACTIONS or t < 0:
            continue
        if t > last_tick:
            last_tick = t
        by_tick.setdefault(t, []).append(d)

    end_tick = last_tick + 2000
    tick = 0
    while not e.game_over and tick <= end_tick and tick <= max_ticks:
        e.tick(by_tick.get(tick))
        tick += 1

    return {"score": e.score, "length": len(e.snake),
            "gameOver": e.game_over, "won": e.won, "ticks": tick}
