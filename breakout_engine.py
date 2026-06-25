"""
Python port of static/breakout_engine.js — must produce bit-identical results
so the server can replay a recorded Breakout game and compute the authoritative
score. Integer-only physics, no floats.
"""

W, H = 440, 520
COLS, ROWS = 10, 5
MARGIN, TOP, BW, BH, GAP = 12, 50, 38, 18, 4
PADDLE_W, PADDLE_H, PADDLE_Y, PADDLE_SPEED = 72, 12, H - 34, 6
BALL_R, BALL_VY = 5, 3
START_LIVES = 3
MAX_TICKS = 500000
ACTIONS = ("L", "R", "S")

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
    def __init__(self, seed):
        self.w, self.h = W, H
        self.cols, self.rows = COLS, ROWS
        self.paddle_w, self.paddle_h, self.paddle_y = PADDLE_W, PADDLE_H, PADDLE_Y
        self.ball_r = BALL_R
        self.rng = _Rng(seed)

        self.bricks = []
        for r in range(ROWS):
            for c in range(COLS):
                self.bricks.append({
                    "x": MARGIN + c * (BW + GAP), "y": TOP + r * (BH + GAP),
                    "w": BW, "h": BH, "alive": True, "points": ROWS - r, "row": r,
                })
        self.alive_count = COLS * ROWS
        self.paddle_x = (W - PADDLE_W) >> 1
        self.paddle_dir = 0
        self.score = 0
        self.lives = START_LIVES
        self.bricks_broken = 0
        self.game_over = False
        self.won = False
        self._serve()

    def _serve(self):
        self.bx = self.paddle_x + (PADDLE_W >> 1)
        self.by = PADDLE_Y - BALL_R - 1
        s = 1 if (self.rng.next() & 1) else -1
        self.vx = 2 * s
        self.vy = -BALL_VY

    def tick(self, events):
        if self.game_over:
            return

        if events:
            for e in events:
                if e == "L":
                    self.paddle_dir = -1
                elif e == "R":
                    self.paddle_dir = 1
                elif e == "S":
                    self.paddle_dir = 0

        self.paddle_x += self.paddle_dir * PADDLE_SPEED
        if self.paddle_x < 0:
            self.paddle_x = 0
        if self.paddle_x > W - PADDLE_W:
            self.paddle_x = W - PADDLE_W

        self.bx += self.vx
        self.by += self.vy

        if self.bx - BALL_R < 0:
            self.bx = BALL_R
            self.vx = -self.vx
        if self.bx + BALL_R > W:
            self.bx = W - BALL_R
            self.vx = -self.vx
        if self.by - BALL_R < 0:
            self.by = BALL_R
            self.vy = -self.vy

        p_top = PADDLE_Y
        if (self.vy > 0 and self.by + BALL_R >= p_top and self.by - BALL_R <= p_top + PADDLE_H
                and self.bx + BALL_R >= self.paddle_x and self.bx - BALL_R <= self.paddle_x + PADDLE_W):
            self.by = p_top - BALL_R
            self.vy = -BALL_VY
            rel = self.bx - (self.paddle_x + (PADDLE_W >> 1))
            if rel < -25:
                self.vx = -3
            elif rel < -9:
                self.vx = -2
            elif rel <= 9:
                self.vx = 1 if self.vx >= 0 else -1
            elif rel <= 25:
                self.vx = 2
            else:
                self.vx = 3

        for b in self.bricks:
            if not b["alive"]:
                continue
            if (self.bx + BALL_R > b["x"] and self.bx - BALL_R < b["x"] + b["w"]
                    and self.by + BALL_R > b["y"] and self.by - BALL_R < b["y"] + b["h"]):
                b["alive"] = False
                self.alive_count -= 1
                self.bricks_broken += 1
                self.score += b["points"]
                prev_x = self.bx - self.vx
                prev_y = self.by - self.vy
                was_vert = (prev_y + BALL_R <= b["y"]) or (prev_y - BALL_R >= b["y"] + b["h"])
                was_horiz = (prev_x + BALL_R <= b["x"]) or (prev_x - BALL_R >= b["x"] + b["w"])
                if was_horiz and not was_vert:
                    self.vx = -self.vx
                else:
                    self.vy = -self.vy
                break

        if self.alive_count <= 0:
            self.game_over = True
            self.won = True
            return

        if self.by - BALL_R > H:
            self.lives -= 1
            if self.lives <= 0:
                self.game_over = True
                return
            self._serve()


def simulate(seed, inputs, max_ticks=MAX_TICKS):
    """Replay a recorded game. inputs: iterable of {"tick": int, "dir": str}."""
    e = Engine(seed)
    by_tick = {}
    for it in inputs:
        try:
            t = int(it["tick"])
            d = it["dir"]
        except (KeyError, TypeError, ValueError):
            continue
        if d not in ACTIONS or t < 0:
            continue
        by_tick.setdefault(t, []).append(d)

    tick = 0
    while not e.game_over and tick <= max_ticks:
        e.tick(by_tick.get(tick))
        tick += 1

    return {"score": e.score, "bricks": e.bricks_broken, "lives": e.lives,
            "gameOver": e.game_over, "won": e.won, "ticks": tick}
