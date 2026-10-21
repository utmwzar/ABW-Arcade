"""Start und Abschluss jeder server-geprüften Partie über die echte API.

Eine leere Eingabeliste ist ein gültiges Spiel: Ohne Eingaben läuft jede
Partie bis zu ihrem Ende durch. Danach muss die game_id verbraucht sein.
"""

import unittest

from tests import support

# (Start-URL, Finish-URL) je Spiel
GAMES = {
    "tetris": ("/api/game/start", "/api/game/finish"),
    "snake": ("/api/snake/start", "/api/snake/finish"),
    "breakout": ("/api/breakout/start", "/api/breakout/finish"),
    "2048": ("/api/2048/start", "/api/2048/finish"),
    "geometry-dash": ("/api/geometry-dash/start", "/api/geometry-dash/finish"),
}


class ReplayApiTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()
        support.register(self.c)

    def test_start_requires_login(self):
        anon = support.client()
        for slug, (start, _finish) in GAMES.items():
            with self.subTest(game=slug):
                self.assertEqual(anon.post(start).status_code, 401)

    def test_round_trip_and_single_use(self):
        for slug, (start, finish) in GAMES.items():
            with self.subTest(game=slug):
                r = self.c.post(start)
                self.assertEqual(r.status_code, 200)
                game = r.get_json()
                self.assertIn("seed", game)

                payload = {"game_id": game["game_id"], "inputs": []}
                done = self.c.post(finish, json=payload)
                self.assertEqual(done.status_code, 200)
                body = done.get_json()
                self.assertTrue(body["ok"])
                self.assertIsInstance(body["score"], int)

                again = self.c.post(finish, json=payload)
                self.assertEqual(again.status_code, 409)
                self.assertEqual(again.get_json()["error"], "already_finished")

    def test_leaderboard_lists_the_run(self):
        start, finish = GAMES["2048"]
        game = self.c.post(start).get_json()
        self.c.post(finish, json={"game_id": game["game_id"], "inputs": []})
        board = self.c.get("/api/leaderboard?game=2048").get_json()
        self.assertIn("leaderboard", board)
        self.assertIsNotNone(board["me"])


if __name__ == "__main__":
    unittest.main()
