"""Baut die lokale Testversion: die fuenf Arcade-Spiele in einer HTML-Datei, die
ohne Server im Browser laeuft (Doppelklick genuegt). Schach und DOOM fehlen, weil
sie den Server brauchen. Die Scores bleiben im localStorage des Browsers.

Aufruf aus dem Repo, mit den Python-Paketen aus requirements.txt:

    python werkzeuge/testversion/bauen.py                       # Stand HEAD
    python werkzeuge/testversion/bauen.py --ref v1.1 --out ~/arcade.html

Gebaut wird ein eingecheckter Stand (git archive), nicht das Arbeitsverzeichnis.
Gebraucht werden git, Python mit Flask und Node mit npx (laedt esbuild).

Ablauf: Der Stand wird in einen Wegwerf-Ordner entpackt. Dort werden die Vorlagen
fuer den lokalen Betrieb angepasst (kein Schach, kein DOOM, kein Abmelden), die
echten Seiten ueber den Flask-Testclient gerendert, die JS-Module je Seite mit
esbuild zu einem klassischen Skript gebuendelt (ES-Module laden nicht von file://)
und alles mit laufzeit.js zu einer Datei zusammengesetzt. laufzeit.js ersetzt den
Server: Start, Ende und Leaderboard laufen im Browser, nachgerechnet mit derselben
JS-Engine.

Passt eine Vorlage nicht mehr zu den Ersetzungen unten, bricht das Skript mit der
Stelle ab. Dann die Ersetzung an die neue Vorlage anpassen.
"""
import argparse
import base64
import html
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HIER))
ESBUILD = "esbuild@0.25.0"

# slug, Seite, API-Praefix, Engine-Datei, Engine-Global, Seitenmodul, Endpoint
GAMES = [
    ("tetris", "/games/tetris", "game", "tetris_engine.js", "TetrisEngine", "tetris.js", "tetris"),
    ("snake", "/games/snake", "snake", "snake_engine.js", "SnakeEngine", "snake.js", "snake"),
    ("breakout", "/games/breakout", "breakout", "breakout_engine.js", "BreakoutEngine", "breakout.js", "breakout"),
    ("2048", "/games/2048", "2048", "g2048_engine.js", "G2048Engine", "g2048.js", "game_2048"),
    ("geometry-dash", "/games/geometry-dash", "geometry-dash", "gd_engine.js", "GDEngine", "gd.js", "geometry_dash"),
]


class Bau:
    def __init__(self, src):
        self.src = src

    def lesen(self, rel):
        with open(os.path.join(self.src, rel), encoding="utf-8") as f:
            return f.read()

    def schreiben(self, rel, text):
        with open(os.path.join(self.src, rel), "w", encoding="utf-8") as f:
            f.write(text)

    def ersetzen(self, rel, alt, neu):
        text = self.lesen(rel)
        n = text.count(alt)
        if n != 1:
            raise SystemExit(f"{rel}: erwartet genau 1 Treffer, gefunden {n}: {alt[:70]!r}")
        self.schreiben(rel, text.replace(alt, neu))

    def ausschneiden(self, rel, anfang, ende):
        """Entfernt von `anfang` bis einschliesslich des ersten `ende` danach."""
        text = self.lesen(rel)
        if text.count(anfang) != 1:
            raise SystemExit(f"{rel}: Anfang nicht eindeutig: {anfang[:70]!r}")
        i = text.index(anfang)
        j = text.index(ende, i) + len(ende)
        self.schreiben(rel, text[:i] + text[j:])

    def data_uri(self, rel):
        typ = {".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2"}[os.path.splitext(rel)[1]]
        with open(os.path.join(self.src, "static", rel), "rb") as f:
            return f"data:{typ};base64," + base64.b64encode(f.read()).decode("ascii")


def entpacken(ref, ziel):
    commit = subprocess.run(["git", "-C", REPO, "rev-parse", "--short", f"{ref}^{{commit}}"],
                            check=True, capture_output=True, text=True).stdout.strip()
    archiv = os.path.join(ziel, "src.tar")
    subprocess.run(["git", "-C", REPO, "archive", "-o", archiv, f"{ref}^{{commit}}"], check=True)
    src = os.path.join(ziel, "src")
    os.makedirs(src)
    with tarfile.open(archiv) as t:
        try:
            t.extractall(src, filter="data")
        except TypeError:   # Python ohne den Filter (vor 3.10.12): eigenes Archiv, vertrauenswuerdig
            t.extractall(src)
    return src, commit


