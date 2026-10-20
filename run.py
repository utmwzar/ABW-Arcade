#!/usr/bin/env python3
"""ABW Arcade - Startpunkt fuer den Dienst und fuer die Verwaltung.

    python run.py                    Server starten (so laeuft auch der Dienst)
    python run.py serve              dasselbe
    python run.py check              Einstellungen zeigen, pruefen ob der Port frei ist
    python run.py make-admin NAME    einem registrierten Account Adminrechte geben

Alle Befehle lesen dieselben Einstellungen, in dieser Rangfolge:

1. Umgebungsvariablen ARCADE_HOST, ARCADE_PORT, ARCADE_THREADS, ARCADE_DATA_DIR
2. arcade.conf im Programmordner: Zeilen KEY=VALUE mit den Schluesseln HOST,
   PORT, THREADS und DATA_DIR; Zeilen mit # am Anfang sind Kommentare
3. Standardwerte: HOST 0.0.0.0, PORT 5000, THREADS 8, Daten im Programmordner

Warum nicht einfach waitress-serve? Drei Gruende:

- Die Installer fuer Linux, macOS und Windows schreiben den Port in
  arcade.conf. Der Dienst selbst startet immer gleich, ohne Argumente.
- make-admin muss dieselbe Datenbank treffen wie der Dienst. Deshalb setzt
  dieses Skript ARCADE_DATA_DIR, BEVOR es die App importiert; app.py legt
  arcade.db und secret_key schon beim Import an.
- Ein belegter Port soll laut scheitern, nicht still. waitress setzt immer
  SO_REUSEADDR, und unter Windows heisst das: Ein zweiter Prozess bindet
  denselben Port ohne Fehler, und welcher die Anfragen bekommt, ist Zufall.
  Hier wird der Socket deshalb selbst gebunden, unter Windows exklusiv
  (SO_EXCLUSIVEADDRUSE), und erst dann an waitress uebergeben.

Exit-Code 78 (EX_CONFIG aus sysexits.h) heisst: Einstellung ungueltig oder
Port belegt. Ein Neustart aendert daran nichts; die systemd-Unit startet
deshalb bei 78 nicht neu (RestartPreventExitStatus=78).

Laeuft mit Python 3.9 (Debian 11), also ohne match und ohne X | Y.
"""

import argparse
import errno
import logging
import os
import re
import signal
import socket
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONF_NAME = "arcade.conf"
EXIT_CONFIG = 78

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 5000
DEFAULT_THREADS = 8
MAX_THREADS = 1000

KEYS = ("HOST", "PORT", "THREADS", "DATA_DIR")
ENV_PREFIX = "ARCADE_"
SOURCE_DEFAULT = "Standard"

log = logging.getLogger("abw-arcade")


class ConfigError(Exception):
    """Ungueltige Einstellung - damit startet der Dienst nicht."""


class PortError(Exception):
    """Der Port liess sich nicht binden. cause ist der OSError von bind()."""

    def __init__(self, port, cause):
        Exception.__init__(self, "Port %d ist belegt oder reserviert (%s)"
                           % (port, cause.strerror or cause))
        self.port = port
        self.cause = cause


class Config(object):
    """Die wirksamen Einstellungen samt Herkunft jedes Werts."""

    def __init__(self, host, port, threads, data_dir, sources, conf_path,
                 conf_found, warnings):
        self.host = host
        self.port = port
        self.threads = threads
        self.data_dir = data_dir          # None = Programmordner (wie bisher)
        self.sources = sources            # KEY -> "Standard", "ARCADE_PORT", "arcade.conf:3"
        self.conf_path = conf_path
        self.conf_found = conf_found
        self.warnings = warnings

    @property
    def effective_data_dir(self):
        return self.data_dir or APP_DIR


