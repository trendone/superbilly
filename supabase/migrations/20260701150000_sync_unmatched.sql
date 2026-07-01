-- ============================================================
-- superbilly – Mapping-Admin: nicht zugeordnete Sync-Einträge sichtbar machen
--
-- Bisher landeten „unmatched"-Fälle nur ephemer im Sync-Response. Für ein
-- Mapping-UI im Frontend werden sie jetzt bei jedem Sync-Lauf persistiert:
--   - Mite: Mite-Projekte, deren Angebotsnummer (^A - <nr>) kein projects.offer_number
--     trifft und für die kein Override in project_external_map existiert. → aktionabel:
--     Admin ordnet sie einem Projekt zu (schreibt project_external_map).
--   - Zoho-Abgrenzung: Abgrenzungen, deren Verkaufschance (Deal-ID) kein
--     projects.external_id trifft (Deal (noch) nicht synchronisiert). → informativ.
-- ============================================================

create table sync_unmatched (
  source         text not null,          -- 'mite' | 'zoho-abgrenzung'
  external_id    text not null,          -- Mite project_id | Abgrenzung-id
  label          text,                   -- Mite-Projektname | Abgrenzung-Beschreibung
  detail         text,                   -- z. B. Deal-ID (Verkaufschance) bei Zoho
  minutes        int,                    -- akkumulierte Mite-Minuten (nur Mite)
  amount_eur     numeric,                -- Umsatz (nur Zoho-Abgrenzung)
  last_synced_at timestamptz not null default now(),
  primary key (source, external_id)
);

alter table sync_unmatched enable row level security;
-- Lesen: alle Angemeldeten (UI-Anzeige). Schreiben (Ignorieren/Aufräumen): nur Admin.
-- Der Sync selbst schreibt via Service-Role und umgeht RLS.
create policy unmatched_read  on sync_unmatched for select to authenticated using (true);
create policy unmatched_write on sync_unmatched for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Ausnahmen-Mapping (Mite→Projekt) auf Admin-Schreibrecht härten (bisher auth_all).
drop policy if exists auth_all on project_external_map;
create policy pem_read  on project_external_map for select to authenticated using (true);
create policy pem_write on project_external_map for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