def vorlagen_anpassen(b):
    """Kein Schach, kein DOOM, kein Abmelden; Texte sagen „lokal“ statt „Server“."""
    T = "templates/"
    b.ersetzen(T + "_topbar.html",
               """        <a href="{{ url_for('chess_lobby_page') }}" {% if nav_section == 'chess' %}aria-current="page"{% endif %}>Schach</a>\n""",
               "")
    b.ersetzen(T + "_topbar.html",
               """<span class="who"><span class="avatar" aria-hidden="true">{{ username[:1]|upper }}</span><span class="who-name"><span class="visually-hidden">Angemeldet als </span>{{ username }}</span></span>""",
               """<span class="tag" title="Kein Server: Scores bleiben in diesem Browser.">Lokale Testversion</span>""")
    b.ausschneiden(T + "_topbar.html", """        <form method="post" action="{{ url_for('logout') }}">""", "</form>\n")
    b.ausschneiden(T + "_settings.html", """      <fieldset class="setting">\n        <legend>Schach</legend>""", "</fieldset>\n")
    b.ausschneiden(T + "_settings.html", """      <fieldset class="setting">\n        <legend>DOOM</legend>""", "</fieldset>\n")
    b.ersetzen(T + "hub.html",
               "Ein Account, {{ games|length }} Spiele. Jeder Score wird vom Server nachgerechnet.",
               "{{ games|length }} Spiele zum Testen, ganz ohne Server. Jeder Score wird lokal mit derselben Engine nachgerechnet.")
    b.ausschneiden(T + "hub.html", """    <section class="panel hub-panel" aria-labelledby="chess-title">""", "    </section>\n")
    b.ersetzen(T + "hub.html", "Jeder Score ist vom Server nachgerechnet.", "Jeder Score ist lokal nachgerechnet.")
    b.ersetzen(T + "hub.html",
               "Dein erster Score erscheint hier, sobald der Server ihn nachgerechnet hat.",
               "Dein erster Score erscheint hier, sobald er nachgerechnet ist.")
    A = "static/js/arcade.js"
    b.ersetzen(A, '"Der Server rechnet nach …"', '"Wird nachgerechnet …"')
    b.ersetzen(A, '"Vom Server nachgerechnet"', '"Lokal nachgerechnet"')
    b.ersetzen(A, 'run: () => window.location.assign("/") }', 'run: () => window.location.assign("#") }')


def seiten_rendern(b, daten):
    """Hub (ohne Stand und je Spiel als „Weiterspielen“) und die fuenf Spielseiten."""
    os.environ["ARCADE_DATA_DIR"] = daten
    sys.path.insert(0, b.src)
    import app as arcade  # noqa: E402  (liest ARCADE_DATA_DIR beim Import)

    arcade.GAMES[:] = [g for g in arcade.GAMES if g["slug"] not in ("chess", "doom")]
    if [g["slug"] for g in arcade.GAMES] != [g[0] for g in GAMES]:
        raise SystemExit(f"Andere Spiele als erwartet: {[g['slug'] for g in arcade.GAMES]}")
    links = {"index": "#", **{g[6]: "#" + g[0] for g in GAMES}}

    def local_url_for(endpoint, **values):
        if endpoint == "static":
            return "/static/" + values["filename"]
        if endpoint in links:
            return links[endpoint]
        raise RuntimeError(f"Link auf {endpoint} gibt es lokal nicht")

    arcade.app.jinja_env.globals["url_for"] = local_url_for
    db = sqlite3.connect(arcade.DB_PATH)
    uid = db.execute("INSERT INTO users (username, password_hash) VALUES ('Du', '!')").lastrowid
    db.commit()
    db.close()
    client = arcade.app.test_client()
    with client.session_transaction() as s:
        s["user_id"] = uid

    def hub_ohne_daten(featured, returning):
        def _hub_data(_db, _uid):
            return {"standing": {}, "recent": [], "returning": returning,
                    "featured": next(g for g in arcade.GAMES if g["slug"] == featured),
                    "chess": {"your_turn": [], "challenges": [], "their_turn": 0,
                              "own_challenge": None, "rated": False, "rating": 1000}}
        return _hub_data

    def holen(pfad):
        r = client.get(pfad)
        if r.status_code != 200:
            raise SystemExit(f"{pfad}: HTTP {r.status_code}")
        return r.get_data(as_text=True)

    roh = {}
    arcade._hub_data = hub_ohne_daten("tetris", False)
    roh["hub"] = holen("/")
    for g in GAMES:
        arcade._hub_data = hub_ohne_daten(g[0], True)
        roh["hub-" + g[0]] = holen("/")
    for g in GAMES:
        roh[g[0]] = holen(g[1])
    titel = {g["slug"]: g["title"] for g in arcade.GAMES}
    return roh, titel


