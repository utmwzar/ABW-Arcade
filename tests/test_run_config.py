"""run.py: Einstellungen und Exit-Codes.

Rangfolge: Umgebung vor arcade.conf vor Standardwerten. arcade.conf kommt
unter Windows von PowerShell 5.1 und hat dann oft ein BOM und CRLF.
Exit-Code 78 heisst "Einstellung ungueltig oder Port belegt" - darauf
verlassen sich die Dienste (systemd startet dann nicht endlos neu) und die
Installer (Port-Pruefung vor dem Start).

Die Tests laufen unter Linux, macOS und Windows.
"""

import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUN_PY = os.path.join(ROOT, "run.py")

_spec = importlib.util.spec_from_file_location("abw_arcade_run", RUN_PY)
run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run)


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def clean_env(**extra):
    """Umgebung ohne ARCADE_*-Variablen des Aufrufers."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("ARCADE_")}
    env["PYTHONIOENCODING"] = "utf-8"
    env.update(extra)
    return env


class LoadConfigTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="abw-run-test-")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def write_conf(self, data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        with open(os.path.join(self.dir, "arcade.conf"), "wb") as fh:
            fh.write(data)

    def load(self, **env):
        return run.load_config(environ=env, app_dir=self.dir)

    def test_defaults(self):
        cfg = self.load()
        self.assertEqual((cfg.host, cfg.port, cfg.threads), ("0.0.0.0", 5000, 8))
        self.assertIsNone(cfg.data_dir)
        self.assertEqual(cfg.effective_data_dir, run.APP_DIR)
        self.assertFalse(cfg.conf_found)
        self.assertEqual(set(cfg.sources.values()), {"Standard"})

    def test_conf_beats_defaults(self):
        self.write_conf("HOST=127.0.0.1\nPORT=5050\nTHREADS=4\nDATA_DIR=daten\n")
        cfg = self.load()
        self.assertEqual((cfg.host, cfg.port, cfg.threads), ("127.0.0.1", 5050, 4))
        # relativ in arcade.conf heisst: relativ zum Programmordner
        self.assertEqual(cfg.data_dir, os.path.join(self.dir, "daten"))
        self.assertEqual(cfg.sources["PORT"], "arcade.conf:2")

    def test_env_beats_conf(self):
        self.write_conf("HOST=127.0.0.1\nPORT=5050\nTHREADS=4\nDATA_DIR=daten\n")
        data = os.path.join(self.dir, "anderswo")
        cfg = self.load(ARCADE_HOST="0.0.0.0", ARCADE_PORT="6000",
                        ARCADE_THREADS="2", ARCADE_DATA_DIR=data)
        self.assertEqual((cfg.host, cfg.port, cfg.threads), ("0.0.0.0", 6000, 2))
        self.assertEqual(cfg.data_dir, data)
        self.assertEqual(cfg.sources["PORT"], "ARCADE_PORT")

    def test_empty_env_falls_back_to_conf(self):
        self.write_conf("PORT=5050\n")
        self.assertEqual(self.load(ARCADE_PORT="").port, 5050)
        self.assertEqual(self.load(ARCADE_PORT="   ").port, 5050)

    def test_bom_and_crlf_from_powershell(self):
        self.write_conf(b"\xef\xbb\xbfPORT=5052\r\nTHREADS=3\r\nDATA_DIR=C:\\ProgramData\\ABW-Arcade\\data\r\n")
        cfg = self.load()
        self.assertEqual((cfg.port, cfg.threads), (5052, 3))
        self.assertTrue(cfg.data_dir.endswith("data"))
        self.assertEqual(cfg.warnings, [])

    def test_comments_spacing_quotes_and_case(self):
        self.write_conf("# PORT=1\n\n  port = \"6002\"  \nThreads='5'\n# Ende\n")
        cfg = self.load()
        self.assertEqual((cfg.port, cfg.threads), (6002, 5))

    def test_last_line_wins_and_empty_value_unsets(self):
        self.write_conf("PORT=6001\nPORT=6002\nTHREADS=4\nTHREADS=\n")
        cfg = self.load()
        self.assertEqual((cfg.port, cfg.threads), (6002, 8))

    def test_invalid_values_are_errors(self):
        for line in ("PORT=abc", "PORT=0", "PORT=70000", "PORT=5000.0", "PORT=-1",
                     "PORT=5_000", "THREADS=0", "THREADS=viele", "THREADS=100000"):
            with self.subTest(line=line):
                self.write_conf(line + "\n")
                with self.assertRaises(run.ConfigError) as ctx:
                    self.load()
                self.assertIn("arcade.conf:1", str(ctx.exception))

    def test_invalid_env_names_the_variable(self):
        with self.assertRaises(run.ConfigError) as ctx:
            self.load(ARCADE_PORT="achtzig")
        self.assertIn("ARCADE_PORT", str(ctx.exception))

    def test_overridden_invalid_conf_value_does_not_matter(self):
        self.write_conf("PORT=abc\n")
        self.assertEqual(self.load(ARCADE_PORT="6003").port, 6003)

    def test_unknown_keys_and_broken_lines_warn(self):
        self.write_conf("PROT=8080\nnur text\nPORT=6004\n")
        cfg = self.load()
        self.assertEqual(cfg.port, 6004)
        self.assertEqual(len(cfg.warnings), 2)
        self.assertIn("PROT", cfg.warnings[0])

    def test_not_utf8_is_an_error(self):
        self.write_conf(b"DATA_DIR=C:\\Sch\xfcler\n")
        with self.assertRaises(run.ConfigError):
            self.load()


class CommandLineTest(unittest.TestCase):
    """check und serve als echte Prozesse, mit einer Kopie von run.py in
    einem eigenen Ordner - samt eigener arcade.conf und ohne app.py."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="abw-run-cli-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        shutil.copy(RUN_PY, self.dir)

    def write_conf(self, text):
        with open(os.path.join(self.dir, "arcade.conf"), "w", encoding="utf-8") as fh:
            fh.write(text)

    def run_cli(self, *args, **env):
        return subprocess.run(
            [sys.executable, os.path.join(self.dir, "run.py")] + list(args),
            env=clean_env(**env), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            encoding="utf-8", errors="replace", timeout=60)

    def busy_port(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(sock.close)
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return sock.getsockname()[1]

    def test_check_free_port(self):
        port = free_port()
        self.write_conf("HOST=127.0.0.1\nPORT=%d\n" % port)
        result = self.run_cli("check")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Port %d ist frei" % port, result.stdout)
        self.assertIn("arcade.conf:2", result.stdout)

    def test_check_busy_port(self):
        port = self.busy_port()
        self.write_conf("HOST=127.0.0.1\nPORT=%d\n" % port)
        result = self.run_cli("check")
        self.assertEqual(result.returncode, 78, result.stdout)
        self.assertIn("Port %d ist belegt oder reserviert" % port, result.stdout)

    def test_env_beats_conf_on_the_command_line(self):
        busy = self.busy_port()
        self.write_conf("HOST=127.0.0.1\nPORT=%d\n" % busy)
        result = self.run_cli("check", ARCADE_PORT=str(free_port()))
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_invalid_config_exits_78(self):
        self.write_conf("PORT=abc\n")
        for args in (("check",), ()):
            with self.subTest(args=args):
                result = self.run_cli(*args)
                self.assertEqual(result.returncode, 78, result.stdout)
                self.assertIn("abc", result.stdout)

    def test_serve_on_busy_port_exits_78_before_loading_the_app(self):
        # In diesem Ordner gibt es kein app.py: Kaeme run.py bis zum Import,
        # endete es mit 1 statt 78.
        port = self.busy_port()
        result = self.run_cli("serve", ARCADE_HOST="127.0.0.1", ARCADE_PORT=str(port))
        self.assertEqual(result.returncode, 78, result.stdout)
        self.assertIn("Port %d ist belegt oder reserviert" % port, result.stdout)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "secret_key")))


