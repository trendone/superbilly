#!/usr/bin/env bash
# ============================================================
# Exportiert die per sync-zoho gespiegelten Zoho-Projekte (projects mit
# external_id) als JSON -> tools/import/zoho-projects.json (Input für match-zoho.mjs).
# Liest SUPABASE_DB_URL aus ../../.secrets. SCHREIBT NICHTS in die DB (nur SELECT).
# Aufruf:  bash tools/import/export-zoho.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.secrets; set +a

psql "$SUPABASE_DB_URL" -At -c "select coalesce(json_agg(json_build_object(
  'id',id,'name',name,'offer',offer_number,'date',end_date
) order by name),'[]') from projects where external_id is not null;" \
  > tools/import/zoho-projects.json

n=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tools/import/zoho-projects.json','utf8')).length)")
echo "zoho-projects.json: ${n} Zoho-Projekte exportiert"
