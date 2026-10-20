"""Seitenrahmen und Spieleübersicht: Fehlerseiten, Anmelden, Hub-Daten, Admin-Leeren."""

import sqlite3
import unittest

from tests import support

arcade = support.arcade


def add_score(username, game, score):
    db = sqlite3.connect(arcade.DB_PATH)
    try:
        uid = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()[0]
        db.execute("INSERT INTO scores (user_id, game, score) VALUES (?, ?, ?)", (uid, game, score))
        db.commit()
    finally:
        db.close()


def count_scores(game):
    db = sqlite3.connect(arcade.DB_PATH)
    try:
        return db.execute("SELECT COUNT(*) FROM scores WHERE game = ?", (game,)).fetchone()[0]
    finally:
        db.close()


class FormatTest(unittest.TestCase):
    def test_numbers_use_german_grouping(self):
        self.assertEqual(arcade.format_number(12345), "12.345")
        self.assertEqual(arcade.format_number(7), "7")
        self.assertEqual(arcade.format_number(None), None)

    def test_ago(self):
        self.assertEqual(arcade.format_ago("kaputt"), "")
        self.assertEqual(arcade.format_ago("2001-02-03 04:05:06"), "03.02.2001")


class ErrorPageTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()

    def test_unknown_page_is_german_html(self):
        r = self.c.get("/gibt-es-nicht")
        self.assertEqual(r.status_code, 404)
        self.assertIn("Seite nicht gefunden", r.get_data(as_text=True))

    def test_unknown_api_answers_json(self):
        r = self.c.get("/api/gibt-es-nicht")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.get_json(), {"error": "not_found"})

    def test_missing_csrf_token_is_400_page(self):
        name = support.register(self.c)
        support.make_admin(name)
        r = self.c.post("/admin/scores/clear", data={})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Ungültige Anfrage", r.get_data(as_text=True))


class AuthFormTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()

    def test_failed_login_keeps_username(self):
        name = support.register(support.client())
        r = self.c.post("/login", data={"username": name, "password": "falsch"})
        html = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        self.assertIn(f'value="{name}"', html)
        self.assertIn("Benutzername oder Passwort stimmt nicht.", html)

    def test_failed_registration_keeps_username(self):
        r = self.c.post("/register", data={"username": "neu_hier", "password": "kurz",
                                           "password2": "kurz"})
        html = r.get_data(as_text=True)
        self.assertIn('value="neu_hier"', html)
        self.assertIn("Das Passwort braucht mindestens 6 Zeichen.", html)

    def test_session_of_deleted_account_goes_to_login(self):
        name = support.register(self.c)
        db = sqlite3.connect(arcade.DB_PATH)
        db.execute("DELETE FROM users WHERE username = ?", (name,))
        db.commit()
        db.close()
        for path in ("/", "/games/tetris"):
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, 302)
                self.assertIn("/login", r.headers["Location"])
        self.assertEqual(self.c.get("/login").status_code, 200)


class HubTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()
        self.name = support.register(self.c)

    def test_newcomer_sees_starter_capsule(self):
        html = self.c.get("/").get_data(as_text=True)
        self.assertIn("Zum Einstieg", html)
        self.assertIn("Noch kein Score", html)

    def test_standing_and_last_played(self):
        rival = support.register(support.client())
        add_score(rival, "snake", 900_000)
        add_score(self.name, "snake", 4_321)
        add_score(self.name, "snake", 0)  # zählt nicht für Platz und Highscore
        data = arcade._hub_data(self._db(), self._uid())
        self.assertEqual(data["featured"]["slug"], "snake")
        self.assertTrue(data["returning"])
        mine = data["standing"]["snake"]
        self.assertEqual(mine["best"], 4_321)
        better = self._db().execute(
            "SELECT COUNT(*) FROM (SELECT MAX(score) AS b FROM scores WHERE game = 'snake' "
            "GROUP BY user_id) WHERE b > 4321").fetchone()[0]
        self.assertGreaterEqual(better, 1)  # mindestens der Rivale
        self.assertEqual(mine["rank"], 1 + better)
        html = self.c.get("/").get_data(as_text=True)
        self.assertIn("Weiterspielen", html)
        self.assertIn("4.321", html)

    def _db(self):
        db = sqlite3.connect(arcade.DB_PATH)
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        return db

    def _uid(self):
        return self._db().execute("SELECT id FROM users WHERE username = ?",
                                  (self.name,)).fetchone()["id"]


class AdminClearTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()
        name = support.register(self.c)
        support.make_admin(name)
        add_score(name, "tetris", 100)
        add_score(name, "breakout", 50)
        with self.c.session_transaction() as s:
            self.token = s["_csrf"]

    def test_filtered_clear_only_touches_that_game(self):
        r = self.c.post("/admin/scores/clear", data={"csrf_token": self.token, "game": "tetris"})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(count_scores("tetris"), 0)
        self.assertGreater(count_scores("breakout"), 0)

    def test_unfiltered_clear_empties_everything(self):
        self.c.post("/admin/scores/clear", data={"csrf_token": self.token})
        self.assertEqual(count_scores("tetris") + count_scores("breakout"), 0)


class GamePageTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()
        support.register(self.c)

    def test_touch_gestures_come_from_the_registry(self):
        for game in arcade.GAMES:
            if game["status"] != "live" or not game["controls"]:
                continue
            html = self.c.get(f"/games/{game['slug']}").get_data(as_text=True)
            if game.get("touch"):
                self.assertIn("controls controls-touch", html, game["slug"])
                for gesture, does in game["touch"]:
                    self.assertIn(f'<span class="gesture">{gesture}</span>', html, game["slug"])
                    self.assertIn(does, html, game["slug"])
            else:
                self.assertNotIn("controls-touch", html, game["slug"])

    def test_board_canvas_knows_its_game_size(self):
        html = self.c.get("/games/tetris").get_data(as_text=True)
        self.assertIn('class="game-canvas" width="300" height="600" style="--bw: 300; --bh: 600"', html)


class DoomWadTest(unittest.TestCase):
    def test_own_wads_in_any_case_get_a_button(self):
        import os
        import tempfile
        from unittest import mock
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "DOOM1.WAD"), "wb").close()
            open(os.path.join(d, "readme.txt"), "wb").close()
            with mock.patch.object(arcade, "DOOM_DIR", d):
                self.assertEqual(arcade._doom_wads(),
                                 [{"wad": "doom1.wad", "file": "DOOM1.WAD", "title": "DOOM"}])
                c = support.client()
                support.register(c)
                html = c.get("/games/doom").get_data(as_text=True)
                self.assertIn('data-file="DOOM1.WAD"', html)
                self.assertIn("Starten mit DOOM", html)

    def test_missing_folder_means_no_extra_buttons(self):
        from unittest import mock
        with mock.patch.object(arcade, "DOOM_DIR", "/gibt/es/nicht"):
            self.assertEqual(arcade._doom_wads(), [])


if __name__ == "__main__":
    unittest.main()
