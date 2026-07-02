#!/usr/bin/env bash
# ============================================================
# superbilly – Ein-Befehl-Import (Google-Docs-Export -> Supabase)
#
# Fasst die komplette Import-Pipeline in EINEN Aufruf zusammen und schreibt
# erst nach ausdrücklicher Bestätigung in die Datenbank:
#   1) xlsx  -> import-data.js        (Python-Parser)
#   2) Zoho-Deals aus Supabase ziehen (Fallback: vorhandener Snapshot)
#   3) Matching Excel <-> Zoho (+ overrides.json)
#   4) Trockenlauf: SQL erzeugen, Zusammenfassung zeigen  (schreibt NICHTS)
#   5) nach Rückfrage: SQL anwenden (--prune)             (schreibt in die DB)
#
# Aufruf:
#   bash tools/import/sync.sh                 # interaktiv, fragt vor dem Schreiben
#   bash tools/import/sync.sh "/Pfad/zur.xlsx"# andere xlsx als die Standard-Datei
#   bash tools/import/sync.sh --dry-run       # bei Schritt 4 stoppen (nie schreiben)
#   bash tools/import/sync.sh --yes           # ohne Rückfrage anwenden (Automation)
# ============================================================
set -euo pipefail

# ---- Optionen einlesen ----
DRY_RUN=0
ASSUME_YES=0
XLSX=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    -*)           echo "Unbekannte Option: $arg" >&2; exit 2 ;;
    *)            XLSX="$arg" ;;
  esac
done

# ---- Pfade relativ zum Skript auflösen (egal aus welchem Ordner gestartet) ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERBILLY="$(cd "$SCRIPT_DIR/../.." && pwd)"
SECRETS="$SUPERBILLY/.secrets"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }   # cyan Überschrift
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }     # grün
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$1"; }     # gelb
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ---- Vorbedingungen ----
command -v python3 >/dev/null || die "python3 nicht gefunden."
command -v node    >/dev/null || die "node nicht gefunden."

# xlsx-Pfad: Argument > Standard (den gen_import.py selbst kennt)
if [ -n "$XLSX" ]; then
  [ -f "$XLSX" ] || die "xlsx nicht gefunden: $XLSX"
  export BILLY_XLSX="$XLSX"
  echo "xlsx: $XLSX"
else
  echo "xlsx: Standard-Datei (~/Downloads/BILLY LIST 2016-2023.xlsx)"
fi

# ============================================================
step "1/5  Excel -> import-data.js  (Python-Parser)"
python3 "$SCRIPT_DIR/gen_import.py"
ok "import-data.js erzeugt"

# ============================================================
step "2/5  Zoho-Deals aus Supabase ziehen"
if bash "$SCRIPT_DIR/export-zoho.sh"; then
  ok "zoho-projects.json aktualisiert"
else
  if [ -f "$SCRIPT_DIR/zoho-projects.json" ]; then
    warn "Zoho-Abruf fehlgeschlagen (Netz/DB). Nutze vorhandenen Snapshot zoho-projects.json."
  else
    die "Zoho-Abruf fehlgeschlagen und kein vorhandener Snapshot – Abbruch."
  fi
fi

# ============================================================
step "3/5  Matching Excel <-> Zoho  (+ overrides.json)"
node "$SCRIPT_DIR/match-zoho.mjs"
ok "Report: tools/import/reports/match-zoho.md"

# ============================================================
step "4/5  Trockenlauf: SQL erzeugen (schreibt NICHTS)"
# DB-Zugang laden (für den späteren Schreibschritt; Trockenlauf braucht ihn nicht).
if [ -f "$SECRETS" ]; then set -a; . "$SECRETS"; set +a; fi
node "$SCRIPT_DIR/import-to-db.mjs" --prune
ok "SQL: tools/import/reports/import.sql"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  warn "--dry-run: Es wird NICHTS in die Datenbank geschrieben. Ende."
  echo "Report ansehen:  open $SCRIPT_DIR/reports/match-zoho.md"
  exit 0
fi

# ============================================================
step "5/5  Anwenden auf die Datenbank"
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL fehlt (in $SECRETS erwartet)."

if [ "$ASSUME_YES" -ne 1 ]; then
  echo
  warn "Der nächste Schritt SCHREIBT in die Live-Datenbank (inkl. --prune: entfernt"
  warn "verwaiste Excel-Buchungen im importierten Zeitraum). Vorher ggf. den Report prüfen:"
  echo "    open $SCRIPT_DIR/reports/match-zoho.md"
  echo
  printf "Jetzt wirklich anwenden? [j/N] "
  read -r reply
  case "$reply" in
    j|J|ja|Ja|y|Y|yes) ;;
    *) warn "Abgebrochen. Nichts geschrieben."; exit 0 ;;
  esac
fi

node "$SCRIPT_DIR/import-to-db.mjs" --prune --apply
ok "Import angewandt. Die Online-App zeigt die Daten unmittelbar."
