"""installer/sync.py spiegelt die Programmdateien und laesst Daten in Ruhe.

Alle drei Installer (Linux, macOS, Windows) kopieren damit. Ein Fehler hier
loescht im schlimmsten Fall Accounts und Bestenlisten oder die selbst
abgelegten DOOM-WADs - deshalb wird jede Schutzregel einzeln geprueft, auch
in der Schreibweise, die NTFS und APFS als dieselbe Datei behandeln.

Die Tests laufen unter Linux, macOS und Windows.
"""

import contextlib
import importlib.util
import io
import os
import shutil
import stat
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ueber den Dateipfad laden: "installer" ist kein Paket, und ein gleichnamiges
# Modul in site-packages wuerde sonst vorgezogen.
_spec = importlib.util.spec_from_file_location(
    "abw_arcade_sync", os.path.join(ROOT, "installer", "sync.py"))
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)


def write(base, rel, content="x"):
    path = os.path.join(base, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(content)
    return path


def read(base, rel):
    with open(os.path.join(base, *rel.split("/")), encoding="utf-8", newline="") as fh:
        return fh.read()


def files(base):
    """Alle Dateien unter base als Menge relativer Pfade mit /."""
    found = set()
    for folder, _dirs, names in os.walk(base):
        for name in names:
            rel = os.path.relpath(os.path.join(folder, name), base)
            found.add(rel.replace(os.sep, "/"))
    return found


def remove_tree(path):
    """rmtree, das auch schreibgeschuetzte Dateien (Windows) entfernt."""
    def force(func, failed, _exc):
        os.chmod(failed, stat.S_IWRITE | stat.S_IREAD)
        func(failed)
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=force)
    else:
        shutil.rmtree(path, onerror=force)


class SyncTestCase(unittest.TestCase):
    PROGRAM = {
        "app.py": "print('app')\n",
        "run.py": "print('run')\n",
        "requirements.txt": "Flask\n",
        "PAKET-INFO": "Paket: abw-arcade\n",
        "static/tetris.js": "// tetris\n",
        "static/doom/freedoom1.wad": "IWAD",
        "templates/base.html": "<html></html>\n",
    }

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="abw-sync-test-")
        self.addCleanup(remove_tree, self.tmp)
        self.src = os.path.join(self.tmp, "paket")
        self.dst = os.path.join(self.tmp, "ziel")
        for rel, content in self.PROGRAM.items():
            write(self.src, rel, content)

    def run_sync(self, *extra):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = sync.main([self.src, self.dst] + list(extra))
        return code, out.getvalue()

    def assertSynced(self, *extra):
        code, output = self.run_sync(*extra)
        self.assertEqual(code, 0, output)
        return output


class CopyTest(SyncTestCase):
    def test_fresh_install_copies_program(self):
        self.assertSynced()
        self.assertEqual(files(self.dst), set(self.PROGRAM))
        self.assertEqual(read(self.dst, "static/tetris.js"), "// tetris\n")

    def test_changed_file_is_copied_unchanged_is_skipped(self):
        self.assertSynced()
        path = write(self.src, "static/tetris.js", "// neue Fassung, laenger\n")
        later = os.stat(path).st_mtime + 100
        os.utime(path, (later, later))
        output = self.assertSynced()
        self.assertEqual(read(self.dst, "static/tetris.js"), "// neue Fassung, laenger\n")
        self.assertIn("1 kopiert", output)
        self.assertIn("%d unveraendert" % (len(self.PROGRAM) - 1), output)

    def test_stale_files_and_dirs_are_removed(self):
        self.assertSynced()
        write(self.dst, "static/entferntes_spiel.js")
        write(self.dst, "static/altes_spiel/sprites.png")
        write(self.dst, "templates/alt.html")
        write(self.dst, "altes_modul.py")
        self.assertSynced()
        self.assertEqual(files(self.dst), set(self.PROGRAM))
        self.assertFalse(os.path.exists(os.path.join(self.dst, "static", "altes_spiel")))

    def test_dir_replaces_file_and_file_replaces_dir(self):
        self.assertSynced()
        write(self.dst, "static/neu", "war eine Datei")
        write(self.src, "static/neu/modul.js", "js")
        os.remove(os.path.join(self.dst, "PAKET-INFO"))
        write(self.dst, "PAKET-INFO/kaputt", "war ein Ordner")
        self.assertSynced()
        self.assertEqual(read(self.dst, "static/neu/modul.js"), "js")
        self.assertEqual(read(self.dst, "PAKET-INFO"), "Paket: abw-arcade\n")


