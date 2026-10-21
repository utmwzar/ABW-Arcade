"""Schach-API: Versionen, Wettläufe, Elo-Änderung und gesperrte Datenbank.

Die Fälle stammen aus echten Schwächen der alten Version: Der Bot rechnete
mit offener Schreibsperre (bis zu 4 s blockierte das alle anderen
Schreibzugriffe), zwei gleichzeitige Züge überschrieben sich, und Aufgabe
plus Matt konnten eine Partie zweimal werten.
"""

import os
import sqlite3
import tempfile
import threading
import unittest

from tests import support

arcade = support.arcade


def _register_pair():
    a, b = support.client(), support.client()
    name_a, name_b = support.register(a), support.register(b)
    return a, b, name_a, name_b


def _pvp_game(a, b):
    """Partie zwischen a und b; liefert (game_id, client_weiss, client_schwarz)."""
    gid = a.post("/api/chess/create").get_json()["game_id"]
    assert b.post(f"/api/chess/join/{gid}").status_code == 200
    state = a.get(f"/api/chess/state/{gid}").get_json()
    return (gid, a, b) if state["you"] == "w" else (gid, b, a)


class VersionTest(unittest.TestCase):
    def test_each_change_raises_the_version(self):
        a, b, *_ = _register_pair()
        gid, white, black = _pvp_game(a, b)
        v0 = white.get(f"/api/chess/state/{gid}").get_json()["version"]
        r = white.post(f"/api/chess/move/{gid}", json={"from": "e2", "to": "e4"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["version"], v0 + 1)
        r = black.post(f"/api/chess/draw/{gid}", json={"action": "offer"})
        self.assertEqual(r.get_json()["version"], v0 + 2)

    def test_stale_expected_version_is_rejected_with_current_state(self):
        a, b, *_ = _register_pair()
        gid, white, _black = _pvp_game(a, b)
        v = white.get(f"/api/chess/state/{gid}").get_json()["version"]
        r = white.post(f"/api/chess/move/{gid}",
                       json={"from": "e2", "to": "e4", "expected_version": v - 1})
        self.assertEqual(r.status_code, 409)
        body = r.get_json()
        self.assertEqual(body["error"], "conflict")
        self.assertEqual(body["state"]["version"], v)
        self.assertEqual(body["state"]["history"], [])


class LobbyPageTest(unittest.TestCase):
    BOT_FILLED = 'class="btn" type="button" data-bot'
    BOT_SECONDARY = 'class="btn btn-secondary" type="button" data-bot'

    def test_bot_button_yields_to_a_waiting_game(self):
        a, b, *_ = _register_pair()
        self.assertIn(self.BOT_FILLED, a.get("/games/chess").get_data(as_text=True))
        _gid, white, black = _pvp_game(a, b)
        # Weiß ist am Zug: dort ist „Zum Brett“ der Hauptknopf, bei Schwarz der Bot-Knopf
        self.assertIn(self.BOT_SECONDARY, white.get("/games/chess").get_data(as_text=True))
        self.assertIn(self.BOT_FILLED, black.get("/games/chess").get_data(as_text=True))


class BotTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()
        support.register(self.c)

    def _bot_game(self, color="w"):
        r = self.c.post("/api/chess/create", json={"mode": "bot", "level": "easy", "color": color})
        self.assertEqual(r.status_code, 200)
        return r.get_json()["game_id"]

    def test_bot_replies_in_the_same_request(self):
        gid = self._bot_game("w")
        r = self.c.post(f"/api/chess/move/{gid}", json={"from": "e2", "to": "e4"})
        self.assertEqual(r.status_code, 200)
        state = r.get_json()
        self.assertEqual(len(state["history"]), 2)
        self.assertEqual(state["turn"], "w")
        self.assertIsNone(state["rating_delta"])   # Bot-Partien sind unbewertet

    def test_bot_with_white_opens_immediately(self):
        gid = self._bot_game("b")
        state = self.c.get(f"/api/chess/state/{gid}").get_json()
        self.assertEqual(len(state["history"]), 1)
        self.assertEqual(state["turn"], "b")

    def test_no_write_lock_while_the_bot_thinks(self):
        gid = self._bot_game("w")
        thinking, release = threading.Event(), threading.Event()
        real = arcade.chess_bot.choose_move

        def slow_choose(state, level):
            thinking.set()
            release.wait(5)
            return real(state, level)

        arcade.chess_bot.choose_move = slow_choose
        result = {}
        try:
            worker = threading.Thread(target=lambda: result.update(
                r=self.c.post(f"/api/chess/move/{gid}", json={"from": "d2", "to": "d4"})))
            worker.start()
            self.assertTrue(thinking.wait(5), "Der Bot wurde nicht gefragt")
            other = sqlite3.connect(arcade.DB_PATH, timeout=0.5)
            try:
                other.execute("INSERT INTO users (username, password_hash) VALUES (?, 'x')",
                              (support.unique_name("parallel"),))
                other.commit()   # schlägt mit "database is locked" fehl, wenn gesperrt
            finally:
                other.close()
        finally:
            release.set()
            worker.join(10)
            arcade.chess_bot.choose_move = real
        self.assertEqual(result["r"].status_code, 200)
        self.assertEqual(len(result["r"].get_json()["history"]), 2)


class FinishTest(unittest.TestCase):
    def test_resign_counts_once_and_reports_the_rating_change(self):
        a, b, *_ = _register_pair()
        gid, white, black = _pvp_game(a, b)
        r = white.post(f"/api/chess/resign/{gid}")
        self.assertEqual(r.status_code, 200)
        state = r.get_json()
        self.assertEqual(state["result"], "black")
        self.assertEqual(state["rating_delta"], {"white": -16, "black": 16})

        again = black.post(f"/api/chess/resign/{gid}")
        self.assertEqual(again.status_code, 409)

        lobby = black.get("/api/chess/lobby").get_json()
        self.assertEqual(lobby["me"]["rating"], 1016)
        self.assertEqual(lobby["me"]["wins"], 1)

    def test_draw_accept_after_finish_is_rejected(self):
        a, b, *_ = _register_pair()
        gid, white, black = _pvp_game(a, b)
        white.post(f"/api/chess/draw/{gid}", json={"action": "offer"})
        self.assertEqual(white.post(f"/api/chess/resign/{gid}").status_code, 200)
        r = black.post(f"/api/chess/draw/{gid}", json={"action": "accept"})
        self.assertEqual(r.status_code, 409)


class ReadOnlyTest(unittest.TestCase):
    def test_lobby_and_state_do_not_create_rating_rows(self):
        c = support.client()
        name = support.register(c)
        c.get("/api/chess/lobby")
        gid = c.post("/api/chess/create",
                     json={"mode": "bot", "level": "easy", "color": "w"}).get_json()["game_id"]
        c.get(f"/api/chess/state/{gid}")
        db = sqlite3.connect(arcade.DB_PATH)
        try:
            row = db.execute(
                "SELECT COUNT(*) FROM chess_ratings r JOIN users u ON u.id = r.user_id "
                "WHERE u.username = ?", (name,)).fetchone()[0]
        finally:
            db.close()
        self.assertEqual(row, 0)

    def test_ranking_lists_only_players_with_rated_games(self):
        c = support.client()
        support.register(c)
        ratings = c.get("/api/chess/lobby").get_json()["ratings"]
        for r in ratings:
            self.assertGreater(r["wins"] + r["draws"] + r["losses"], 0, r)


class MigrationTest(unittest.TestCase):
    def test_old_database_gets_the_new_columns(self):
        tmp = tempfile.mkdtemp(prefix="abw-migration-")
        path = os.path.join(tmp, "arcade.db")
        old = sqlite3.connect(path)
        old.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
            CREATE TABLE chess_games (id TEXT PRIMARY KEY, white_id INTEGER, black_id INTEGER,
                creator_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', state TEXT NOT NULL,
                result TEXT, end_reason TEXT, draw_offer TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')));
            INSERT INTO chess_games (id, creator_id, status, state) VALUES ('alt', 1, 'finished', '{}');
        """)
        old.commit()
        old.close()
        saved = arcade.DB_PATH
        arcade.DB_PATH = path
        try:
            arcade.init_db()
        finally:
            arcade.DB_PATH = saved
        db = sqlite3.connect(path)
        try:
            cols = {r[1] for r in db.execute("PRAGMA table_info(chess_games)")}
            version, wd = db.execute(
                "SELECT version, white_delta FROM chess_games WHERE id = 'alt'").fetchone()
        finally:
            db.close()
        self.assertTrue({"bot_level", "version", "white_delta", "black_delta"} <= cols)
        self.assertEqual(version, 0)
        self.assertIsNone(wd)


if __name__ == "__main__":
    unittest.main()