# --------------------------------------------------------------------------
# Einstellungen
# --------------------------------------------------------------------------
def read_conf(path):
    """Liest arcade.conf. Gibt ({KEY: (Wert, Herkunft)}, Warnungen) zurueck.

    utf-8-sig, weil Windows PowerShell 5.1 Textdateien gern mit BOM schreibt.
    Leere Werte zaehlen als nicht gesetzt; kommt ein Schluessel mehrfach vor,
    gilt die letzte Zeile.
    """
    values = {}
    warnings = []
    try:
        with open(path, "r", encoding="utf-8-sig") as fh:
            lines = fh.read().splitlines()
    except FileNotFoundError:
        return values, warnings
    except UnicodeDecodeError:
        raise ConfigError("%s ist nicht als UTF-8 gespeichert." % path)
    except OSError as exc:
        raise ConfigError("%s laesst sich nicht lesen: %s" % (path, exc))

    for number, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        where = "%s:%d" % (CONF_NAME, number)
        if "=" not in line:
            warnings.append("%s: Zeile ohne '=' wird ignoriert: %s" % (where, line))
            continue
        key, value = line.split("=", 1)
        key = key.strip().upper()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1].strip()
        if key not in KEYS:
            warnings.append("%s: unbekannter Schluessel %s wird ignoriert (erlaubt: %s)"
                            % (where, key, ", ".join(KEYS)))
            continue
        if value:
            values[key] = (value, where)
        else:
            values.pop(key, None)
    return values, warnings


def _as_int(raw, source, label, low, high):
    if not re.match(r"^[0-9]+$", raw):
        raise ConfigError("%s '%s' (aus %s) ist keine ganze Zahl; erlaubt ist %d bis %d."
                          % (label, raw, source, low, high))
    value = int(raw)
    if not low <= value <= high:
        raise ConfigError("%s %d (aus %s) liegt ausserhalb von %d bis %d."
                          % (label, value, source, low, high))
    return value


def load_config(environ=None, app_dir=None):
    """Ermittelt die wirksamen Einstellungen. Wirft ConfigError."""
    environ = os.environ if environ is None else environ
    app_dir = APP_DIR if app_dir is None else app_dir
    conf_path = os.path.join(app_dir, CONF_NAME)
    conf, warnings = read_conf(conf_path)

    raw = {}
    sources = {}
    for key in KEYS:
        env_name = ENV_PREFIX + key
        env_value = environ.get(env_name)
        if env_value is not None and env_value.strip():
            raw[key], sources[key] = env_value.strip(), env_name
        elif key in conf:
            raw[key], sources[key] = conf[key]
        else:
            raw[key], sources[key] = None, SOURCE_DEFAULT

    host = raw["HOST"] or DEFAULT_HOST
    port = DEFAULT_PORT if raw["PORT"] is None else _as_int(
        raw["PORT"], sources["PORT"], "Port", 1, 65535)
    threads = DEFAULT_THREADS if raw["THREADS"] is None else _as_int(
        raw["THREADS"], sources["THREADS"], "Threads", 1, MAX_THREADS)

    data_dir = None
    if raw["DATA_DIR"] is not None:
        # Relativ in arcade.conf: zum Programmordner. Relativ in der
        # Umgebungsvariable: zum aktuellen Ordner, so wie app.py es liest.
        base = os.getcwd() if sources["DATA_DIR"].startswith(ENV_PREFIX) else app_dir
        data_dir = os.path.abspath(os.path.join(base, os.path.expanduser(raw["DATA_DIR"])))

    return Config(host, port, threads, data_dir, sources, conf_path,
                  os.path.isfile(conf_path), warnings)


def export_data_dir(cfg):
    """Vor `import app` aufrufen: app.py liest ARCADE_DATA_DIR beim Import."""
    if cfg.data_dir:
        os.environ["ARCADE_DATA_DIR"] = cfg.data_dir
    else:
        os.environ.pop("ARCADE_DATA_DIR", None)


# --------------------------------------------------------------------------
# Socket
# --------------------------------------------------------------------------
def bind_socket(host, port):
    """Bindet und oeffnet den Server-Socket. Wirft PortError/ConfigError.

    Unter Windows exklusiv: Dort erlaubt SO_REUSEADDR einem zweiten Prozess,
    denselben Port still mitzubenutzen. SO_EXCLUSIVEADDRUSE verbietet genau
    das, und zwar auch dann, wenn waitress spaeter noch SO_REUSEADDR setzt
    (das scheitert dann, und waitress ignoriert den Fehler). Unter Linux und
    macOS ist SO_REUSEADDR richtig: Es erlaubt nur den schnellen Neustart,
    solange alte Verbindungen noch in TIME_WAIT haengen.
    """
    try:
        infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM, 0, socket.AI_PASSIVE)
    except (socket.gaierror, UnicodeError) as exc:
        raise ConfigError("HOST '%s' ist keine gueltige Adresse: %s" % (host, exc))
    family, socktype, proto, _canon, address = infos[0]
    sock = socket.socket(family, socktype, proto)
    try:
        exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
        if os.name == "nt" and exclusive is not None:
            sock.setsockopt(socket.SOL_SOCKET, exclusive, 1)
        else:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(address)
        sock.listen(1024)
    except OSError as exc:
        sock.close()
        raise PortError(port, exc)
    return sock


