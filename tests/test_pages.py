"""Jede Seite rendert – anonym, als Spieler und als Admin.

Fängt Jinja-Fehler und kaputte Asset-Verweise ab, bevor sie jemand im
Browser sieht. Gerade beim Umbau der Templates ist das die erste Prüfung.
"""

import re
import unittest

from tests import support

# Seiten, die ein angemeldeter Spieler direkt öffnen kann.
PLAYER_PAGES = [
    "/",
    "/games/tetris",
    "/games/snake",
    "/games/breakout",
    "/games/2048",
    "/games/geometry-dash",
    "/games/doom",
    "/games/chess",
]
ADMIN_PAGES = ["/admin", "/admin/users", "/admin/scores"]
ASSET_RE = re.compile(r'(?:src|href)="(/static/[^"?#]+)')


class AnonymousTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()

    def test_healthz(self):
        r = self.c.get("/healthz")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(), {"ok": True})

    def test_auth_pages_render(self):
        for path in ("/login", "/register"):
            with self.subTest(path=path):
                self.assertEqual(self.c.get(path).status_code, 200)

    def test_protected_pages_redirect_to_login(self):
        for path in PLAYER_PAGES + ADMIN_PAGES:
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, 302)
                self.assertIn("/login", r.headers["Location"])


class PlayerTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()
        support.register(self.c)

    def assertAssetsLoad(self, html, page):
        for asset in sorted(set(ASSET_RE.findall(html))):
            with self.subTest(page=page, asset=asset):
                r = self.c.get(asset)
                r.close()  # Dateiantworten sind Streams; schließen statt lesen
                self.assertEqual(r.status_code, 200)

    def test_player_pages_render_with_assets(self):
        for path in PLAYER_PAGES:
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, 200)
                self.assertAssetsLoad(r.get_data(as_text=True), path)

    def test_chess_game_page_renders(self):
        r = self.c.post("/api/chess/create",
                        json={"mode": "bot", "level": "easy", "color": "w"})
        self.assertEqual(r.status_code, 200)
        game_id = r.get_json()["game_id"]
        page = self.c.get(f"/games/chess/{game_id}")
        self.assertEqual(page.status_code, 200)
        self.assertAssetsLoad(page.get_data(as_text=True), "chess_game")

    def test_admin_pages_are_closed_for_players(self):
        for path in ADMIN_PAGES:
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, 302)
                self.assertNotIn("/admin", r.headers["Location"])


class AdminTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()
        name = support.register(self.c)
        support.make_admin(name)

    def test_admin_pages_render(self):
        for path in ADMIN_PAGES:
            with self.subTest(path=path):
                self.assertEqual(self.c.get(path).status_code, 200)


if __name__ == "__main__":
    unittest.main()
