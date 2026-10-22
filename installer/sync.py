#!/usr/bin/env python3
"""ABW Arcade - Programmdateien in den Installationsordner spiegeln.

    python installer/sync.py QUELLE ZIEL [--dry-run]

Macht, was frueher `rsync -a --delete` mit einer Liste von Ausschluessen
erledigt hat, aber auf Linux, macOS und Windows gleich und ohne rsync. Alle
drei Installer rufen dieses Skript auf; die Listen unten gelten damit
ueberall.

- Neue und geaenderte Dateien (andere Groesse oder anderer Zeitstempel)
  werden nach ZIEL kopiert, erst in eine temporaere Datei und dann per
  os.replace an ihren Platz. Ein abgebrochener Lauf hinterlaesst so nie eine
  halb geschriebene Programmdatei.
- Was in ZIEL liegt, aber nicht mehr in QUELLE, wird geloescht (etwa das
  JavaScript eines entfernten Spiels).
- AUSGESCHLOSSENES wird weder kopiert noch geloescht: Entwicklungsdateien,
  die nicht auf einen Server gehoeren, und Zwischenstaende wie __pycache__.
- GESCHUETZTES in ZIEL wird nie geloescht und nie ueberschrieben: die
  Laufzeitdaten (arcade.db, secret_key), die Einstellungen (arcade.conf), das
  Virtualenv, die Daten-, Log- und Dienstordner und selbst abgelegte
  DOOM-WADs. Das README fordert ausdruecklich dazu auf, eigene WADs nach
  static/doom/ zu legen; ohne den Schutz raeumte jedes Update sie weg.

Gross- und Kleinschreibung zaehlen beim Abgleich nicht. NTFS und APFS
unterscheiden sie standardmaessig nicht: Ein DOOM1.WAD ist dort dieselbe
Datei wie doom1.wad und muss genauso geschuetzt sein. Weicht nur die
Schreibweise ab, wird umbenannt statt geloescht und neu kopiert.

Symbolische Links (und unter Windows Verzeichnis-Junctions) werden nie
verfolgt: In ZIEL wird nur der Link selbst entfernt, nie das, worauf er
zeigt.

Laeuft mit Python 3.9 (Debian 11), also ohne match und ohne X | Y.
Exit-Code: 0 = in Ordnung, 1 = Fehler beim Abgleich, 2 = abgelehnt.
"""

import argparse
import os
import shutil
import stat
import sys
import tempfile
import time
import unicodedata

# Namen, die in jeder Tiefe ausgeschlossen sind - egal ob Datei oder Ordner.
# (.git ist in einem git-worktree eine Datei, kein Ordner.)
EXCLUDE_NAMES = (
    ".git", ".venv", "__pycache__", "node_modules", ".github", ".claude",
    ".vscode", ".idea", ".pytest_cache", ".gitignore", ".gitattributes",
    ".DS_Store", "Thumbs.db", "desktop.ini",
)
EXCLUDE_SUFFIXES = (".pyc", ".pyo", ".swp")

# Nur direkt im Programmordner ausgeschlossen: Installer, Werkzeuge,
# Unterlagen fuer die Entwicklung und die Pakete selbst.
EXCLUDE_ROOT = (
    "install.sh", "install.cmd", "install.ps1", "paket-bauen.sh",
    "pruefe-engines.js", "pruefe_engines.py", "installer", "tests", "docs", "werkzeuge",
    "abw-arcade.tar.gz", "abw-arcade.zip",
)

# Geschuetzt im Programmordner (samt allem, was darin liegt).
PROTECT_ROOT = (
    "arcade.db", "arcade.db-journal", "arcade.db-wal", "arcade.db-shm",
    "secret_key", "arcade.conf", ".venv", "data", "logs", "service",
)
# Geschuetzte einzelne Pfade unterhalb des Programmordners.
PROTECT_PATHS = (
    ("static", "doom", "doom1.wad"),
    ("static", "doom", "doom2.wad"),
)

# Toleranz beim Zeitstempelvergleich. FAT speichert nur auf 2 Sekunden genau,
# ZIP-Archive ebenso.
MTIME_TOLERANCE = 2.0

IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003  # Windows-Junction


def fold(name):
    """Vergleichsschluessel fuer einen Namen: Schreibweise egal, Unicode
    einheitlich normalisiert (macOS liefert Umlaute zerlegt)."""
    return unicodedata.normalize("NFC", name).casefold()


_EXCLUDE_NAMES = frozenset(fold(n) for n in EXCLUDE_NAMES)
_EXCLUDE_ROOT = frozenset(fold(n) for n in EXCLUDE_ROOT)
_PROTECT_ROOT = frozenset(fold(n) for n in PROTECT_ROOT)
_PROTECT_PATHS = frozenset(tuple(fold(p) for p in path) for path in PROTECT_PATHS)