class ExcludeTest(SyncTestCase):
    DEV_FILES = [
        ".git/config", ".github/workflows/ci.yml", ".claude/settings.json",
        ".gitignore", ".gitattributes", ".DS_Store", "static/.DS_Store",
        "Thumbs.db", "static/desktop.ini", "__pycache__/app.cpython-312.pyc",
        "static/__pycache__/x.pyc", "node_modules/pkg/index.js", ".pytest_cache/v/x",
        ".venv/bin/python", "modul.pyc", "modul.pyo", ".app.py.swp",
        "tests/test_pages.py", "PRODUCT.md", "DESIGN.md", "install.sh",
        "install.cmd", "install.ps1", "paket-bauen.sh", "pruefe-engines.js",
        "pruefe_engines.py", "installer/sync.py", "abw-arcade.tar.gz",
        "abw-arcade.zip",
    ]

    def test_dev_files_are_not_copied(self):
        for rel in self.DEV_FILES:
            write(self.src, rel)
        self.assertSynced()
        self.assertEqual(files(self.dst), set(self.PROGRAM))

    def test_root_only_names_are_copied_deeper_down(self):
        write(self.src, "static/tests/hilfe.js")
        write(self.src, "templates/install.sh")
        self.assertSynced()
        self.assertIn("static/tests/hilfe.js", files(self.dst))
        self.assertIn("templates/install.sh", files(self.dst))

    def test_excluded_files_in_target_are_left_alone(self):
        self.assertSynced()
        write(self.dst, "__pycache__/app.cpython-312.pyc", "bytecode")
        write(self.dst, "static/.DS_Store", "finder")
        self.assertSynced()
        self.assertIn("__pycache__/app.cpython-312.pyc", files(self.dst))
        self.assertIn("static/.DS_Store", files(self.dst))


class ProtectTest(SyncTestCase):
    RUNTIME = {
        "arcade.db": "accounts",
        "arcade.db-journal": "journal",
        "arcade.db-wal": "wal",
        "arcade.db-shm": "shm",
        "secret_key": "geheim",
        "arcade.conf": "PORT=5077\n",
        ".venv/bin/python": "venv",
        "data/arcade.db": "accounts im Datenordner",
        "logs/arcade.log": "log",
        "service/abw-arcade.xml": "<service/>",
    }

    def test_runtime_data_survives_and_is_never_overwritten(self):
        for rel, content in self.RUNTIME.items():
            write(self.dst, rel, content)
        write(self.dst, "app.py", "alte Fassung")
        # Liegen im Paket (versehentlich) eigene Laufzeitdateien, duerfen sie
        # die des Servers nicht ersetzen.
        write(self.src, "arcade.db", "Entwickler-DB")
        write(self.src, "arcade.conf", "PORT=1\n")
        write(self.src, "data/arcade.db", "Entwickler-DB")
        self.assertSynced()
        for rel, content in self.RUNTIME.items():
            self.assertEqual(read(self.dst, rel), content, rel)
        self.assertEqual(read(self.dst, "app.py"), "print('app')\n")

    def test_wads_are_protected_in_any_spelling(self):
        write(self.dst, "app.py")
        write(self.dst, "static/doom/DOOM1.WAD", "eigene WAD")
        write(self.dst, "static/doom/doom2.wad", "eigene WAD 2")
        write(self.src, "static/doom/doom2.wad", "WAD aus dem Paket")
        self.assertSynced()
        self.assertEqual(read(self.dst, "static/doom/DOOM1.WAD"), "eigene WAD")
        self.assertEqual(read(self.dst, "static/doom/doom2.wad"), "eigene WAD 2")
        names = os.listdir(os.path.join(self.dst, "static", "doom"))
        self.assertIn("DOOM1.WAD", names)
        self.assertNotIn("doom1.wad", names)

    def test_protected_files_keep_a_target_only_dir(self):
        # Ein kuenftiger Stand ohne static/doom: Die eigene WAD bleibt, der
        # Rest des Ordners geht, der Ordner selbst bleibt deshalb stehen.
        shutil.rmtree(os.path.join(self.src, "static", "doom"))
        write(self.dst, "app.py")
        write(self.dst, "static/doom/doom1.wad", "eigene WAD")
        write(self.dst, "static/doom/websockets-doom.js", "alt")
        write(self.dst, "static/doom/sub/alt.txt", "alt")
        self.assertSynced()
        self.assertEqual(read(self.dst, "static/doom/doom1.wad"), "eigene WAD")
        self.assertEqual({p for p in files(self.dst) if p.startswith("static/doom/")},
                         {"static/doom/doom1.wad"})

    def test_target_with_only_protected_entries_is_accepted(self):
        # Zustand nach einer Deinstallation, die die Daten behalten hat.
        write(self.dst, "data/arcade.db", "accounts")
        write(self.dst, "arcade.conf", "PORT=5052\n")
        self.assertSynced()
        self.assertEqual(read(self.dst, "data/arcade.db"), "accounts")
        self.assertEqual(read(self.dst, "arcade.conf"), "PORT=5052\n")
        self.assertIn("app.py", files(self.dst))


