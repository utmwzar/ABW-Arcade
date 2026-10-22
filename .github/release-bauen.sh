#!/usr/bin/env bash
# Baut ein Release und prüft es, ohne etwas zu veröffentlichen: Notizen aus
# CHANGELOG.md schneiden, Tag lokal setzen (oder einen vorhandenen nutzen),
# Pakete bauen und ihren Inhalt prüfen. Danach liegen abw-arcade.tar.gz,
# abw-arcade.zip und "$RUNNER_TEMP/notes.md" bereit.
#
#   .github/release-bauen.sh 1.1            für das echte Release (Workflow)
#   .github/release-bauen.sh 1.1 --probe    Probelauf: baut immer den aktuellen
#                                           Stand, auch wenn es v1.1 schon gibt
set -euo pipefail

VERSION="${1:-}"
MODE="${2:-}"
TAG="v$VERSION"
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
NOTES="$TMP/notes.md"

re='^[0-9]+\.[0-9]+(\.[0-9]+)?$'
if ! [[ $VERSION =~ $re ]]; then
  echo "::error::Version \"$VERSION\" ist ungültig, erwartet wird z. B. 1.1 (ohne v)."
  exit 1
fi

# Notizen: alles zwischen "## [VERSION]" und der nächsten Versionsüberschrift
awk -v v="$VERSION" 'index($0, "## [" v "]") == 1 { on = 1; next } on && /^## \[/ { exit } on' \
  CHANGELOG.md > "$NOTES"
if ! grep -q '[^[:space:]]' "$NOTES"; then
  echo "::error::CHANGELOG.md hat keinen Abschnitt für $VERSION."
  exit 1
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
if [ "$MODE" = "--probe" ]; then
  git tag -d "$TAG" >/dev/null 2>&1 || true
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Den Tag $TAG gibt es schon; gebaut wird $(git rev-parse --short "$TAG^{commit}")."
else
  git tag -a "$TAG" -m "ABW Arcade $TAG"
fi

./paket-bauen.sh "$TAG"

tar -tzf abw-arcade.tar.gz | grep -v '/$' | sort > "$TMP/tar.txt"
unzip -Z1 abw-arcade.zip | grep -v '/$' | sort > "$TMP/zip.txt"
if ! diff "$TMP/tar.txt" "$TMP/zip.txt"; then
  echo "::error::tar.gz und zip enthalten nicht dieselben Dateien."
  exit 1
fi
if grep -E '^abw-arcade/(\.github|tests|docs|werkzeuge)/' "$TMP/tar.txt"; then
  echo "::error::Entwicklungsdateien im Paket."
  exit 1
fi
for datei in PAKET-INFO CHANGELOG.md README.md LICENSE run.py install.sh install.cmd; do
  if ! grep -qx "abw-arcade/$datei" "$TMP/tar.txt"; then
    echo "::error::$datei fehlt im Paket."
    exit 1
  fi
done
if ! tar -xzOf abw-arcade.tar.gz abw-arcade/PAKET-INFO | grep -Eq "^Quelle:[[:space:]]+v${VERSION//./\\.}\$"; then
  echo "::error::PAKET-INFO nennt nicht $TAG:"
  tar -xzOf abw-arcade.tar.gz abw-arcade/PAKET-INFO
  exit 1
fi

echo "Release $TAG gebaut und geprüft ($(wc -l < "$TMP/tar.txt") Dateien)."
