# sync-mite

Pull-Sync **Mite Ist-Zeiten → `project_actuals`** (read-only, Roadmap v2.3).
Liefert die tatsächlich getrackte Zeit pro Projekt/Monat/Service – Ist neben
Volumen (`projects.budget_eur`) und Soll (Summe `bookings.budget`).
Hintergrund: `ressourcenplanung/konzept.md` §3.7/§4.5.

## Was die Function tut
1. Gruppierter Mite-Report `group_by=project,month,service&at=<MITE_PERIOD>`.
2. Zuordnung Mite-Projekt → `projects`:
   - `project_external_map` (bestätigte Ausnahme) – override, sonst
   - **Angebotsnummer** aus dem Mite-Projektnamen (`^A - <nr>`) ↔ `projects.offer_number`.
3. Aggregiert je `(project_id, period, service_code)`, Upsert in `project_actuals`
   (idempotent). Ungemappte Mite-Projekte kommen im Response zurück
   (`unmatched`) → Kandidaten fürs Mapping-UI.

Besonderheiten (Live verifiziert): Mite-`revenue` ist in **Cent** (→ /100);
der Header `X-MiteApiKey` wird case-sensitiv geprüft, daher Auth über
Query-Param `?api_key=…`.

## Benötigte Secrets (Edge Function Secrets)
- `MITE_ACCOUNT` = `trendonegmbh`  (Subdomain von `<account>.mite.de`)
- `MITE_API_KEY` = persönlicher Mite-API-Schlüssel (Admin, „Mein Konto" → API)
- `MITE_PERIOD` (optional) = `this_year` (Default) | `last_year` | …
- `SYNC_SECRET` (bereits gesetzt, gemeinsam mit sync-zoho)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` werden automatisch injiziert.

```bash
npx supabase secrets set MITE_ACCOUNT="trendonegmbh" MITE_API_KEY="<key>"
```

## Deploy & Test
```bash
npx supabase functions deploy sync-mite
curl -i -X POST "https://rzsptpfgzfigxmyyqdas.supabase.co/functions/v1/sync-mite" \
  -H "x-sync-secret: <SYNC_SECRET>"
# Erwartet: {"ok":true,"period":"this_year","actuals_upserted":N,"unmatched":[…]}
```

## Zeitplan (pg_cron) – analog sync-zoho, einmalig im SQL-Editor
```sql
select vault.create_secret('https://rzsptpfgzfigxmyyqdas.supabase.co/functions/v1/sync-mite','sync_mite_url');
select cron.schedule('sync-mite','15 */6 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='sync_mite_url'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='sync_zoho_secret')
    )
  );
$$);
```
(Nutzt dasselbe `sync_zoho_secret` aus dem Vault. Ist-Zeiten ändern sich langsam → 4×/Tag genügt.)