class CaseTest(SyncTestCase):
    def test_case_only_rename(self):
        write(self.dst, "app.py")
        write(self.dst, "Templates/BASE.html", "alt")
        write(self.dst, "static/Tetris.js", "alt")
        self.assertSynced()
        self.assertIn("templates", os.listdir(self.dst))
        self.assertNotIn("Templates", os.listdir(self.dst))
        self.assertEqual(os.listdir(os.path.join(self.dst, "templates")), ["base.html"])
        static = os.listdir(os.path.join(self.dst, "static"))
        self.assertIn("tetris.js", static)
        self.assertNotIn("Tetris.js", static)
        self.assertEqual(read(self.dst, "static/tetris.js"), "// tetris\n")


class SpecialFilesTest(SyncTestCase):
    def test_readonly_files_are_replaced_and_removed(self):
        self.assertSynced()
        target = os.path.join(self.dst, "static", "tetris.js")
        os.chmod(target, stat.S_IREAD)
        stale = write(self.dst, "static/alt.js")
        os.chmod(stale, stat.S_IREAD)
        path = write(self.src, "static/tetris.js", "// neu und laenger als vorher\n")
        later = os.stat(path).st_mtime + 100
        os.utime(path, (later, later))
        self.assertSynced()
        self.assertEqual(read(self.dst, "static/tetris.js"), "// neu und laenger als vorher\n")
        self.assertFalse(os.path.exists(stale))

    def test_symlinks_in_target_are_removed_not_followed(self):
        outside = os.path.join(self.tmp, "ausserhalb")
        write(outside, "wichtig.txt", "nicht anfassen")
        write(self.dst, "app.py")
        os.makedirs(os.path.join(self.dst, "static"), exist_ok=True)
        link = os.path.join(self.dst, "static", "verlinkt")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, NotImplementedError) as exc:
            self.skipTest("Symlinks hier nicht erlaubt: %s" % exc)
        self.assertSynced()
        self.assertFalse(os.path.lexists(link))
        self.assertEqual(read(outside, "wichtig.txt"), "nicht anfassen")

    def test_dry_run_changes_nothing(self):
        write(self.dst, "app.py", "alt")
        write(self.dst, "static/alt.js", "alt")
        write(self.dst, "arcade.db", "accounts")
        before = {rel: read(self.dst, rel) for rel in files(self.dst)}
        output = self.assertSynced("--dry-run")
        after = {rel: read(self.dst, rel) for rel in files(self.dst)}
        self.assertEqual(before, after)
        self.assertIn("kopieren: static/tetris.js", output)
        self.assertIn("loeschen: static/alt.js", output)
        self.assertIn("Probelauf", output)
        self.assertNotIn("arcade.db", output.split("Nicht angefasst")[0])

    def test_dry_run_on_fresh_target_creates_nothing(self):
        self.assertSynced("--dry-run")
        self.assertFalse(os.path.exists(self.dst))


class SafetyTest(SyncTestCase):
    """Nur safety_problem() selbst - nie ein echter Lauf gegen / oder ~."""

    def test_accepts_new_and_existing_installation(self):
        self.assertIsNone(sync.safety_problem(self.src, self.dst))
        write(self.dst, "app.py")
        self.assertIsNone(sync.safety_problem(self.src, self.dst))

    def test_refuses_dangerous_targets(self):
        cases = {
            "Wurzel": os.path.abspath(os.sep),
            "Benutzerordner": os.path.expanduser("~"),
            "Quelle selbst": self.src,
            "in der Quelle": os.path.join(self.src, "unterordner"),
            "um die Quelle herum": self.tmp,
        }
        for label, target in cases.items():
            with self.subTest(target=label):
                self.assertIsNotNone(sync.safety_problem(self.src, target))

    def test_refuses_foreign_non_empty_target(self):
        write(self.dst, "meine_dokumente.txt", "fremd")
        self.assertIn("kein app.py", sync.safety_problem(self.src, self.dst))
        code, output = self.run_sync()
        self.assertEqual(code, 2)
        self.assertIn("ABGELEHNT", output)
        self.assertEqual(files(self.dst), {"meine_dokumente.txt"})

    def test_refuses_source_without_app(self):
        os.remove(os.path.join(self.src, "app.py"))
        self.assertIn("kein app.py", sync.safety_problem(self.src, self.dst))

    def test_refusal_changes_nothing(self):
        target = os.path.join(self.src, "unterordner")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = sync.main([self.src, target])
        self.assertEqual(code, 2)
        self.assertFalse(os.path.exists(target))


if __name__ == "__main__":
    unittest.main()
