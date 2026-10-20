#!/usr/bin/env bash
#
# ABW Arcade - Verteilpakete bauen
#
#     ./paket-bauen.sh              # baut aus HEAD
#     ./paket-bauen.sh v1.0         # baut aus einem Tag oder Commit
#
# Ergebnis im Projektordner, beide mit demselben Inhalt, entpackt nach
# abw-arcade/:
#
#     abw-arcade.tar.gz   fuer Linux und macOS (install.sh)
#     abw-arcade.zip      fuer Windows (install.cmd)
#
# Warum ueberhaupt ein Skript: Ein von Hand gepacktes Archiv hat keine
# Zusicherung, dass sein Inhalt zum Code passt - es enthaelt, was zufaellig
# gerade im Ordner lag. Dieses hier hat sie, weil es ausschliesslich aus git
# liest.
#
# Konkret: `git archive` nimmt genau die eingecheckten Dateien eines Commits.
# Nicht das Arbeitsverzeichnis. Damit koennen weder eine .venv noch eine
# arcade.db noch halbfertige Aenderungen ins Paket geraten. Dabei gelten die
# Regeln aus .gitattributes: Entwicklungsdateien bleiben draussen
# (export-ignore), und install.cmd/install.ps1 bekommen in BEIDEN Archiven
# Windows-Zeilenenden, install.sh Unix-Zeilenenden.
set -euo pipefail

REF="${1:-HEAD}"
NAME="abw-arcade"

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "FEHLER: Kein git-Repository. Das Paket wird aus git gebaut." >&2
  exit 1
fi

# --add-file (PAKET-INFO direkt ins Archiv) gibt es ab git 2.30.
GIT_VERSION="$(git --version | awk '{print $3}')"
GIT_MAJOR="$(printf '%s' "$GIT_VERSION" | cut -d. -f1)"
GIT_MINOR="$(printf '%s' "$GIT_VERSION" | cut -d. -f2)"
if [ "$GIT_MAJOR" -lt 2 ] || { [ "$GIT_MAJOR" -eq 2 ] && [ "$GIT_MINOR" -lt 30 ]; }; then
  echo "FEHLER: git ${GIT_VERSION} ist zu alt; gebraucht wird 2.30 oder neuer" >&2
  echo "        (fuer 'git archive --add-file')." >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "${REF}^{commit}" >/dev/null; then
  echo "FEHLER: '${REF}' ist kein bekannter Commit, Tag oder Branch." >&2
  exit 1
fi

# ^{commit} ist wichtig: Bei einem annotierten Tag liefert rev-parse sonst die
# SHA des Tag-Objekts, nicht die des Commits. Die stuende dann in PAKET-INFO
# und waere im Repo nicht auffindbar.
COMMIT="$(git rev-parse --short "${REF}^{commit}")"
DATUM="$(git log -1 --format=%cI "${REF}^{commit}")"
# Lesbare Herkunft: der Tag selbst, sonst "naechster Tag + Abstand + Commit"
# (v1.0-3-gabc1234), ohne Tags die Commit-SHA.
QUELLE="$(git describe --tags --always "${REF}^{commit}")"

# Nicht eingecheckte Aenderungen landen NICHT im Paket. Das ist Absicht, aber
# es soll niemanden ueberraschen - deshalb ein deutlicher Hinweis.
#
# Geprueft wird auf echte INHALTSaenderungen, nicht auf Modusaenderungen:
# Unter WSL meldet /mnt/... jede Datei als 777, wodurch git lauter
# Rechteaenderungen sieht und die Warnung sonst immer feuert.
GEAENDERT="$(git diff --numstat HEAD -- 2>/dev/null | awk '$1!="0"||$2!="0"' | wc -l)"
if [ "$REF" = "HEAD" ] && [ "$GEAENDERT" -gt 0 ]; then
  echo "!! Das Arbeitsverzeichnis hat nicht eingecheckte Aenderungen."
  echo "!! Sie kommen NICHT ins Paket - gebaut wird der Commit ${COMMIT}."
  echo "!! Erst committen, wenn sie mitsollen."
  echo ""
fi

BAU="$(mktemp -d)"
trap 'rm -rf "$BAU"' EXIT

# Herkunft mitliefern. Ohne das laesst sich auf einem laufenden Server nicht
# feststellen, welcher Stand dort eigentlich installiert ist - genau die
# Frage, die beim Auseinanderlaufen von Paket und Code niemand beantworten
# konnte.
cat > "${BAU}/PAKET-INFO" <<EOF
Paket:   ${NAME}
Quelle:  ${QUELLE}
Commit:  ${COMMIT}
Stand:   ${DATUM}
EOF

echo ">> Pakete aus ${REF} (${COMMIT}) bauen ..."
for FORMAT in tar.gz zip; do
  rm -f "${NAME}.${FORMAT}"
  # --prefix muss VOR --add-file stehen, sonst landet PAKET-INFO nicht in
  # abw-arcade/.
  git archive --format="$FORMAT" --prefix="${NAME}/" \
    --add-file="${BAU}/PAKET-INFO" -o "${NAME}.${FORMAT}" "${REF}^{commit}"
done

ANZAHL="$(tar -tzf "${NAME}.tar.gz" | grep -cv '/$' || true)"

echo ""
echo ">> Fertig: ${ANZAHL} Dateien, Commit ${COMMIT} (${QUELLE})"
for FORMAT in tar.gz zip; do
  printf '     %-20s %6s\n' "${NAME}.${FORMAT}" "$(du -h "${NAME}.${FORMAT}" | cut -f1)"
done
echo ""
echo "   Pruefen:     tar -tzf ${NAME}.tar.gz | head"
echo "   Ausliefern:  gh release create <tag> ${NAME}.tar.gz ${NAME}.zip"
