"""
ABW Arcade — Spiele-Server
-----------------
Flask backend: account login (hashed passwords) and a leaderboard.

Scores are server-authoritative: the client never submits a score. Instead it
asks the server to /api/game/start (which issues a random seed + a single-use
game id), plays a fully deterministic game while recording every input, and on
game over posts seed-id + the input log to /api/game/finish. The server then
REPLAYS the identical game in engine.py and computes the score itself. Faking a
score therefore requires submitting an input log that genuinely reaches it.
"""

import os
import json
import sqlite3
import secrets
from functools import wraps

import click
from flask import (
    Flask, g, render_template, request, redirect, url_for,
    session, jsonify, flash, abort,
)
from werkzeug.security import generate_password_hash, check_password_hash

import engine
import snake_engine
import breakout_engine
import g2048_engine
import gd_engine
import chess_engine
import chess_bot

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "arcade.db")
SECRET_PATH = os.path.join(BASE_DIR, "secret_key")

# Replay limits (bound server work and payload size).
MAX_INPUTS = 100_000        # max recorded input events per game
MAX_TICK = 10_000_000       # max tick index allowed in the input log
MAX_STARTS_PER_HOUR = 200   # per-user rate limit on game starts

# --------------------------------------------------------------------------
# Game registry — the single source of truth for the launcher hub.
# Adding a new game later = add an entry here, a route + template, and (if it
# has a leaderboard) write its score rows with the matching `slug`.
#   status: "live"  -> playable, card links to `endpoint`
#           "soon"  -> placeholder card, not clickable
# --------------------------------------------------------------------------
GAMES = [
    {
        "slug": "tetris", "title": "Tetris", "endpoint": "tetris", "status": "live",
        "tagline": "Stapeln, Reihen leeren, nicht oben anstoßen.",
        "accent": "cyan", "glyph": "▚",
    },
    {
        "slug": "snake", "title": "Snake", "endpoint": "snake", "status": "live",
        "tagline": "Friss, wachse, beiß dich nicht selbst.",
        "accent": "green", "glyph": "⬤",
    },
    {
        "slug": "breakout", "title": "Breakout", "endpoint": "breakout", "status": "live",
        "tagline": "Durchbrich die Mauer, halt den Ball im Spiel.",
        "accent": "magenta", "glyph": "▬",
    },
    {
        "slug": "2048", "title": "2048", "endpoint": "game_2048", "status": "live",
        "tagline": "Schiebe, kombiniere, knack die 2048.",
        "accent": "orange", "glyph": "▢",
    },
    {
        "slug": "geometry-dash", "title": "Geometry Dash", "endpoint": "geometry_dash",
        "status": "live",
        "tagline": "Spring im Rhythmus, weiche Stacheln aus, komm weiter.",
        "accent": "blue", "glyph": "▲",
    },
    {
        "slug": "chess", "title": "Schach", "endpoint": "chess_lobby_page", "status": "live",
        "tagline": "Zwei Accounts, ein Brett. Mit Elo-Rangliste.",
        "accent": "gold", "glyph": "♞", "pvp": True,
    },
    {
        "slug": "doom", "title": "DOOM", "endpoint": "doom", "status": "live",
        "tagline": "Der 1993er-Klassiker, als WebAssembly im Browser.",
        "accent": "red", "glyph": "▓",
    },
]
LIVE_SLUGS = {g["slug"] for g in GAMES if g["status"] == "live"}

app = Flask(__name__)


# --------------------------------------------------------------------------
# Secret key (persisted to a file so sessions survive a restart)
# --------------------------------------------------------------------------
def load_or_create_secret() -> str:
    env = os.environ.get("TETRIS_SECRET_KEY")
    if env:
        return env
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    key = secrets.token_hex(32)
    with open(SECRET_PATH, "w", encoding="utf-8") as fh:
        fh.write(key)
    try:
        os.chmod(SECRET_PATH, 0o600)
    except OSError:
        pass
    return key


app.secret_key = load_or_create_secret()
# Lax blockt Cross-Site-POSTs auf die Cookie-basierten Spiel-APIs, ohne normale
# Navigation zu stören; HttpOnly hält das Session-Cookie von JS fern.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


