"""Start und Abschluss jeder server-geprüften Partie über die echte API.

Eine leere Eingabeliste ist ein gültiges Spiel: Ohne Eingaben läuft jede
Partie bis zu ihrem Ende durch. Danach muss die game_id verbraucht sein.
"""

import unittest
from unittest import mock

import breakout_engine
import gd_engine
import snake_engine
import tetris_engine
from tests import support

arcade = support.arcade

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


def _played(engine, seed, inputs, n):
    """Stand nach n Ticks, gezählt wie im Browser: je Tick erst die Eingabe, dann ein Schritt."""
    e = engine.Engine(seed)
    by_tick = {}
    for it in inputs:
        by_tick.setdefault(it["tick"], []).append(it["dir"])
    for t in range(n):
        if e.game_over:
            break
        e.tick(by_tick.get(t))
    return e


class QuitTest(unittest.TestCase):
    """Bricht der Spieler mitten im Spiel ab (Pause → Beenden, Neu starten),
    schickt der Client die gespielten Ticks mit. Gezählt wird der Stand bis
    dahin, nicht das, was ohne Eingaben noch passiert wäre: Bei Breakout flog
    der Ball weiter, bei Geometry Dash lief die Strecke weiter."""

    SEED = 1

    def setUp(self):
        self.c = support.client()
        support.register(self.c)

    def _start(self, slug):
        with mock.patch.object(arcade.secrets, "randbits", return_value=self.SEED):
            game = self.c.post(GAMES[slug][0]).get_json()
        self.assertEqual(game["seed"], self.SEED)
        return game["game_id"]

    def _finish(self, slug, game_id, inputs, **extra):
        return self.c.post(GAMES[slug][1], json={"game_id": game_id, "inputs": inputs, **extra})

    def test_quit_counts_only_the_played_ticks(self):
        cases = [
            ("geometry-dash", gd_engine, [], 60, lambda e: e.cells),
            ("breakout", breakout_engine, [{"tick": 0, "dir": "L"}], 300, lambda e: e.score),
            ("snake", snake_engine, [{"tick": 0, "dir": "U"}], 3, lambda e: e.score),
        ]
        for slug, engine, inputs, n, score_of in cases:
            with self.subTest(game=slug):
                shown = score_of(_played(engine, self.SEED, inputs, n))
                r = self._finish(slug, self._start(slug), inputs, ticks=n)
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.get_json()["score"], shown)
                self.assertFalse(r.get_json()["game_over"])
                if slug != "snake":   # bei Snake ändert der Rest selten etwas
                    self.assertGreater(engine.simulate(self.SEED, inputs)["score"], shown)

    def test_tetris_quit_after_one_tick(self):
        e = tetris_engine.Engine(self.SEED)
        e.start()
        e.apply_action("HARD")
        e.gravity_step()
        r = self._finish("tetris", self._start("tetris"), [{"tick": 0, "action": "HARD"}], ticks=1)
        self.assertEqual(r.status_code, 200)
        self.assertGreater(e.score, 0)
        self.assertEqual(r.get_json()["score"], e.score)

    def test_quit_before_the_first_tick_scores_nothing(self):
        r = self._finish("geometry-dash", self._start("geometry-dash"), [], ticks=0)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["score"], 0)

    def test_tick_count_is_checked(self):
        game_id = self._start("breakout")
        inputs = [{"tick": 5, "dir": "L"}]
        for bad in (-1, True, "10", 10.0, 5, arcade.MAX_TICK + 2):
            with self.subTest(ticks=bad):
                r = self._finish("breakout", game_id, inputs, ticks=bad)
                self.assertEqual(r.status_code, 400)
                self.assertEqual(r.get_json()["error"], "invalid_input")
        # Abgelehnte Versuche verbrauchen die Partie nicht.
        self.assertEqual(self._finish("breakout", game_id, inputs, ticks=6).status_code, 200)


if __name__ == "__main__":
    unittest.main()
