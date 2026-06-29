# sync-abgrenzungen

Pull-Sync **Zoho „Abgrenzungen" → `milestones`** (read-only, Rechnungs-Meilensteine).
Das Custom-Modul Abgrenzungen (API `Abgrenzungen`) liefert die Rechnungs-Splits je
Auftrag; wir spiegeln sie als Meilensteine in die Projektplanung.

## Was die Function tut
1. Access-Token via Refresh-Token erneuern (`ZOHO_*`-Secrets, geteilt mit sync-zoho).
2. COQL: `select … from Abgrenzungen where Beauftragt = true` (paginiert).
3. Zuordnung zum Projekt: `Verkaufschance` (→ Deal-ID) == `projects.external_id`.
   Abgrenzungen ohne passendes Projekt → übersprungen (`unmatched` im Response).
4. Upsert in `milestones`, idempotent über `external_id` (Abgrenzungs-ID).

## Feld-Mapping
| milestone | ← Abgrenzung |
|---|---|
| `title` | `Beschreibung` |
| `amount_eur` | `Umsatz` |
| `due_date` | `Rechnungsdatum ?? Monat` (Rechnungsdatum nur gefüllt, wenn ≠ Leistungsmonat) |
| `invoice_status` | `Rechnung_gestellt` → `gestellt`, sonst `offen` |
| `invoice_number` | `Rechnungsnummer` |
| `external_id` | Abgrenzung `id` |
| `source` | `'zoho'` |

## Secrets
Keine neuen – nutzt `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`, `ZOHO_*_DOMAIN`, `SYNC_SECRET`.
Voraussetzung: Token mit Scope `ZohoCRM.modules.custom.READ` + `ZohoCRM.coql.READ`.

## Deploy & Test
```bash
npx supabase functions deploy sync-abgrenzungen
curl -i -X POST "https://rzsptpfgzfigxmyyqdas.supabase.co/functions/v1/sync-abgrenzungen" \
  -H "x-sync-secret: <SYNC_SECRET>"
# Erwartet: {"ok":true,"milestones_upserted":N,"unmatched":M}
```

## Zeitplan (pg_cron) – einmalig im SQL-Editor
```sql
select vault.create_secret('https://rzsptpfgzfigxmyyqdas.supabase.co/functions/v1/sync-abgrenzungen','sync_abgrenzungen_url');
select cron.schedule('sync-abgrenzungen','45 */6 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='sync_abgrenzungen_url'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='sync_zoho_secret'))
  );
$$);
```