@app.route("/healthz")
def healthz():
    """Unauthenticated liveness probe for monitoring (e.g. Uptime Kuma)."""
    try:
        get_db().execute("SELECT 1").fetchone()
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"ok": False}), 500


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS scores (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            game       TEXT NOT NULL DEFAULT 'tetris',
            score      INTEGER NOT NULL,
            lines      INTEGER NOT NULL DEFAULT 0,
            level      INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS games (
            id         TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            game       TEXT NOT NULL DEFAULT 'tetris',
            seed       INTEGER NOT NULL,
            status     TEXT NOT NULL DEFAULT 'open',   -- open | finished
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    # Migrations: bring older databases up to the current schema BEFORE creating
    # any index that references a freshly added column.
    cols = [r[1] for r in db.execute("PRAGMA table_info(scores)").fetchall()]
    if "game_id" not in cols:
        db.execute("ALTER TABLE scores ADD COLUMN game_id TEXT")
    if "game" not in cols:
        db.execute("ALTER TABLE scores ADD COLUMN game TEXT NOT NULL DEFAULT 'tetris'")
    ucols = [r[1] for r in db.execute("PRAGMA table_info(users)").fetchall()]
    if "is_admin" not in ucols:
        db.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    gcols = [r[1] for r in db.execute("PRAGMA table_info(games)").fetchall()]
    if gcols and "game" not in gcols:
        db.execute("ALTER TABLE games ADD COLUMN game TEXT NOT NULL DEFAULT 'tetris'")
    ccols = [r[1] for r in db.execute("PRAGMA table_info(chess_games)").fetchall()]
    if ccols and "bot_level" not in ccols:
        db.execute("ALTER TABLE chess_games ADD COLUMN bot_level TEXT")

    # Indexes last — now every referenced column is guaranteed to exist.
    db.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_scores_user  ON scores(user_id);
        CREATE INDEX IF NOT EXISTS idx_scores_board ON scores(game, score DESC);
        CREATE INDEX IF NOT EXISTS idx_games_user   ON games(user_id, created_at);

        CREATE TABLE IF NOT EXISTS chess_games (
            id         TEXT PRIMARY KEY,
            white_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
            black_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
            creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status     TEXT NOT NULL DEFAULT 'waiting',  -- waiting | active | finished
            state      TEXT NOT NULL,                    -- engine state as JSON
            result     TEXT,                             -- white | black | draw
            end_reason TEXT,                             -- checkmate|stalemate|resign|draw_agreed|fifty_move|repetition|material
            draw_offer TEXT,                             -- NULL | 'w' | 'b'
            bot_level  TEXT,                             -- NULL = PvP | easy|medium|hard
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_chess_status ON chess_games(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_chess_white  ON chess_games(white_id);
        CREATE INDEX IF NOT EXISTS idx_chess_black  ON chess_games(black_id);

        CREATE TABLE IF NOT EXISTS chess_ratings (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            rating  INTEGER NOT NULL DEFAULT 1000,
            wins    INTEGER NOT NULL DEFAULT 0,
            draws   INTEGER NOT NULL DEFAULT 0,
            losses  INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    db.commit()
    db.close()


# Initialise on import so it also runs under waitress / gunicorn.
init_db()


# --------------------------------------------------------------------------
# Auth utilities
# --------------------------------------------------------------------------
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return get_db().execute(
        "SELECT id, username, is_admin FROM users WHERE id = ?", (uid,)
    ).fetchone()


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return redirect(url_for("login", next=request.path))
        if not user["is_admin"]:
            flash("Kein Zugriff – Adminrechte erforderlich.", "error")
            return redirect(url_for("index"))
        g.admin_user = user
        return view(*args, **kwargs)
    return wrapped


# --------------------------------------------------------------------------
# CSRF protection for the admin forms (session token, checked on every POST)
# --------------------------------------------------------------------------
def csrf_token() -> str:
    tok = session.get("_csrf")
    if not tok:
        tok = secrets.token_hex(16)
        session["_csrf"] = tok
    return tok


app.jinja_env.globals["csrf_token"] = csrf_token


def check_csrf() -> None:
    sent = request.form.get("csrf_token", "")
    good = session.get("_csrf", "")
    if not good or not secrets.compare_digest(sent, good):
        abort(400)


def safe_next(raw):
    """Only allow same-site relative redirect targets."""
    if not raw or not raw.startswith("/") or raw.startswith("//"):
        return url_for("index")
    return raw


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    if session.get("user_id"):
        return render_template("hub.html", username=current_user()["username"],
                               is_admin=bool(current_user()["is_admin"]), games=GAMES)
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if session.get("user_id"):
        return redirect(url_for("index"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        password2 = request.form.get("password2") or ""

        error = None
        if not (3 <= len(username) <= 20):
            error = "Username muss 3–20 Zeichen haben."
        elif not username.replace("_", "").isalnum():
            error = "Username: nur Buchstaben, Zahlen und Unterstrich."
        elif len(password) < 6:
            error = "Passwort muss mindestens 6 Zeichen haben."
        elif password != password2:
            error = "Passwörter stimmen nicht überein."

        if error is None:
            db = get_db()
            if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
                error = "Username ist schon vergeben."
            else:
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
                row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
                session.clear()
                session["user_id"] = row["id"]
                csrf_token()  # set up the CSRF token once per session
                return redirect(url_for("index"))

        flash(error, "error")

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user_id"):
        return redirect(url_for("index"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = get_db().execute(
            "SELECT id, password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            csrf_token()  # set up the CSRF token once per session
            return redirect(safe_next(request.args.get("next")))

        flash("Falscher Username oder Passwort.", "error")

    return render_template("login.html")


@app.route("/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/games/tetris")
@login_required
def tetris():
    user = current_user()
    return render_template("game.html", username=user["username"],
                           is_admin=bool(user["is_admin"]))


@app.route("/game")
@login_required
def game():
    # Backward-compatible redirect to the new per-game URL.
    return redirect(url_for("tetris"))


@app.route("/games/snake")
@login_required
def snake():
    user = current_user()
    return render_template("snake.html", username=user["username"],
                           is_admin=bool(user["is_admin"]))


@app.route("/games/breakout")
@login_required
def breakout():
    user = current_user()
    return render_template("breakout.html", username=user["username"],
                           is_admin=bool(user["is_admin"]))


@app.route("/games/2048")
@login_required
def game_2048():
    user = current_user()
    return render_template("g2048.html", username=user["username"],
                           is_admin=bool(user["is_admin"]))


@app.route("/games/geometry-dash")
@login_required
def geometry_dash():
    user = current_user()
    return render_template("gd.html", username=user["username"],
                           is_admin=bool(user["is_admin"]))


@app.route("/games/doom")
@login_required
def doom():
    user = current_user()
    return render_template("doom.html", username=user["username"],
                           is_admin=bool(user["is_admin"]))


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.route("/api/leaderboard")
def api_leaderboard():
    db = get_db()
    game = request.args.get("game", "tetris")
    # Best run per user for this game (score + the lines/level of that run).
    rows = db.execute(
        """
        SELECT u.username AS username, s.score AS score,
               s.lines AS lines, s.level AS level
        FROM scores s
        JOIN users u ON u.id = s.user_id
        JOIN (SELECT user_id, MAX(score) AS mx FROM scores
              WHERE game = ? GROUP BY user_id) b
          ON b.user_id = s.user_id AND b.mx = s.score
        WHERE s.game = ?
        GROUP BY s.user_id
        ORDER BY s.score DESC, s.created_at ASC
        LIMIT 10
        """,
        (game, game),
    ).fetchall()
    leaderboard = [dict(r) for r in rows]

    me = None
    uid = session.get("user_id")
    if uid:
        u = db.execute("SELECT username FROM users WHERE id = ?", (uid,)).fetchone()
        best = db.execute(
            "SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND game = ?",
            (uid, game),
        ).fetchone()["best"] or 0
        rank = None
        if best > 0:
            rank = db.execute(
                """
                SELECT COUNT(*) + 1 AS rank FROM
                  (SELECT user_id, MAX(score) AS mx FROM scores
                   WHERE game = ? GROUP BY user_id)
                WHERE mx > ?
                """,
                (game, best),
            ).fetchone()["rank"]
        me = {"username": u["username"] if u else None, "best": best, "rank": rank}

    return jsonify({"leaderboard": leaderboard, "me": me})


# --------------------------------------------------------------------------
# Game lifecycle — server-authoritative scoring via replay
# --------------------------------------------------------------------------
@app.route("/api/game/start", methods=["POST"])
def api_game_start():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    db = get_db()
    recent = db.execute(
        "SELECT COUNT(*) AS c FROM games "
        "WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
        (uid,),
    ).fetchone()["c"]
    if recent >= MAX_STARTS_PER_HOUR:
        return jsonify({"error": "rate_limited"}), 429

    game_id = secrets.token_urlsafe(16)
    seed = secrets.randbits(32)
    db.execute(
        "INSERT INTO games (id, user_id, game, seed, status) VALUES (?, ?, 'tetris', ?, 'open')",
        (game_id, uid, seed),
    )
    db.commit()
    return jsonify({"game_id": game_id, "seed": seed})


@app.route("/api/game/finish", methods=["POST"])
def api_game_finish():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    data = request.get_json(silent=True) or {}
    game_id = data.get("game_id")
    inputs = data.get("inputs")
    if not isinstance(game_id, str) or not isinstance(inputs, list):
        return jsonify({"error": "invalid_payload"}), 400
    if len(inputs) > MAX_INPUTS:
        return jsonify({"error": "too_many_inputs"}), 400

    # Validate the input log fully before spending time on a replay.
    clean = []
    for it in inputs:
        if not isinstance(it, dict):
            return jsonify({"error": "invalid_input"}), 400
        action = it.get("action")
        tick = it.get("tick")
        if action not in engine.ACTIONS:
            return jsonify({"error": "invalid_input"}), 400
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0 or tick > MAX_TICK:
            return jsonify({"error": "invalid_input"}), 400
        clean.append({"tick": tick, "action": action})

    db = get_db()
    game = db.execute(
        "SELECT user_id, seed, status FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    if game["user_id"] != uid:
        return jsonify({"error": "forbidden"}), 403
    if game["status"] != "open":
        return jsonify({"error": "already_finished"}), 409

    # The server replays the deterministic game and trusts only its own result.
    result = engine.simulate(game["seed"], clean)
    score, lines, level = int(result["score"]), int(result["lines"]), int(result["level"])

    db.execute("UPDATE games SET status = 'finished' WHERE id = ?", (game_id,))
    db.execute(
        "INSERT INTO scores (user_id, game, score, lines, level, game_id) "
        "VALUES (?, 'tetris', ?, ?, ?, ?)",
        (uid, score, lines, level, game_id),
    )
    db.commit()
    return jsonify({
        "ok": True,
        "score": score,
        "lines": lines,
        "level": level,
        "game_over": bool(result["gameOver"]),
    })


# --------------------------------------------------------------------------
# Snake — same server-authoritative replay model as Tetris
# --------------------------------------------------------------------------
@app.route("/api/snake/start", methods=["POST"])
def api_snake_start():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    db = get_db()
    recent = db.execute(
        "SELECT COUNT(*) AS c FROM games "
        "WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
        (uid,),
    ).fetchone()["c"]
    if recent >= MAX_STARTS_PER_HOUR:
        return jsonify({"error": "rate_limited"}), 429

    game_id = secrets.token_urlsafe(16)
    seed = secrets.randbits(32)
    db.execute(
        "INSERT INTO games (id, user_id, game, seed, status) VALUES (?, ?, 'snake', ?, 'open')",
        (game_id, uid, seed),
    )
    db.commit()
    return jsonify({"game_id": game_id, "seed": seed})


@app.route("/api/snake/finish", methods=["POST"])
def api_snake_finish():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    data = request.get_json(silent=True) or {}
    game_id = data.get("game_id")
    inputs = data.get("inputs")
    if not isinstance(game_id, str) or not isinstance(inputs, list):
        return jsonify({"error": "invalid_payload"}), 400
    if len(inputs) > MAX_INPUTS:
        return jsonify({"error": "too_many_inputs"}), 400

    clean = []
    for it in inputs:
        if not isinstance(it, dict):
            return jsonify({"error": "invalid_input"}), 400
        d = it.get("dir")
        tick = it.get("tick")
        if d not in snake_engine.ACTIONS:
            return jsonify({"error": "invalid_input"}), 400
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0 or tick > MAX_TICK:
            return jsonify({"error": "invalid_input"}), 400
        clean.append({"tick": tick, "dir": d})

    db = get_db()
    game = db.execute(
        "SELECT user_id, game, seed, status FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    if game["user_id"] != uid:
        return jsonify({"error": "forbidden"}), 403
    if game["game"] != "snake":
        return jsonify({"error": "wrong_game"}), 409
    if game["status"] != "open":
        return jsonify({"error": "already_finished"}), 409

    # The server replays the deterministic game and trusts only its own result.
    result = snake_engine.simulate(game["seed"], clean)
    score = int(result["score"])
    length = int(result["length"])

    db.execute("UPDATE games SET status = 'finished' WHERE id = ?", (game_id,))
    db.execute(
        "INSERT INTO scores (user_id, game, score, lines, level, game_id) "
        "VALUES (?, 'snake', ?, ?, 1, ?)",
        (uid, score, length, game_id),
    )
    db.commit()
    return jsonify({
        "ok": True,
        "score": score,
        "length": length,
        "won": bool(result["won"]),
        "game_over": bool(result["gameOver"]),
    })


# --------------------------------------------------------------------------
# Breakout — same server-authoritative replay model
# --------------------------------------------------------------------------
@app.route("/api/breakout/start", methods=["POST"])
def api_breakout_start():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    db = get_db()
    recent = db.execute(
        "SELECT COUNT(*) AS c FROM games "
        "WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
        (uid,),
    ).fetchone()["c"]
    if recent >= MAX_STARTS_PER_HOUR:
        return jsonify({"error": "rate_limited"}), 429

    game_id = secrets.token_urlsafe(16)
    seed = secrets.randbits(32)
    db.execute(
        "INSERT INTO games (id, user_id, game, seed, status) VALUES (?, ?, 'breakout', ?, 'open')",
        (game_id, uid, seed),
    )
    db.commit()
    return jsonify({"game_id": game_id, "seed": seed})


@app.route("/api/breakout/finish", methods=["POST"])
def api_breakout_finish():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    data = request.get_json(silent=True) or {}
    game_id = data.get("game_id")
    inputs = data.get("inputs")
    if not isinstance(game_id, str) or not isinstance(inputs, list):
        return jsonify({"error": "invalid_payload"}), 400
    if len(inputs) > MAX_INPUTS:
        return jsonify({"error": "too_many_inputs"}), 400

    clean = []
    for it in inputs:
        if not isinstance(it, dict):
            return jsonify({"error": "invalid_input"}), 400
        d = it.get("dir")
        tick = it.get("tick")
        if d not in breakout_engine.ACTIONS:
            return jsonify({"error": "invalid_input"}), 400
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0 or tick > MAX_TICK:
            return jsonify({"error": "invalid_input"}), 400
        clean.append({"tick": tick, "dir": d})

    db = get_db()
    game = db.execute(
        "SELECT user_id, game, seed, status FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    if game["user_id"] != uid:
        return jsonify({"error": "forbidden"}), 403
    if game["game"] != "breakout":
        return jsonify({"error": "wrong_game"}), 409
    if game["status"] != "open":
        return jsonify({"error": "already_finished"}), 409

    # The server replays the deterministic game and trusts only its own result.
    result = breakout_engine.simulate(game["seed"], clean)
    score = int(result["score"])
    bricks = int(result["bricks"])

    db.execute("UPDATE games SET status = 'finished' WHERE id = ?", (game_id,))
    db.execute(
        "INSERT INTO scores (user_id, game, score, lines, level, game_id) "
        "VALUES (?, 'breakout', ?, ?, 1, ?)",
        (uid, score, bricks, game_id),
    )
    db.commit()
    return jsonify({
        "ok": True,
        "score": score,
        "bricks": bricks,
        "won": bool(result["won"]),
        "game_over": bool(result["gameOver"]),
    })


# --------------------------------------------------------------------------
# 2048 — same server-authoritative replay model. The client records every
# board-changing swipe as { tick, dir }; the server replays them through the
# identical engine and trusts only its own score. `lines` stores the highest
# tile reached, `level` is unused (1).
# --------------------------------------------------------------------------
@app.route("/api/2048/start", methods=["POST"])
def api_g2048_start():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    db = get_db()
    recent = db.execute(
        "SELECT COUNT(*) AS c FROM games "
        "WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
        (uid,),
    ).fetchone()["c"]
    if recent >= MAX_STARTS_PER_HOUR:
        return jsonify({"error": "rate_limited"}), 429

    game_id = secrets.token_urlsafe(16)
    seed = secrets.randbits(32)
    db.execute(
        "INSERT INTO games (id, user_id, game, seed, status) VALUES (?, ?, '2048', ?, 'open')",
        (game_id, uid, seed),
    )
    db.commit()
    return jsonify({"game_id": game_id, "seed": seed})


@app.route("/api/2048/finish", methods=["POST"])
def api_g2048_finish():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    data = request.get_json(silent=True) or {}
    game_id = data.get("game_id")
    inputs = data.get("inputs")
    if not isinstance(game_id, str) or not isinstance(inputs, list):
        return jsonify({"error": "invalid_payload"}), 400
    if len(inputs) > MAX_INPUTS:
        return jsonify({"error": "too_many_inputs"}), 400

    clean = []
    for it in inputs:
        if not isinstance(it, dict):
            return jsonify({"error": "invalid_input"}), 400
        d = it.get("dir")
        tick = it.get("tick")
        if d not in g2048_engine.ACTIONS:
            return jsonify({"error": "invalid_input"}), 400
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0 or tick > MAX_TICK:
            return jsonify({"error": "invalid_input"}), 400
        clean.append({"tick": tick, "dir": d})

    db = get_db()
    game = db.execute(
        "SELECT user_id, game, seed, status FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    if game["user_id"] != uid:
        return jsonify({"error": "forbidden"}), 403
    if game["game"] != "2048":
        return jsonify({"error": "wrong_game"}), 409
    if game["status"] != "open":
        return jsonify({"error": "already_finished"}), 409

    # The server replays the deterministic game and trusts only its own result.
    result = g2048_engine.simulate(game["seed"], clean)
    score = int(result["score"])
    highest = int(result["highest"])

    db.execute("UPDATE games SET status = 'finished' WHERE id = ?", (game_id,))
    db.execute(
        "INSERT INTO scores (user_id, game, score, lines, level, game_id) "
        "VALUES (?, '2048', ?, ?, 1, ?)",
        (uid, score, highest, game_id),
    )
    db.commit()
    return jsonify({
        "ok": True,
        "score": score,
        "highest": highest,
        "won": bool(result["won"]),
        "game_over": bool(result["gameOver"]),
    })


# --------------------------------------------------------------------------
# Geometry Dash — same server-authoritative replay model. The level is a pure
# function of the seed (no player-dependent randomness), and the single jump
# button is recorded as { tick, dir } toggles (D = press, U = release). The
# server replays them through the identical integer-physics engine and trusts
# only its own result. `score` is the distance reached, in whole cells;
# `lines`/`level` are unused (0 / 1).
# --------------------------------------------------------------------------
@app.route("/api/geometry-dash/start", methods=["POST"])
def api_gd_start():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    db = get_db()
    recent = db.execute(
        "SELECT COUNT(*) AS c FROM games "
        "WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
        (uid,),
    ).fetchone()["c"]
    if recent >= MAX_STARTS_PER_HOUR:
        return jsonify({"error": "rate_limited"}), 429

    game_id = secrets.token_urlsafe(16)
    seed = secrets.randbits(32)
    db.execute(
        "INSERT INTO games (id, user_id, game, seed, status) "
        "VALUES (?, ?, 'geometry-dash', ?, 'open')",
        (game_id, uid, seed),
    )
    db.commit()
    return jsonify({"game_id": game_id, "seed": seed})


@app.route("/api/geometry-dash/finish", methods=["POST"])
def api_gd_finish():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401

    data = request.get_json(silent=True) or {}
    game_id = data.get("game_id")
    inputs = data.get("inputs")
    if not isinstance(game_id, str) or not isinstance(inputs, list):
        return jsonify({"error": "invalid_payload"}), 400
    if len(inputs) > MAX_INPUTS:
        return jsonify({"error": "too_many_inputs"}), 400

    clean = []
    for it in inputs:
        if not isinstance(it, dict):
            return jsonify({"error": "invalid_input"}), 400
        d = it.get("dir")
        tick = it.get("tick")
        if d not in gd_engine.ACTIONS:
            return jsonify({"error": "invalid_input"}), 400
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0 or tick > MAX_TICK:
            return jsonify({"error": "invalid_input"}), 400
        clean.append({"tick": tick, "dir": d})

    db = get_db()
    game = db.execute(
        "SELECT user_id, game, seed, status FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    if game["user_id"] != uid:
        return jsonify({"error": "forbidden"}), 403
    if game["game"] != "geometry-dash":
        return jsonify({"error": "wrong_game"}), 409
    if game["status"] != "open":
        return jsonify({"error": "already_finished"}), 409

    # The server replays the deterministic run and trusts only its own result.
    result = gd_engine.simulate(game["seed"], clean)
    score = int(result["score"])

    db.execute("UPDATE games SET status = 'finished' WHERE id = ?", (game_id,))
    db.execute(
        "INSERT INTO scores (user_id, game, score, lines, level, game_id) "
        "VALUES (?, 'geometry-dash', ?, 0, 1, ?)",
        (uid, score, game_id),
    )
    db.commit()
    return jsonify({
        "ok": True,
        "score": score,
        "won": bool(result["won"]),
        "game_over": bool(result["gameOver"]),
    })


# --------------------------------------------------------------------------
# Chess — player vs player. No replay: the server validates and applies every
# single move with chess_engine, so the stored state is the only authority.
# --------------------------------------------------------------------------
ELO_K = 32
ELO_START = 1000


def _chess_rating_row(db, uid):
    row = db.execute("SELECT * FROM chess_ratings WHERE user_id = ?", (uid,)).fetchone()
    if row is None:
        db.execute("INSERT INTO chess_ratings (user_id, rating) VALUES (?, ?)",
                   (uid, ELO_START))
        row = db.execute("SELECT * FROM chess_ratings WHERE user_id = ?", (uid,)).fetchone()
    return row


def _chess_apply_result(db, game, result):
    """result: 'white' | 'black' | 'draw' — updates Elo + W/D/L for both."""
    w = _chess_rating_row(db, game["white_id"])
    b = _chess_rating_row(db, game["black_id"])
    sw = 1.0 if result == "white" else 0.0 if result == "black" else 0.5
    expected_w = 1.0 / (1.0 + 10 ** ((b["rating"] - w["rating"]) / 400.0))
    delta = ELO_K * (sw - expected_w)
    new_w = round(w["rating"] + delta)
    new_b = round(b["rating"] - delta)
    db.execute(
        "UPDATE chess_ratings SET rating = ?, wins = wins + ?, draws = draws + ?, "
        "losses = losses + ? WHERE user_id = ?",
        (new_w, 1 if result == "white" else 0, 1 if result == "draw" else 0,
         1 if result == "black" else 0, game["white_id"]),
    )
    db.execute(
        "UPDATE chess_ratings SET rating = ?, wins = wins + ?, draws = draws + ?, "
        "losses = losses + ? WHERE user_id = ?",
        (new_b, 1 if result == "black" else 0, 1 if result == "draw" else 0,
         1 if result == "white" else 0, game["black_id"]),
    )


def _chess_game(db, game_id):
    return db.execute("SELECT * FROM chess_games WHERE id = ?", (game_id,)).fetchone()


def _chess_color_of(game, uid):
    if game["white_id"] == uid:
        return "w"
    if game["black_id"] == uid:
        return "b"
    return None


BOT_LEVELS = ("easy", "medium", "hard")
BOT_NAME_DE = {"easy": "Bot · leicht", "medium": "Bot · mittel", "hard": "Bot · schwer"}
MAX_ACTIVE_BOT_GAMES = 3


def _bot_name(level):
    return BOT_NAME_DE.get(level, "Bot")


def _bot_color(game):
    return "w" if game["white_id"] is None else "b"


def _bot_move_if_due(db, game_id):
    """If it's the bot's turn in an active bot game: pick + apply its move."""
    game = _chess_game(db, game_id)
    if game is None or game["status"] != "active" or not game["bot_level"]:
        return
    state = json.loads(game["state"])
    if state["turn"] != _bot_color(game):
        return
    mv = chess_bot.choose_move(state, game["bot_level"])
    if mv is None:
        return
    new_state, info = chess_engine.make_move(state, mv[0], mv[1], mv[2])
    db.execute(
        "UPDATE chess_games SET state = ?, updated_at = datetime('now') WHERE id = ?",
        (json.dumps(new_state), game_id),
    )
    if info["status"] == "finished":
        if info["reason"] == "checkmate":
            result = "white" if info["winner"] == "w" else "black"
        else:
            result = "draw"
        _chess_finish(db, game_id, result, info["reason"])


def _chess_finish(db, game_id, result, reason):
    db.execute(
        "UPDATE chess_games SET status = 'finished', result = ?, end_reason = ?, "
        "draw_offer = NULL, updated_at = datetime('now') WHERE id = ?",
        (result, reason, game_id),
    )
    game = _chess_game(db, game_id)
    # Bot games are unrated: no Elo, no W/D/L bookkeeping.
    if not game["bot_level"]:
        _chess_apply_result(db, game, result)


def _chess_state_payload(db, game, uid):
    state = json.loads(game["state"])
    you = _chess_color_of(game, uid)
    names = {}
    for col, key in (("white_id", "white"), ("black_id", "black")):
        if game[col]:
            u = db.execute("SELECT username FROM users WHERE id = ?", (game[col],)).fetchone()
            r = _chess_rating_row(db, game[col])
            names[key] = {"name": u["username"] if u else "?", "rating": r["rating"]}
        elif game["bot_level"]:
            names[key] = {"name": _bot_name(game["bot_level"]), "rating": None, "bot": True}
        else:
            names[key] = None
    payload = {
        "game_id": game["id"],
        "status": game["status"],
        "bot_level": game["bot_level"],
        "white": names["white"],
        "black": names["black"],
        "you": you,
        "turn": state["turn"],
        "board": state["board"],
        "history": [
            {k: h.get(k) for k in ("from", "to", "piece", "capture", "promo", "flag", "check")}
            for h in state["history"]
        ],
        "in_check": chess_engine.in_check(state),
        "result": game["result"],
        "end_reason": game["end_reason"],
        "draw_offer": game["draw_offer"],
        "updated_at": game["updated_at"],
    }
    if game["status"] == "active" and you == state["turn"]:
        payload["legal"] = chess_engine.legal_moves_map(state)
    return payload


@app.route("/games/chess")
@login_required
def chess_lobby_page():
    user = current_user()
    return render_template("chess_lobby.html", username=user["username"],
                           is_admin=bool(user["is_admin"]))


@app.route("/games/chess/<game_id>")
@login_required
def chess_game_page(game_id):
    user = current_user()
    game = _chess_game(get_db(), game_id)
    if game is None or _chess_color_of(game, user["id"]) is None:
        flash("Partie nicht gefunden oder du bist kein Teilnehmer.", "error")
        return redirect(url_for("chess_lobby_page"))
    return render_template("chess_game.html", username=user["username"],
                           is_admin=bool(user["is_admin"]), game_id=game_id)


@app.route("/api/chess/create", methods=["POST"])
def api_chess_create():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    db = get_db()
    data = request.get_json(silent=True) or {}

    if data.get("mode") == "bot":
        level = data.get("level")
        if level not in BOT_LEVELS:
            return jsonify({"error": "invalid_level"}), 400
        color = data.get("color", "random")
        if color not in ("w", "b", "random"):
            return jsonify({"error": "invalid_color"}), 400
        active_bots = db.execute(
            "SELECT COUNT(*) AS c FROM chess_games WHERE status = 'active' "
            "AND bot_level IS NOT NULL AND (white_id = ? OR black_id = ?)",
            (uid, uid),
        ).fetchone()["c"]
        if active_bots >= MAX_ACTIVE_BOT_GAMES:
            return jsonify({"error": "too_many_bot_games"}), 409

        as_white = bool(secrets.randbits(1)) if color == "random" else (color == "w")
        game_id = secrets.token_urlsafe(12)
        db.execute(
            "INSERT INTO chess_games (id, white_id, black_id, creator_id, status, "
            "state, bot_level) VALUES (?, ?, ?, ?, 'active', ?, ?)",
            (game_id, uid if as_white else None, None if as_white else uid, uid,
             json.dumps(chess_engine.initial_state()), level),
        )
        # If the bot has White it opens immediately.
        _bot_move_if_due(db, game_id)
        db.commit()
        return jsonify({"ok": True, "game_id": game_id})

    open_count = db.execute(
        "SELECT COUNT(*) AS c FROM chess_games WHERE creator_id = ? AND status = 'waiting'",
        (uid,),
    ).fetchone()["c"]
    if open_count >= 1:
        return jsonify({"error": "already_waiting"}), 409

    game_id = secrets.token_urlsafe(12)
    as_white = bool(secrets.randbits(1))
    db.execute(
        "INSERT INTO chess_games (id, white_id, black_id, creator_id, status, state) "
        "VALUES (?, ?, ?, ?, 'waiting', ?)",
        (game_id, uid if as_white else None, None if as_white else uid, uid,
         json.dumps(chess_engine.initial_state())),
    )
    db.commit()
    return jsonify({"ok": True, "game_id": game_id})


@app.route("/api/chess/join/<game_id>", methods=["POST"])
def api_chess_join(game_id):
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    db = get_db()
    game = _chess_game(db, game_id)
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    if game["creator_id"] == uid:
        return jsonify({"error": "own_game"}), 409
    # Atomic claim of the empty seat — protects against double joins.
    if game["white_id"] is None:
        cur = db.execute(
            "UPDATE chess_games SET white_id = ?, status = 'active', "
            "updated_at = datetime('now') WHERE id = ? AND status = 'waiting'",
            (uid, game_id),
        )
    else:
        cur = db.execute(
            "UPDATE chess_games SET black_id = ?, status = 'active', "
            "updated_at = datetime('now') WHERE id = ? AND status = 'waiting'",
            (uid, game_id),
        )
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "not_joinable"}), 409
    return jsonify({"ok": True, "game_id": game_id})


@app.route("/api/chess/cancel/<game_id>", methods=["POST"])
def api_chess_cancel(game_id):
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    db = get_db()
    cur = db.execute(
        "DELETE FROM chess_games WHERE id = ? AND creator_id = ? AND status = 'waiting'",
        (game_id, uid),
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "not_cancelable"}), 409
    return jsonify({"ok": True})


@app.route("/api/chess/lobby")
def api_chess_lobby():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    db = get_db()
    open_rows = db.execute(
        """
        SELECT g.id, g.creator_id, g.created_at, u.username AS creator
        FROM chess_games g JOIN users u ON u.id = g.creator_id
        WHERE g.status = 'waiting' ORDER BY g.created_at DESC LIMIT 20
        """
    ).fetchall()
    active_rows = db.execute(
        """
        SELECT g.*, wu.username AS white_name, bu.username AS black_name
        FROM chess_games g
        LEFT JOIN users wu ON wu.id = g.white_id
        LEFT JOIN users bu ON bu.id = g.black_id
        WHERE g.status = 'active' AND (g.white_id = ? OR g.black_id = ?)
        ORDER BY g.updated_at DESC LIMIT 20
        """,
        (uid, uid),
    ).fetchall()
    finished_rows = db.execute(
        """
        SELECT g.*, wu.username AS white_name, bu.username AS black_name
        FROM chess_games g
        LEFT JOIN users wu ON wu.id = g.white_id
        LEFT JOIN users bu ON bu.id = g.black_id
        WHERE g.status = 'finished' AND (g.white_id = ? OR g.black_id = ?)
        ORDER BY g.updated_at DESC LIMIT 5
        """,
        (uid, uid),
    ).fetchall()
    ratings = db.execute(
        """
        SELECT u.username, r.rating, r.wins, r.draws, r.losses
        FROM chess_ratings r JOIN users u ON u.id = r.user_id
        ORDER BY r.rating DESC LIMIT 10
        """
    ).fetchall()

    def active_item(g):
        you = _chess_color_of(g, uid)
        state = json.loads(g["state"])
        opp = g["black_name"] if you == "w" else g["white_name"]
        if opp is None and g["bot_level"]:
            opp = _bot_name(g["bot_level"])
        return {"id": g["id"], "opponent": opp, "you": you, "bot": bool(g["bot_level"]),
                "your_turn": state["turn"] == you, "moves": len(state["history"])}

    def finished_item(g):
        you = _chess_color_of(g, uid)
        opp = g["black_name"] if you == "w" else g["white_name"]
        if opp is None and g["bot_level"]:
            opp = _bot_name(g["bot_level"])
        if g["result"] == "draw":
            outcome = "draw"
        else:
            outcome = "win" if (g["result"] == "white") == (you == "w") else "loss"
        return {"id": g["id"], "opponent": opp, "outcome": outcome,
                "reason": g["end_reason"]}

    me = _chess_rating_row(db, uid)
    db.commit()  # in case the rating row was just created
    return jsonify({
        "open": [{"id": r["id"], "creator": r["creator"], "mine": r["creator_id"] == uid}
                 for r in open_rows],
        "active": [active_item(g) for g in active_rows],
        "finished": [finished_item(g) for g in finished_rows],
        "ratings": [dict(r) for r in ratings],
        "me": {"rating": me["rating"], "wins": me["wins"],
               "draws": me["draws"], "losses": me["losses"]},
    })


@app.route("/api/chess/state/<game_id>")
def api_chess_state(game_id):
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    db = get_db()
    game = _chess_game(db, game_id)
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    if _chess_color_of(game, uid) is None:
        return jsonify({"error": "forbidden"}), 403
    payload = _chess_state_payload(db, game, uid)
    db.commit()
    return jsonify(payload)


@app.route("/api/chess/move/<game_id>", methods=["POST"])
def api_chess_move(game_id):
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    data = request.get_json(silent=True) or {}
    frm, to = data.get("from"), data.get("to")
    promo = data.get("promotion")
    if not isinstance(frm, str) or not isinstance(to, str):
        return jsonify({"error": "invalid_payload"}), 400

    db = get_db()
    game = _chess_game(db, game_id)
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    you = _chess_color_of(game, uid)
    if you is None:
        return jsonify({"error": "forbidden"}), 403
    if game["status"] != "active":
        return jsonify({"error": "not_active"}), 409

    state = json.loads(game["state"])
    if state["turn"] != you:
        return jsonify({"error": "not_your_turn"}), 409

    try:
        new_state, info = chess_engine.make_move(state, frm, to, promo)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    db.execute(
        "UPDATE chess_games SET state = ?, draw_offer = NULL, "
        "updated_at = datetime('now') WHERE id = ?",
        (json.dumps(new_state), game_id),
    )
    if info["status"] == "finished":
        if info["reason"] == "checkmate":
            result = "white" if info["winner"] == "w" else "black"
        else:
            result = "draw"
        _chess_finish(db, game_id, result, info["reason"])
    else:
        # Bot games: the bot replies within the same request.
        _bot_move_if_due(db, game_id)
    db.commit()
    game = _chess_game(db, game_id)
    return jsonify(_chess_state_payload(db, game, uid))


@app.route("/api/chess/resign/<game_id>", methods=["POST"])
def api_chess_resign(game_id):
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    db = get_db()
    game = _chess_game(db, game_id)
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    you = _chess_color_of(game, uid)
    if you is None:
        return jsonify({"error": "forbidden"}), 403
    if game["status"] != "active":
        return jsonify({"error": "not_active"}), 409
    _chess_finish(db, game_id, "black" if you == "w" else "white", "resign")
    db.commit()
    game = _chess_game(db, game_id)
    return jsonify(_chess_state_payload(db, game, uid))


@app.route("/api/chess/draw/<game_id>", methods=["POST"])
def api_chess_draw(game_id):
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not_authenticated"}), 401
    action = (request.get_json(silent=True) or {}).get("action")
    if action not in ("offer", "accept", "decline"):
        return jsonify({"error": "invalid_payload"}), 400
    db = get_db()
    game = _chess_game(db, game_id)
    if game is None:
        return jsonify({"error": "unknown_game"}), 404
    you = _chess_color_of(game, uid)
    if you is None:
        return jsonify({"error": "forbidden"}), 403
    if game["status"] != "active":
        return jsonify({"error": "not_active"}), 409
    if game["bot_level"]:
        return jsonify({"error": "bot_game"}), 409

    if action == "offer":
        if game["draw_offer"]:
            return jsonify({"error": "offer_pending"}), 409
        db.execute("UPDATE chess_games SET draw_offer = ?, updated_at = datetime('now') "
                   "WHERE id = ?", (you, game_id))
    elif action == "accept":
        if not game["draw_offer"] or game["draw_offer"] == you:
            return jsonify({"error": "no_offer"}), 409
        _chess_finish(db, game_id, "draw", "draw_agreed")
    else:  # decline
        if not game["draw_offer"] or game["draw_offer"] == you:
            return jsonify({"error": "no_offer"}), 409
        db.execute("UPDATE chess_games SET draw_offer = NULL, updated_at = datetime('now') "
                   "WHERE id = ?", (game_id,))
    db.commit()
    game = _chess_game(db, game_id)
    return jsonify(_chess_state_payload(db, game, uid))


# --------------------------------------------------------------------------
# Admin backend
# --------------------------------------------------------------------------
ADMIN_SCORES_PER_PAGE = 50


@app.route("/admin")
@admin_required
def admin_dashboard():
    db = get_db()
    stats = {
        "users": db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"],
        "scores": db.execute("SELECT COUNT(*) AS c FROM scores").fetchone()["c"],
        "games_open": db.execute(
            "SELECT COUNT(*) AS c FROM games WHERE status = 'open'"
        ).fetchone()["c"],
        "games_finished": db.execute(
            "SELECT COUNT(*) AS c FROM games WHERE status = 'finished'"
        ).fetchone()["c"],
        "best": db.execute("SELECT COALESCE(MAX(score), 0) AS m FROM scores").fetchone()["m"],
    }
    top = db.execute(
        """
        SELECT u.username, s.score, s.lines, s.level
        FROM scores s JOIN users u ON u.id = s.user_id
        ORDER BY s.score DESC, s.created_at ASC LIMIT 5
        """
    ).fetchall()
    latest = db.execute(
        """
        SELECT u.username, s.game, s.score, s.lines, s.level, s.created_at
        FROM scores s JOIN users u ON u.id = s.user_id
        ORDER BY s.created_at DESC, s.id DESC LIMIT 5
        """
    ).fetchall()
    # Per-game breakdown (keeps the hub's multi-game model visible to admins).
    by_game_rows = db.execute(
        """
        SELECT game, COUNT(*) AS runs, COALESCE(MAX(score), 0) AS best
        FROM scores GROUP BY game
        """
    ).fetchall()
    counts = {r["game"]: r for r in by_game_rows}
    by_game = []
    seen = set()
    for gdef in GAMES:
        r = counts.get(gdef["slug"])
        by_game.append({"title": gdef["title"], "slug": gdef["slug"],
                        "status": gdef["status"],
                        "runs": r["runs"] if r else 0,
                        "best": r["best"] if r else 0})
        seen.add(gdef["slug"])
    for slug, r in counts.items():  # any scores for games not in the registry
        if slug not in seen:
            by_game.append({"title": slug, "slug": slug, "status": "other",
                            "runs": r["runs"], "best": r["best"]})
    return render_template("admin/dashboard.html", admin=g.admin_user,
                           active="dash", stats=stats, top=top, latest=latest,
                           by_game=by_game)


@app.route("/admin/users")
@admin_required
def admin_users():
    rows = get_db().execute(
        """
        SELECT u.id, u.username, u.is_admin, u.created_at,
               COUNT(s.id) AS runs, COALESCE(MAX(s.score), 0) AS best
        FROM users u LEFT JOIN scores s ON s.user_id = u.id
        GROUP BY u.id ORDER BY u.created_at ASC, u.id ASC
        """
    ).fetchall()
    return render_template("admin/users.html", admin=g.admin_user,
                           active="users", users=rows)


@app.route("/admin/users/<int:user_id>/toggle-admin", methods=["POST"])
@admin_required
def admin_toggle_admin(user_id):
    check_csrf()
    if user_id == g.admin_user["id"]:
        flash("Du kannst dir nicht selbst die Adminrechte entziehen.", "error")
        return redirect(url_for("admin_users"))
    db = get_db()
    row = db.execute("SELECT username, is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        abort(404)
    new_val = 0 if row["is_admin"] else 1
    db.execute("UPDATE users SET is_admin = ? WHERE id = ?", (new_val, user_id))
    db.commit()
    flash(f"{row['username']} ist jetzt {'Admin' if new_val else 'normaler Spieler'}.", "ok")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<int:user_id>/reset-password", methods=["POST"])
@admin_required
def admin_reset_password(user_id):
    check_csrf()
    db = get_db()
    row = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        abort(404)
    new_pw = secrets.token_urlsafe(9)
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
               (generate_password_hash(new_pw), user_id))
    db.commit()
    flash(f"Neues Passwort für {row['username']}: {new_pw} – jetzt notieren, "
          "es wird nicht erneut angezeigt.", "ok")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
@admin_required
def admin_delete_user(user_id):
    check_csrf()
    if user_id == g.admin_user["id"]:
        flash("Du kannst dich nicht selbst löschen.", "error")
        return redirect(url_for("admin_users"))
    db = get_db()
    row = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        abort(404)
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))  # cascades scores+games
    db.commit()
    flash(f"Spieler {row['username']} samt Scores gelöscht.", "ok")
    return redirect(url_for("admin_users"))


@app.route("/admin/scores")
@admin_required
def admin_scores():
    db = get_db()
    page = max(1, request.args.get("page", 1, type=int) or 1)
    user_id = request.args.get("user_id", type=int)
    game = request.args.get("game") or None

    clauses, params = [], []
    filter_user = None
    if user_id:
        filter_user = db.execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if filter_user:
            clauses.append("s.user_id = ?")
            params.append(user_id)
    if game:
        clauses.append("s.game = ?")
        params.append(game)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    offset = (page - 1) * ADMIN_SCORES_PER_PAGE
    rows = db.execute(
        f"""
        SELECT s.id, s.game, s.score, s.lines, s.level, s.created_at, s.game_id,
               u.username
        FROM scores s JOIN users u ON u.id = s.user_id
        {where}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?
        """,
        (*params, ADMIN_SCORES_PER_PAGE + 1, offset),
    ).fetchall()
    has_next = len(rows) > ADMIN_SCORES_PER_PAGE
    rows = rows[:ADMIN_SCORES_PER_PAGE]
    return render_template("admin/scores.html", admin=g.admin_user,
                           active="scores", scores=rows, page=page,
                           has_next=has_next, filter_user=filter_user,
                           games=GAMES, filter_game=game)


@app.route("/admin/scores/<int:score_id>/delete", methods=["POST"])
@admin_required
def admin_delete_score(score_id):
    check_csrf()
    db = get_db()
    cur = db.execute("DELETE FROM scores WHERE id = ?", (score_id,))
    db.commit()
    if cur.rowcount == 0:
        abort(404)
    flash(f"Score #{score_id} gelöscht.", "ok")
    return redirect(request.referrer or url_for("admin_scores"))


@app.route("/admin/scores/clear", methods=["POST"])
@admin_required
def admin_clear_scores():
    check_csrf()
    db = get_db()
    cur = db.execute("DELETE FROM scores")
    db.commit()
    flash(f"Leaderboard geleert ({cur.rowcount} Einträge gelöscht).", "ok")
    return redirect(url_for("admin_scores"))


@app.route("/admin/games/cleanup", methods=["POST"])
@admin_required
def admin_cleanup_games():
    check_csrf()
    db = get_db()
    cur = db.execute(
        "DELETE FROM games WHERE status = 'open' "
        "AND created_at < datetime('now', '-1 day')"
    )
    db.commit()
    flash(f"{cur.rowcount} verwaiste offene Spiele entfernt.", "ok")
    return redirect(url_for("admin_dashboard"))


# --------------------------------------------------------------------------
# CLI: bootstrap the first admin (afterwards manageable via the web UI)
#   cd /opt/arcade && sudo -u arcade .venv/bin/flask --app app make-admin NAME
# --------------------------------------------------------------------------
@app.cli.command("make-admin")
@click.argument("username")
def make_admin_cmd(username):
    """Gibt USERNAME Adminrechte."""
    db = sqlite3.connect(DB_PATH)
    cur = db.execute("UPDATE users SET is_admin = 1 WHERE username = ?", (username,))
    db.commit()
    db.close()
    if cur.rowcount:
        click.echo(f"OK: '{username}' ist jetzt Admin.")
    else:
        click.echo(f"FEHLER: User '{username}' nicht gefunden (erst registrieren).", err=True)
        raise SystemExit(1)


if __name__ == "__main__":
    # Development only. In production the systemd unit runs this via waitress.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