def port_hint(port, cause):
    """Ein Satz, der beim belegten Port weiterhilft."""
    hints = ["Laeuft ABW Arcade schon (als Dienst)? Sonst belegt ein anderes "
             "Programm den Port; dann einen anderen in arcade.conf eintragen "
             "(PORT=...) oder den Installer mit einem anderen Port aufrufen."]
    if sys.platform == "darwin" and port == 5000:
        hints.append("Unter macOS belegt der AirPlay-Empfaenger Port 5000 "
                     "(Systemeinstellungen > Allgemein > AirDrop & Handoff).")
    if os.name == "nt":
        hints.append("Windows reserviert ausserdem ganze Portbereiche (Hyper-V, WSL): "
                     "netsh interface ipv4 show excludedportrange protocol=tcp")
    elif port < 1024 and getattr(cause, "errno", None) == errno.EACCES:
        hints.append("Ports unter 1024 darf nur root binden.")
    return " ".join(hints)


# --------------------------------------------------------------------------
# Befehle
# --------------------------------------------------------------------------
def warn_foreign_owner(data_dir, stream=None):
    """Als root gestartet, der Datenordner gehoert aber jemand anderem: Dann
    gehoerten neu angelegte Dateien (arcade.db, secret_key, Journal) root, und
    der Dienst koennte sie danach nicht mehr schreiben."""
    stream = stream if stream is not None else sys.stderr
    if os.name != "posix" or not hasattr(os, "geteuid") or os.geteuid() != 0:
        return False
    try:
        owner = os.stat(data_dir).st_uid
    except OSError:
        return False
    if owner == 0:
        return False
    try:
        import pwd
        name = pwd.getpwuid(owner).pw_name
    except (ImportError, KeyError):
        name = str(owner)
    stream.write(
        "WARNUNG: run.py laeuft als root, der Datenordner %s gehoert aber '%s'.\n"
        "         Neu angelegte Dateien gehoeren dann root, und der Dienst kann\n"
        "         sie nicht mehr schreiben. Besser: sudo -u %s %s %s ...\n"
        % (data_dir, name, name, sys.executable, os.path.join(APP_DIR, "run.py")))
    return True


def load_app():
    """Importiert app.py. Erst nach export_data_dir() aufrufen."""
    if APP_DIR not in sys.path:
        sys.path.insert(0, APP_DIR)
    import app as arcade  # noqa: E402  (legt arcade.db und secret_key an)
    return arcade


def cmd_check(cfg):
    out = sys.stdout
    out.write("ABW Arcade - wirksame Einstellungen\n")
    out.write("  Programmordner: %s\n" % APP_DIR)
    out.write("  Einstellungen:  %s (%s)\n"
              % (cfg.conf_path, "vorhanden" if cfg.conf_found else "nicht vorhanden"))
    for key, value in (("HOST", cfg.host), ("PORT", cfg.port), ("THREADS", cfg.threads)):
        out.write("  %-9s= %-24s (%s)\n" % (key, value, cfg.sources[key]))
    if cfg.data_dir:
        out.write("  %-9s= %s (%s)\n" % ("DATA_DIR", cfg.data_dir, cfg.sources["DATA_DIR"]))
    else:
        out.write("  %-9s= %s (Standard: Programmordner)\n" % ("DATA_DIR", APP_DIR))
    db = os.path.join(cfg.effective_data_dir, "arcade.db")
    out.write("  Datenbank:      %s (%s)\n"
              % (db, "vorhanden" if os.path.exists(db) else "entsteht beim ersten Start"))
    out.write("  Python:         %s (%s)\n" % (sys.version.split()[0], sys.executable))
    for warning in cfg.warnings:
        out.write("WARNUNG: %s\n" % warning)
    try:
        sock = bind_socket(cfg.host, cfg.port)
    except PortError as exc:
        out.write("%s.\n%s\n" % (exc, port_hint(cfg.port, exc.cause)))
        return EXIT_CONFIG
    except ConfigError as exc:
        out.write("FEHLER: %s\n" % exc)
        return EXIT_CONFIG
    sock.close()
    out.write("Port %d ist frei.\n" % cfg.port)
    return 0


