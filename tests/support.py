"""Gemeinsame Testhilfen.

Die App legt arcade.db und secret_key schon beim Import an. Deshalb muss
ARCADE_DATA_DIR gesetzt sein, BEVOR irgendein Test `app` importiert. Alle
Tests holen die App deshalb über dieses Modul und nie direkt.
"""

import atexit
import itertools
import os
import shutil
import sqlite3
import tempfile

_DATA_DIR = tempfile.mkdtemp(prefix="abw-arcade-test-")
os.environ["ARCADE_DATA_DIR"] = _DATA_DIR
atexit.register(shutil.rmtree, _DATA_DIR, ignore_errors=True)

import app as arcade  # noqa: E402  (erst nach ARCADE_DATA_DIR importieren)

arcade.app.config.update(TESTING=True)

PASSWORD = "geheim123"
_names = itertools.count(1)


def unique_name(prefix="spieler"):
    """Usernamen sind in der gemeinsamen Test-DB eindeutig."""
    return f"{prefix}{next(_names)}"


def client():
    return arcade.app.test_client()


def register(c, username=None, password=PASSWORD):
    """Registriert einen neuen Account; der Client ist danach angemeldet."""
    username = username or unique_name()
    r = c.post("/register", data={
        "username": username, "password": password, "password2": password,
    })
    assert r.status_code == 302, f"Registrierung fehlgeschlagen: {r.status_code}"
    return username


def make_admin(username):
    db = sqlite3.connect(arcade.DB_PATH)
    try:
        db.execute("UPDATE users SET is_admin = 1 WHERE username = ?", (username,))
        db.commit()
    finally:
        db.close()
