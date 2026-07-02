#!/usr/bin/env bash
# ============================================================
# Exportiert die per sync-zoho gespiegelten ECHTEN Zoho-Deals (source='zoho')
# als JSON -> tools/import/zoho-projects.json (Input für match-zoho.mjs).
# WICHTIG: nur source='zoho' – sonst zieht der Export auch die von früheren
# Import-Läufen angelegten source='excel'-Projekte (die ebenfalls external_id
# haben) und der Matcher würde Excel gegen sich selbst matchen (Rückkopplung:
# offene Fälle würden als 100%-Selbsttreffer fälschlich SICHER).
# Liest SUPABASE_DB_URL aus ../../.secrets. SCHREIBT NICHTS in die DB (nur SELECT).
# Aufruf:  bash tools/import/export-zoho.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.secrets; set +a

psql "$SUPABASE_DB_URL" -At -c "select coalesce(json_agg(json_build_object(
  'id',id,'name',name,'offer',offer_number,'date',end_date
) order by name),'[]') from projects where external_id is not null and source = 'zoho';" \
  > tools/import/zoho-projects.json

n=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tools/import/zoho-projects.json','utf8')).length)")
echo "zoho-projects.json: ${n} Zoho-Projekte exportiert"