def is_excluded(parts):
    """parts: Pfad relativ zum Programmordner als Tupel von Namen."""
    name = fold(parts[-1])
    if name in _EXCLUDE_NAMES or name.endswith(EXCLUDE_SUFFIXES):
        return True
    return len(parts) == 1 and name in _EXCLUDE_ROOT


def is_protected(parts):
    key = tuple(fold(p) for p in parts)
    if len(key) == 1 and key[0] in _PROTECT_ROOT:
        return True
    return key in _PROTECT_PATHS


def is_kept(parts):
    """Ausgeschlossen oder geschuetzt: wird weder angelegt noch entfernt."""
    return is_excluded(parts) or is_protected(parts)


def show(parts):
    return "/".join(parts)


# --------------------------------------------------------------------------
# Sicherheit: nie in einen Ordner spiegeln, in dem das Loeschen Schaden
# anrichtet.
# --------------------------------------------------------------------------
def _key(path):
    return fold(os.path.normcase(os.path.realpath(path)))


def _home_dirs():
    """(Benutzerordner, Ordner, in denen Benutzerordner liegen)"""
    homes = set()
    for raw in (os.path.expanduser("~"), os.environ.get("HOME"),
                os.environ.get("USERPROFILE"), "/root", "/var/root"):
        if raw and raw != "~":
            homes.add(_key(raw))
    bases = set()
    for raw in ("/home", "/Users", "/var/home",
                os.environ.get("SystemDrive", "C:") + "\\Users"):
        bases.add(_key(raw))
    return homes, bases


def safety_problem(src, dst):
    """Gibt einen Grund zurueck, warum nicht gespiegelt werden darf, sonst
    None. Prueft nur, veraendert nichts."""
    if not os.path.isdir(src):
        return "Quelle %s ist kein Ordner." % src
    if not os.path.isfile(os.path.join(src, "app.py")):
        return "Quelle %s enthaelt kein app.py - das ist nicht das ABW-Arcade-Paket." % src

    dst_real = os.path.realpath(dst)
    if os.path.dirname(dst_real) == dst_real:
        return "Ziel %s ist die Wurzel eines Laufwerks bzw. Dateisystems." % dst
    s_key, d_key = _key(src), _key(dst)
    sep = fold(os.sep)
    if d_key == s_key:
        return "Ziel und Quelle sind derselbe Ordner (%s)." % dst
    if d_key.startswith(s_key.rstrip(sep) + sep):
        return "Ziel %s liegt innerhalb der Quelle %s." % (dst, src)
    if s_key.startswith(d_key.rstrip(sep) + sep):
        return ("Quelle %s liegt innerhalb des Ziels %s. Das Paket bitte "
                "ausserhalb des Installationsordners entpacken." % (src, dst))
    homes, bases = _home_dirs()
    if d_key in homes or os.path.dirname(d_key) in bases or d_key in bases:
        return "Ziel %s ist ein Benutzerordner." % dst

    if os.path.lexists(dst):
        if os.path.islink(dst) and not os.path.isdir(dst):
            return "Ziel %s ist ein Link, aber kein Ordner." % dst
        if not os.path.isdir(dst):
            return "Ziel %s ist eine Datei, kein Ordner." % dst
        names = os.listdir(dst)
        if names and not any(fold(n) == "app.py" for n in names):
            fremd = sorted(n for n in names if not is_kept((n,)))
            if fremd:
                return ("Ziel %s ist nicht leer und enthaelt kein app.py, ist also "
                        "keine ABW-Arcade-Installation (gefunden u. a.: %s)."
                        % (dst, ", ".join(fremd[:5])))
    return None


# --------------------------------------------------------------------------
# Dateisystem-Helfer
# --------------------------------------------------------------------------
def _lstat(path):
    try:
        return os.lstat(path)
    except FileNotFoundError:
        return None


def _is_link(st):
    """Symlink oder (Windows) Junction - in beiden Faellen nie folgen."""
    if stat.S_ISLNK(st.st_mode):
        return True
    return getattr(st, "st_reparse_tag", 0) == IO_REPARSE_TAG_MOUNT_POINT


def _kind(st):
    if st is None:
        return None
    if _is_link(st):
        return "link"
    if stat.S_ISDIR(st.st_mode):
        return "dir"
    if stat.S_ISREG(st.st_mode):
        return "file"
    return "other"


def _make_writable(path):
    try:
        os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
    except OSError:
        pass


def _retry(action, path):
    """Unter Windows: schreibgeschuetzte Dateien beschreibbar machen und es
    erneut versuchen; kurz gesperrte Dateien (Virenscanner, Indexer) noch
    einmal anfassen."""
    for attempt in range(5):
        try:
            return action()
        except PermissionError:
            if os.name != "nt" or attempt == 4:
                raise
            _make_writable(path)
            time.sleep(0.2 * (attempt + 1))


