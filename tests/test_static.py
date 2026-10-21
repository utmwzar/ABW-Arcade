"""Statische Dateien kommen mit dem richtigen Typ und ohne langes Caching.

Der Typ ist für ES-Module Pflicht: Steht .js als text/plain in der
Windows-Registry, lädt der Browser kein Modul. Und weil Updates neue
Dateien unter denselben Namen ausliefern, muss der Browser jedes Mal
nachfragen (no-cache), sonst mischt er alte und neue Module.
"""

import mimetypes
import unittest

from tests import support

EXPECTED = {
    "/static/tetris.js": "text/javascript",
    "/static/css/app.css": "text/css",
    "/static/js/prefs.js": "text/javascript",
    "/static/fonts/archivo.woff2": "font/woff2",
    "/static/chess/pieces/wN.svg": "image/svg+xml",
    "/static/doom/websockets-doom.wasm": "application/wasm",
}


class StaticFilesTest(unittest.TestCase):
    def setUp(self):
        self.c = support.client()

    def test_registered_types(self):
        self.assertEqual(mimetypes.guess_type("x.js")[0], "text/javascript")
        self.assertEqual(mimetypes.guess_type("x.mjs")[0], "text/javascript")
        self.assertEqual(mimetypes.guess_type("x.wasm")[0], "application/wasm")

    def test_content_types(self):
        for path, ctype in EXPECTED.items():
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.mimetype, ctype)
                r.close()

    def test_scripts_are_revalidated(self):
        r = self.c.get("/static/tetris.js")
        self.assertIn("no-cache", r.headers.get("Cache-Control", ""))
        r.close()


if __name__ == "__main__":
    unittest.main()
