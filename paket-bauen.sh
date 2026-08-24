#!/usr/bin/env bash
#
# ABW Arcade — Verteilpaket bauen
#
#     ./paket-bauen.sh              # baut aus HEAD
#     ./paket-bauen.sh v1.1         # baut aus einem Tag oder Commit
#
# Ergebnis: abw-arcade.tar.gz im Projektordner, entpackt nach abw-arcade/.
#
# Warum ueberhaupt ein Skript: Das Paket wurde frueher von Hand gepackt.
# Dabei ist es auseinandergelaufen — das veroeffentlichte v1.0-Archiv war
# aelter als der Code und enthielt zwei Spiele nicht, die das README bereits
# beschrieb. Ein von Hand gebautes Paket hat keine Zusicherung, dass es zum
# Code passt; dieses hier hat sie, weil es ausschliesslich aus git liest.
#
# Konkret: `git archive` nimmt genau die eingecheckten Dateien eines Commits.
# Nicht das Arbeitsverzeichnis. Damit koennen weder eine .venv noch eine
# arcade.db noch halbfertige Aenderungen ins Paket geraten.
set -euo pipefail

REF="${1:-HEAD}"
NAME="abw-arcade"
ARCHIV="${NAME}.tar.gz"

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "FEHLER: Kein git-Repository. Das Paket wird aus git gebaut." >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "${REF}^{commit}" >/dev/null; then
  echo "FEHLER: '${REF}' ist kein bekannter Commit, Tag oder Branch." >&2
  exit 1
fi

COMMIT="$(git rev-parse --short "${REF}")"
DATUM="$(git log -1 --format=%cI "${REF}")"

# Nicht eingecheckte Aenderungen landen NICHT im Paket. Das ist Absicht, aber
# es soll niemanden ueberraschen — deshalb ein deutlicher Hinweis.
if [ "$REF" = "HEAD" ] && ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "!! Das Arbeitsverzeichnis hat nicht eingecheckte Aenderungen."
  echo "!! Sie kommen NICHT ins Paket — gebaut wird der Commit ${COMMIT}."
  echo "!! Erst committen, wenn sie mitsollen."
  echo ""
fi

BAU="$(mktemp -d)"
trap 'rm -rf "$BAU"' EXIT

echo ">> Dateien aus ${REF} (${COMMIT}) holen ..."
git archive --format=tar --prefix="${NAME}/" "$REF" | tar -x -C "$BAU"

# Herkunft mitliefern. Ohne das laesst sich auf einem laufenden Server nicht
# feststellen, welcher Stand dort eigentlich installiert ist — genau die
# Frage, die beim Auseinanderlaufen von Paket und Code niemand beantworten
# konnte.
cat > "${BAU}/${NAME}/PAKET-INFO" <<EOF
Paket:   ${NAME}
Quelle:  ${REF}
Commit:  ${COMMIT}
Stand:   ${DATUM}
EOF

echo ">> Archiv packen ..."
rm -f "$ARCHIV"
tar -czf "$ARCHIV" -C "$BAU" "$NAME"

ANZAHL="$(tar -tzf "$ARCHIV" | grep -cv '/$' || true)"
GROESSE="$(du -h "$ARCHIV" | cut -f1)"

echo ""
echo ">> Fertig: ${ARCHIV}  (${GROESSE}, ${ANZAHL} Dateien, Commit ${COMMIT})"
echo ""
echo "   Pruefen:     tar -tzf ${ARCHIV} | head"
echo "   Ausliefern:  gh release create <tag> ${ARCHIV} --repo utmwzar/ABW-Arcade"