def zerlegen(b, name, quelle):
    titel = html.unescape(re.search(r"<title>(.*?)</title>", quelle, re.S).group(1))
    css = re.findall(r'<link rel="stylesheet" href="/static/css/([^"]+)">', quelle)
    m = re.search(r"<body([^>]*)>(.*)</body>", quelle, re.S)
    klasse = re.search(r'class="([^"]*)"', m.group(1))
    body = m.group(2)
    skripte = re.findall(r'<script(?: type="module")? src="/static/([^"]+)"></script>', body)
    body = re.sub(r'\s*<script(?: type="module")? src="/static/[^"]+"></script>', "", body)
    if "<script" in body:
        raise SystemExit(f"{name}: unerwartetes Skript im Body")
    body = re.sub(r'"/static/([^"]+)"', lambda x: '"' + b.data_uri(x.group(1)) + '"', body)
    for rest in ("/static/", 'href="/', "action="):
        if rest in body:
            raise SystemExit(f"{name}: Server-Pfad uebrig: {rest}")
    return {"titel": titel, "css": css, "klasse": klasse.group(1) if klasse else "",
            "body": body.strip(), "skripte": skripte}


def buendeln(b, name, module, ziel):
    npx = shutil.which("npx")
    if not npx:
        raise SystemExit("Node mit npx fehlt; es laedt esbuild fuer die JS-Module.")
    eintrag = f"eintrag-{name}.js"
    with open(os.path.join(b.src, eintrag), "w", encoding="utf-8") as f:
        f.write("".join(f'import "./static/{m}";\n' for m in module))
    aus = os.path.join(ziel, f"bundle-{name}.js")
    # Im Quellordner gestartet, damit die Pfadkommentare im Bundle relativ bleiben.
    r = subprocess.run([npx, "--yes", ESBUILD, eintrag, "--bundle", "--format=iife",
                        "--charset=utf8", "--banner:js=\"use strict\";", "--log-level=warning",
                        f"--outfile={aus}"],
                       capture_output=True, text=True, cwd=b.src)
    if r.returncode != 0 or r.stderr.strip():
        raise SystemExit(f"esbuild {name}:\n{r.stderr}")
    with open(aus, encoding="utf-8") as f:
        return f.read()


def skript_text(code, name):
    if "<!--" in code or re.search(r"<script", code, re.I):
        raise SystemExit(f"{name}: enthaelt <!-- oder <script")
    return re.sub(r"</(script)", r"<\\/\1", code, flags=re.I)