def cmd_make_admin(cfg, name):
    for warning in cfg.warnings:
        sys.stderr.write("WARNUNG: %s\n" % warning)
    export_data_dir(cfg)
    warn_foreign_owner(cfg.effective_data_dir)
    arcade = load_app()
    # Dieselbe Logik wie `flask --app app make-admin NAME`: der Befehl aus
    # app.py, nicht eine Kopie seines SQL.
    command = arcade.app.cli.commands.get("make-admin")
    if command is None:
        sys.stderr.write("FEHLER: app.py kennt den Befehl make-admin nicht.\n")
        return 1
    with arcade.app.app_context():
        try:
            command.main(args=[name], prog_name="run.py make-admin", standalone_mode=False)
        except SystemExit as exc:
            code = exc.code
            if code is None:
                return 0
            return code if isinstance(code, int) else 1
    return 0


def _stop_on_sigterm():
    """SIGTERM (systemctl stop, launchctl) als normales Ende behandeln: waitress
    faengt SystemExit ab, laesst laufende Anfragen fertig werden und kehrt
    zurueck."""
    def handler(_signum, _frame):
        raise SystemExit(0)
    try:
        signal.signal(signal.SIGTERM, handler)
    except (AttributeError, ValueError, OSError):
        pass


def cmd_serve(cfg):
    for warning in cfg.warnings:
        log.warning(warning)
    export_data_dir(cfg)
    if warn_foreign_owner(cfg.effective_data_dir, stream=sys.stderr):
        log.warning("Dateirechte pruefen, siehe oben.")

    # Erst den Port, dann die App: Ein belegter Port soll sofort und mit
    # klarer Meldung scheitern, bevor irgendetwas angelegt wird.
    try:
        sock = bind_socket(cfg.host, cfg.port)
    except PortError as exc:
        log.error("%s. %s", exc, port_hint(cfg.port, exc.cause))
        return EXIT_CONFIG
    except ConfigError as exc:
        log.error("%s", exc)
        return EXIT_CONFIG

    try:
        arcade = load_app()
        import waitress
    except Exception:
        log.exception("Die Anwendung liess sich nicht laden (Daten: %s).",
                      cfg.effective_data_dir)
        sock.close()
        return 1

    _stop_on_sigterm()
    shown_host = "<diese-maschine>" if cfg.host in ("0.0.0.0", "::") else cfg.host
    log.info("ABW Arcade startet: http://%s:%d  (Threads: %d, Daten: %s)",
             shown_host, cfg.port, cfg.threads, cfg.effective_data_dir)
    waitress.serve(arcade.app, sockets=[sock], threads=cfg.threads, ident="ABW-Arcade")
    log.info("ABW Arcade beendet.")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="run.py",
        description="ABW Arcade starten und verwalten. Ohne Befehl: serve.")
    sub = parser.add_subparsers(dest="command", metavar="BEFEHL")
    sub.add_parser("serve", help="Server starten (Standard; so laeuft auch der Dienst)")
    sub.add_parser("check", help="Einstellungen anzeigen und pruefen, ob der Port frei ist")
    admin = sub.add_parser("make-admin", help="einem registrierten Account Adminrechte geben")
    admin.add_argument("name", metavar="NAME", help="Username des Accounts")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    command = args.command or "serve"

    if command == "serve":
        logging.basicConfig(level=logging.INFO,
                            format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        cfg = load_config()
    except ConfigError as exc:
        if command == "serve":
            log.error("%s", exc)
        else:
            sys.stderr.write("FEHLER: %s\n" % exc)
        return EXIT_CONFIG

    if command == "check":
        return cmd_check(cfg)
    if command == "make-admin":
        return cmd_make_admin(cfg, args.name)
    return cmd_serve(cfg)


if __name__ == "__main__":
    sys.exit(main())