def _remove_link(path):
    try:
        os.unlink(path)
    except OSError:
        os.rmdir(path)  # Windows: Verzeichnis-Link/Junction


def _remove_file(path):
    _retry(lambda: os.unlink(path), path)


def _remove_dir(path):
    _retry(lambda: os.rmdir(path), path)


def _copy_file(src, dst):
    """Kopiert mit Inhalt, Rechten und Zeitstempel (copy2), erst in eine
    temporaere Datei neben dem Ziel, dann per os.replace an den Platz."""
    folder = os.path.dirname(dst)
    fd, tmp = tempfile.mkstemp(prefix=".sync-", suffix=".tmp", dir=folder)
    os.close(fd)
    try:
        shutil.copy2(src, tmp)
        _retry(lambda: os.replace(tmp, dst), dst)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _same_file(s_st, d_st):
    return (s_st.st_size == d_st.st_size
            and abs(s_st.st_mtime - d_st.st_mtime) <= MTIME_TOLERANCE)


# --------------------------------------------------------------------------
# Abgleich
# --------------------------------------------------------------------------
class Syncer(object):
    def __init__(self, src, dst, dry_run=False, out=None):
        self.src = src
        self.dst = dst
        self.dry_run = dry_run
        self.out = out if out is not None else sys.stdout
        self.copied = 0
        self.unchanged = 0
        self.deleted = 0
        self.renamed = 0
        self.dirs_created = 0
        self.kept = []          # geschuetzt/ausgeschlossen in ZIEL, nicht angefasst
        self.warnings = []
        self.errors = []

    # -- Ausgabe -----------------------------------------------------------
    def note(self, symbol, text):
        if self.dry_run:
            self.out.write("  %s %s\n" % (symbol, text))

    def warn(self, text):
        self.warnings.append(text)
        self.out.write("!! %s\n" % text)

    def fail(self, parts, exc):
        text = "%s: %s" % (show(parts) or ".", exc)
        self.errors.append(text)
        self.out.write("!! FEHLER bei %s\n" % text)

    # -- Durchlauf ---------------------------------------------------------
    def run(self):
        if not self.dry_run:
            os.makedirs(self.dst, exist_ok=True)
        self.sync_dir(self.src, self.dst, ())
        return not self.errors

    def list_src(self, folder, parts):
        """{name: kind} der Eintraege in QUELLE, ohne Ausgeschlossenes und
        Geschuetztes."""
        entries = {}
        seen = {}
        for name in sorted(os.listdir(folder)):
            child = parts + (name,)
            if is_kept(child):
                continue
            kind = _kind(_lstat(os.path.join(folder, name)))
            if kind in ("link", "other", None):
                self.warn("Uebersprungen (kein normaler Ordner bzw. keine normale "
                          "Datei): %s" % show(child))
                continue
            key = fold(name)
            if key in seen:
                self.fail(child, "unterscheidet sich von %s nur in der "
                                 "Schreibweise" % show(parts + (seen[key],)))
                continue
            seen[key] = name
            entries[name] = kind
        return entries

    def sync_dir(self, src_dir, dst_dir, parts):
        try:
            src_entries = self.list_src(src_dir, parts)
        except OSError as exc:
            self.fail(parts, exc)
            return
        dst_names = []
        if os.path.isdir(dst_dir):
            try:
                dst_names = sorted(os.listdir(dst_dir))
            except OSError as exc:
                self.fail(parts, exc)
                return
        by_key = {}
        for name in dst_names:
            by_key.setdefault(fold(name), []).append(name)

        matched = set()
        for name, kind in sorted(src_entries.items()):
            candidates = by_key.get(fold(name), [])
            if name in candidates:
                existing = name
            elif candidates:
                existing = candidates[0]
            else:
                existing = None
            if existing is not None:
                matched.add(existing)
            try:
                self.sync_entry(src_dir, dst_dir, parts, name, kind, existing)
            except OSError as exc:
                self.fail(parts + (name,), exc)

        for name in dst_names:
            if name in matched:
                continue
            child = parts + (name,)
            if is_kept(child):
                self.kept.append(show(child))
                continue
            self.delete(os.path.join(dst_dir, name), child)

    def sync_entry(self, src_dir, dst_dir, parts, name, kind, existing):
        child = parts + (name,)
        src_path = os.path.join(src_dir, name)
        dst_path = os.path.join(dst_dir, name)

        # Nur die Schreibweise weicht ab: umbenennen statt loeschen und neu
        # kopieren. Unter Windows und macOS waere es sonst dieselbe Datei.
        if existing is not None and existing != name:
            old_path = os.path.join(dst_dir, existing)
            self.note("~", "umbenennen: %s -> %s" % (show(parts + (existing,)), show(child)))
            if self.dry_run:
                dst_path = old_path
            else:
                os.rename(old_path, dst_path)
            self.renamed += 1

        d_st = _lstat(dst_path) if existing is not None else None
        d_kind = _kind(d_st)

        if kind == "dir":
            if d_kind not in (None, "dir"):
                if not self.delete(dst_path, child):
                    self.fail(child, "steht im Weg und liess sich nicht entfernen")
                    return
                d_kind = None
            if d_kind is None:
                self.note("+", "Ordner anlegen: %s/" % show(child))
                if not self.dry_run:
                    os.mkdir(dst_path)
                self.dirs_created += 1
            self.sync_dir(src_path, dst_path, child)
            return

        # kind == "file"
        s_st = os.stat(src_path)
        if d_kind == "file" and _same_file(s_st, d_st):
            self.unchanged += 1
            return
        if d_kind not in (None, "file"):
            if not self.delete(dst_path, child):
                self.fail(child, "steht im Weg und liess sich nicht entfernen")
                return
        self.note("+", "kopieren: %s" % show(child))
        if not self.dry_run:
            _copy_file(src_path, dst_path)
        self.copied += 1

    def delete(self, path, parts):
        """Entfernt einen Eintrag aus ZIEL. Ordner werden Eintrag fuer Eintrag
        geleert (kein rmtree); was darin geschuetzt oder ausgeschlossen ist,
        bleibt liegen, und dann bleibt auch der Ordner stehen. Gibt True
        zurueck, wenn der Eintrag weg ist - im Probelauf: weg waere."""
        kind = _kind(_lstat(path))
        if kind is None:
            return True
        try:
            if kind == "dir":
                complete = True
                for name in sorted(os.listdir(path)):
                    child = parts + (name,)
                    if is_kept(child):
                        self.kept.append(show(child))
                        complete = False
                    elif not self.delete(os.path.join(path, name), child):
                        complete = False
                if not complete:
                    self.note("=", "Ordner bleibt, darin liegt Geschuetztes: %s/" % show(parts))
                    return False
                self.note("-", "Ordner entfernen: %s/" % show(parts))
                if not self.dry_run:
                    _remove_dir(path)
            elif kind == "link":
                self.note("-", "Link entfernen: %s" % show(parts))
                if not self.dry_run:
                    _remove_link(path)
            else:
                self.note("-", "loeschen: %s" % show(parts))
                if not self.dry_run:
                    _remove_file(path)
        except OSError as exc:
            self.fail(parts, exc)
            return False
        self.deleted += 1
        return True

    def summary(self):
        lines = []
        prefix = "Probelauf, nichts geaendert: " if self.dry_run else ""
        lines.append("%s%d kopiert, %d unveraendert, %d entfernt, %d umbenannt, "
                     "%d Ordner neu" % (prefix, self.copied, self.unchanged,
                                        self.deleted, self.renamed, self.dirs_created))
        if self.kept:
            shown = sorted(set(self.kept))
            more = "" if len(shown) <= 8 else " und %d weitere" % (len(shown) - 8)
            lines.append("Nicht angefasst (geschuetzt oder ausgeschlossen): %s%s"
                         % (", ".join(shown[:8]), more))
        if self.errors:
            lines.append("%d Fehler - siehe oben." % len(self.errors))
        return lines


