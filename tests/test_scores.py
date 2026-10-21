"""Scores eintragen: genau einmal je Spiel, Stand davor und danach, Runs ohne Punkte."""

import secrets
import sqlite3
import unittest

from tests import support

arcade = support.arcade


class SaveScoreTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(arcade.DB_PATH)
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        # eigenes Spiel je Testlauf, damit andere Tests den Platz nicht verschieben
        self.game = "test-" + secrets.token_hex(4)
        self.me = self._user()
        self.rival = self._user()

    def _user(self):
        name = support.register(support.client())
        return self.db.execute("SELECT id FROM users WHERE username = ?", (name,)).fetchone()["id"]

    def _open_game(self, uid):
        gid = secrets.token_urlsafe(8)
        self.db.execute("INSERT INTO games (id, user_id, game, seed, status) VALUES (?, ?, ?, 1, 'open')",
                        (gid, uid, self.game))
        self.db.commit()
        return gid

    def save(self, uid, score, gid=None):
        return arcade._save_score(self.db, uid, self.game, gid or self._open_game(uid), score)

    def test_first_score_enters_the_leaderboard(self):
        self.save(self.rival, 500)
        r = self.save(self.me, 100)
        self.assertEqual((r["previous_best"], r["previous_rank"]), (0, None))
        self.assertEqual((r["best"], r["rank"], r["players"]), (100, 2, 2))
        self.assertTrue(r["new_best"])

    def test_rank_moves_up_with_a_new_highscore(self):
        self.save(self.rival, 500)
        self.save(self.me, 100)
        r = self.save(self.me, 900)
        self.assertEqual((r["previous_best"], r["previous_rank"]), (100, 2))
        self.assertEqual((r["best"], r["rank"]), (900, 1))
        self.assertTrue(r["new_best"])

    def test_weaker_run_keeps_the_highscore(self):
        self.save(self.me, 300)
        r = self.save(self.me, 200)
        self.assertEqual(r["best"], 300)
        self.assertFalse(r["new_best"])

    def test_zero_runs_are_not_ranked(self):
        r = self.save(self.me, 0)
        self.assertEqual((r["best"], r["rank"], r["players"]), (0, None, 0))
        self.assertFalse(r["new_best"])

    def test_each_game_counts_once(self):
        gid = self._open_game(self.me)
        self.assertIsNotNone(self.save(self.me, 10, gid))
        self.assertIsNone(self.save(self.me, 99, gid))


class LeaderboardApiTest(unittest.TestCase):
    def test_zero_runs_stay_out_of_the_leaderboard(self):
        c = support.client()
        name = support.register(c)
        game = c.post("/api/2048/start").get_json()
        done = c.post("/api/2048/finish", json={"game_id": game["game_id"], "inputs": []}).get_json()
        self.assertEqual(done["score"], 0)  # ohne Zug keine Punkte
        self.assertIsNone(done["standing"]["rank"])
        board = c.get("/api/leaderboard?game=2048").get_json()
        self.assertNotIn(name, [row["username"] for row in board["leaderboard"]])
        self.assertEqual(board["me"]["best"], 0)

    def test_tetris_finish_rejects_other_games(self):
        c = support.client()
        support.register(c)
        game = c.post("/api/snake/start").get_json()
        r = c.post("/api/game/finish", json={"game_id": game["game_id"], "inputs": []})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "wrong_game")


if __name__ == "__main__":
    unittest.main()
