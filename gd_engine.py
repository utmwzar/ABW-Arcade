"""
Python port of static/gd_engine.js — must produce bit-identical results so the
server can replay a recorded Geometry-Dash run and compute the authoritative
score (distance reached). Everything is INTEGER fixed-point: constant-speed
horizontal scroll, gravity as `vy -= G`, jump as `vy = JUMP`, AABB collisions.
No floats, no sqrt, no trig, no division in the simulation loop, so JS and
Python agree to the bit.

The only randomness is the seeded LEVEL layout (which obstacle, how big the gap)
— it does not depend on player input, so the level is identical on every replay.
The single button is recorded as toggle events { tick, dir }, dir in:
  D = press/hold down, U = release.
Per tick: apply queued button toggles, then: if held and on the ground -> jump;
apply gravity; move; resolve floor / block landing / lethal hits.
"""

# --- fixed-point world (1 cell = CELL units) ---------------------------------
CELL = 100            # size of one grid cell (and the cube) in fp units
SPEED = 14            # horizontal scroll, fp per tick (constant)
GRAVITY = 4           # downward accel, fp per tick^2
JUMP_V = 52           # upward velocity given by a jump, fp per tick
CUBE = CELL           # cube is 1x1 cell

# spike lethal box (smaller than a full cell, centred on the floor — fairer)
SPIKE_INSET = 22      # left/right inset inside the cell
SPIKE_H = 56          # height above the floor

START_RUNWAY = 8      # empty cells before the first obstacle
MIN_GAP = 5           # never fewer empty cells between obstacles (keeps it fair)

MAX_TICKS = 36000     # ~10 min safety cap; the run is otherwise endless
GEN_CELLS = (MAX_TICKS * SPEED) // CELL + 32   # pre-generate the whole track

ACTIONS = ("D", "U")

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


# obstacle kinds
SPIKE = 0
BLOCK = 1


def _build_level(seed):
    """Deterministic, always-clearable layout. Returns a list of obstacles, each
    a dict with: kind, x0, x1 (world fp span) and top (fp; spike lethal height or
    block surface height)."""
    rng = _Rng(seed)
    obs = []
    cell = START_RUNWAY
    while cell < GEN_CELLS:
        # gap shrinks with progress (easier start, denser later) but never < MIN_GAP
        extra = 6 - (cell * 6) // GEN_CELLS            # 6 -> 0
        gap = MIN_GAP + extra + (rng.next() % 3)
        cell += gap
        if cell >= GEN_CELLS:
            break

        pct = (cell * 100) // GEN_CELLS                # 0..100 difficulty
        roll = rng.next() % 100
        x0 = cell * CELL

        if roll < 45:
            # single spike
            obs.append({"kind": SPIKE, "x0": x0 + SPIKE_INSET,
                        "x1": x0 + CELL - SPIKE_INSET, "top": SPIKE_H})
            cell += 1
        elif roll < 60 + (pct // 5):
            # double spike (more common deeper in) — still one jump clears it
            obs.append({"kind": SPIKE, "x0": x0 + SPIKE_INSET,
                        "x1": x0 + 2 * CELL - SPIKE_INSET, "top": SPIKE_H})
            cell += 2
        elif roll < 85:
            # 1-high block: jump onto or over it
            obs.append({"kind": BLOCK, "x0": x0, "x1": x0 + CELL, "top": CELL})
            cell += 1
        else:
            # 2-high block (only really shows up later via difficulty mix)
            h = 2 if pct > 25 else 1
            obs.append({"kind": BLOCK, "x0": x0, "x1": x0 + CELL, "top": h * CELL})
            cell += 1
    return obs


class Engine:
    def __init__(self, seed):
        self.cell = CELL
        self.cube = CUBE
        self.speed = SPEED
        self.rng = _Rng(seed)            # kept for parity with the JS ctor order
        self.obstacles = _build_level(seed)

        self.tick_count = 0
        self.world_x = 0                 # cube left edge in world fp (grows each tick)
        self.y = 0                       # cube BOTTOM above the floor (up = +)
        self.vy = 0
        self.on_ground = True
        self.held = False
        self.cells = 0                   # distance travelled, in whole cells (= score)
        self.game_over = False
        self.won = False

    def tick(self, events):
        if self.game_over:
            return

        if events:
            for e in events:
                if e == "D":
                    self.held = True
                elif e == "U":
                    self.held = False

        # jump only from the ground
        if self.held and self.on_ground:
            self.vy = JUMP_V
            self.on_ground = False

        prev_bottom = self.y
        self.vy -= GRAVITY
        self.y += self.vy
        self.world_x += SPEED
        self.tick_count += 1

        cx0 = self.world_x
        cx1 = self.world_x + CUBE
        cyt = self.y + CUBE              # cube top

        support = 0                      # floor is always a surface at 0
        lethal = False
        for ob in self.obstacles:
            if ob["x1"] <= cx0 or ob["x0"] >= cx1:
                continue                 # no horizontal overlap
            top = ob["top"]
            if ob["kind"] == SPIKE:
                # lethal box [0, SPIKE_H]; die on any real overlap
                if self.y < top and cyt > 0:
                    lethal = True
            else:  # BLOCK occupies [0, top]
                if prev_bottom >= top:
                    # we are on/above this block -> it can support us
                    if top > support:
                        support = top
                elif self.y < top and cyt > 0:
                    # came from the side / below -> ran into the wall
                    lethal = True

        if lethal:
            self.game_over = True
            self._finalize()
            return

        # land on the highest valid surface when descending
        if self.vy <= 0 and self.y <= support:
            self.y = support
            self.vy = 0
            self.on_ground = True
        else:
            self.on_ground = (self.y == support)

        if self.world_x >= GEN_CELLS * CELL:
            self.game_over = True
            self.won = True

        self._finalize()

    def _finalize(self):
        c = self.world_x // CELL
        if c > self.cells:
            self.cells = c


def simulate(seed, inputs, max_ticks=MAX_TICKS):
    """Replay a recorded run. inputs: iterable of {"tick": int, "dir": str}."""
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

    return {"score": e.cells, "cells": e.cells, "ticks": tick,
            "gameOver": e.game_over, "won": e.won}