def sync(src, dst, dry_run=False, out=None):
    """Spiegelt src nach dst. Gibt den Syncer zurueck (Zaehler, Fehler).
    Wirft ValueError, wenn safety_problem() einen Grund findet."""
    problem = safety_problem(src, dst)
    if problem:
        raise ValueError(problem)
    syncer = Syncer(os.path.abspath(src), os.path.abspath(dst), dry_run=dry_run, out=out)
    syncer.run()
    return syncer


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="sync.py",
        description="ABW-Arcade-Programmdateien von QUELLE nach ZIEL spiegeln "
                    "(Laufzeitdaten und eigene WADs bleiben unangetastet).")
    parser.add_argument("src", metavar="QUELLE", help="entpacktes Paket bzw. git-Klon")
    parser.add_argument("dst", metavar="ZIEL", help="Installationsordner")
    parser.add_argument("--dry-run", action="store_true",
                        help="nur anzeigen, was passieren wuerde")
    args = parser.parse_args(argv)

    src = os.path.abspath(args.src)
    dst = os.path.abspath(args.dst)
    print(">> Abgleich %s -> %s%s" % (src, dst, " (Probelauf)" if args.dry_run else ""))
    try:
        syncer = sync(src, dst, dry_run=args.dry_run)
    except ValueError as exc:
        print("!! ABGELEHNT: %s" % exc, file=sys.stderr)
        return 2
    for line in syncer.summary():
        print("   " + line)
    return 1 if syncer.errors else 0


if __name__ == "__main__":
    sys.exit(main())
