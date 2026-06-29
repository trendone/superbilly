# sync-zoho

Pull-Sync **Zoho CRM → `projects`** (read-only Spiegelung, Roadmap v2.1).
Angebotsgetrieben: beauftragte Angebote → zugehöriger Consulting-Deal → `projects`.
Hintergrund & Feld-Mapping: `ressourcenplanung/zoho-anbindung.md`.

## Was die Function tut
1. Access-Token via Refresh-Token erneuern (`accounts.zoho.eu`).
2. **Eine COQL-Abfrage** zieht serverseitig gefiltert die beauftragten Consulting-Angebote
   samt Deal-Feldern (`Quote_Stage ∈ {Beauftragt, Teilweise beauftragt}` und
   `Deal_Name.Leistungsbereich = Consulting`).
3. Upsert in `projects`, idempotent über `external_id` (Deal-ID).

COQL statt Such-API, weil die Suche bei 2000 Treffern gedeckelt ist und nicht
modulübergreifend nach `Leistungsbereich` filtern kann. Braucht Scope `ZohoCRM.coql.READ`.

## Benötigte Secrets (Edge Function Secrets)
Bereits gesetzt (Zoho): `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`,
`ZOHO_ACCOUNTS_DOMAIN`, `ZOHO_API_DOMAIN`.
**Neu zu setzen:** `SYNC_SECRET` (frei gewählter Zufallswert – schützt den HTTP-Endpunkt).

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` werden von Supabase automatisch injiziert.

```bash
# SYNC_SECRET setzen (Wert selbst generieren, z. B. openssl rand -hex 24)
npx supabase secrets set SYNC_SECRET="<zufallswert>"
```

## Deploy
```bash
npx supabase functions deploy sync-zoho
```

## Manuell testen
```bash
curl -i -X POST \
  "https://rzsptpfgzfigxmyyqdas.supabase.co/functions/v1/sync-zoho" \
  -H "x-sync-secret: <zufallswert>"
# Erwartet: {"ok":true,"projects_upserted":N}
```

## Zeitplan (pg_cron) – einmalig im SQL-Editor
`SYNC_SECRET` im Vault hinterlegen (nicht ins Repo committen), dann Job anlegen:

```sql
-- einmalig
select vault.create_secret('https://rzsptpfgzfigxmyyqdas.supabase.co', 'project_url');
select vault.create_secret('<SYNC_SECRET>', 'sync_secret');

-- Job: alle 30 Minuten
select cron.schedule('sync-zoho', '*/30 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-zoho',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')
    )
  );
$$);
```

Voraussetzung: Extensions `pg_cron` und `pg_net` aktiviert (Dashboard → Database → Extensions).