def bauen(ref, out):
    tmp = tempfile.mkdtemp(prefix="abw-testversion-")
    try:
        src, commit = entpacken(ref, tmp)
        b = Bau(src)
        vorlagen_anpassen(b)
        daten = os.path.join(tmp, "daten")
        os.makedirs(daten)
        roh, titel = seiten_rendern(b, daten)

        seiten = {name: zerlegen(b, name, q) for name, q in roh.items()}
        for name, s in seiten.items():
            erwartet = ["tokens.css", "app.css", "hub.css" if name.startswith("hub") else "games.css"]
            if s["css"] != erwartet:
                raise SystemExit(f"{name}: andere Stylesheets als erwartet: {s['css']}")
        kopf = re.search(r"<head>(.*?)</head>", roh["hub"], re.S).group(1)
        frueh = re.search(r"<script>(.*?)</script>", kopf, re.S).group(1)

        bundles = {}
        if seiten["hub"]["skripte"] != ["js/hub.js", "js/shell.js"]:
            raise SystemExit(f"hub: andere Skripte als erwartet: {seiten['hub']['skripte']}")
        bundles["js-page-hub"] = buendeln(b, "hub", seiten["hub"]["skripte"], tmp)
        for g in GAMES:
            s = seiten[g[0]]["skripte"]
            if s != [g[3], g[5], "js/shell.js"]:
                raise SystemExit(f"{g[0]}: andere Skripte als erwartet: {s}")
            bundles["js-engine-" + g[0]] = b.lesen("static/" + g[3])
            bundles["js-page-" + g[0]] = buendeln(b, g[0], s[1:], tmp)

        tokens = b.lesen("static/css/tokens.css")
        for font in ("archivo.woff2", "press-start-2p.woff2"):
            tokens = tokens.replace(f'url("../fonts/{font}")', f'url("{b.data_uri("fonts/" + font)}")')
        if "../fonts/" in tokens:
            raise SystemExit("tokens.css: unbekannte Schrift")
        css_basis = tokens + "\n" + b.lesen("static/css/app.css")
        css_hub, css_game = b.lesen("static/css/hub.css"), b.lesen("static/css/games.css")

        spiele = json.dumps([{"slug": g[0], "title": titel[g[0]], "api": g[2], "engine": g[4]}
                             for g in GAMES], ensure_ascii=False)
        with open(os.path.join(HIER, "laufzeit.js"), encoding="utf-8") as f:
            laufzeit = f.read()
        if laufzeit.count("/*GAMES*/[]") != 1:
            raise SystemExit("laufzeit.js: Platzhalter /*GAMES*/[] muss genau einmal vorkommen")
        laufzeit = laufzeit.replace("/*GAMES*/[]", spiele)

        teile = []
        for name, s in seiten.items():
            istspiel = not name.startswith("hub")
            js = f"js-engine-{name} js-page-{name}" if istspiel else "js-page-hub"
            attr = (f'id="page-{name}" data-title="{html.escape(s["titel"])}" '
                    f'data-css="{"game" if istspiel else "hub"}" data-js="{js}" '
                    f'data-body-class="{html.escape(s["klasse"])}"')
            teile.append(f"<template {attr}>\n{s['body']}\n</template>")
        for bid, code in bundles.items():
            teile.append(f'<script type="text/plain" id="{bid}">\n{skript_text(code, bid)}\n</script>')

        ausgabe = f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#181331">
<title>ABW Arcade · Lokale Testversion</title>
<!-- ABW Arcade, lokale Testversion: Tetris, Snake, Breakout, 2048 und Geometry Dash
     ohne Server. Gebaut aus Commit {commit}. Scores bleiben im localStorage dieses
     Browsers. Schach und DOOM brauchen den Server. -->
<link rel="icon" href="{b.data_uri('favicon.svg')}" type="image/svg+xml">
<style>
{css_basis}
</style>
<style id="css-hub" media="not all">
{css_hub}
</style>
<style id="css-game" media="not all">
{css_game}
</style>
<script>{frueh}</script>
{chr(10).join(teile)}
</head>
<body>
<script>
{skript_text(laufzeit, 'laufzeit')}
</script>
</body>
</html>
"""
        with open(out, "w", encoding="utf-8") as f:
            f.write(ausgabe)
        return commit, len(ausgabe.encode("utf-8")), len(seiten)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    p = argparse.ArgumentParser(description="Baut die lokale Testversion (eine HTML-Datei ohne Server).")
    p.add_argument("--ref", default="HEAD", help="Stand, der gebaut wird (Standard: HEAD)")
    p.add_argument("--out", default="abw-arcade-lokal.html", help="Ausgabedatei (Standard: abw-arcade-lokal.html)")
    a = p.parse_args()
    out = os.path.abspath(os.path.expanduser(a.out))
    commit, groesse, seiten = bauen(a.ref, out)
    print(f"{out}: {groesse / 1024:.0f} KB, {seiten} Seiten, Stand {a.ref} ({commit})")


if __name__ == "__main__":
    main()