class ServeTest(unittest.TestCase):
    """Der echte Server: antwortet auf /healthz, und ein zweiter Start auf
    demselben Port scheitert mit 78 - unter Windows nur dank
    SO_EXCLUSIVEADDRUSE."""

    def test_serve_and_refuse_second_instance(self):
        data = tempfile.mkdtemp(prefix="abw-run-serve-")
        self.addCleanup(shutil.rmtree, data, True)
        port = free_port()
        env = clean_env(ARCADE_HOST="127.0.0.1", ARCADE_PORT=str(port),
                        ARCADE_THREADS="2", ARCADE_DATA_DIR=data)
        log_path = os.path.join(data, "serve.log")
        with open(log_path, "w", encoding="utf-8") as log:
            proc = subprocess.Popen([sys.executable, RUN_PY], env=env,
                                    stdout=log, stderr=subprocess.STDOUT)
        try:
            body = self.wait_for_healthz(port, proc, log_path)
            self.assertEqual(body, {"ok": True})
            second = subprocess.run([sys.executable, RUN_PY], env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    encoding="utf-8", errors="replace", timeout=60)
            self.assertEqual(second.returncode, 78, second.stdout)
            self.assertIn("belegt oder reserviert", second.stdout)
            # Auch ein fremdes Programm mit SO_REUSEADDR - so bindet waitress
            # selbst - kommt nicht dazwischen. Unter Windows haelt das nur,
            # solange der Socket des Servers exklusiv bleibt, auch nachdem
            # waitress auf ihm noch SO_REUSEADDR zu setzen versucht hat.
            intruder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                intruder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                with self.assertRaises(OSError):
                    intruder.bind(("127.0.0.1", port))
            finally:
                intruder.close()
            # Der erste laeuft unbeirrt weiter.
            self.assertEqual(self.get_json(port), {"ok": True})
        finally:
            proc.terminate()
            proc.wait(timeout=30)

    @staticmethod
    def get_json(port):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:%d/healthz" % port, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def wait_for_healthz(self, port, proc, log_path):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                break
            try:
                return self.get_json(port)
            except OSError:
                time.sleep(0.3)
        with open(log_path, encoding="utf-8", errors="replace") as fh:
            self.fail("Server kam nicht hoch (Exit %s):\n%s" % (proc.poll(), fh.read()))


if __name__ == "__main__":
    unittest.main()
