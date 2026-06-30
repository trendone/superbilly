-- ============================================================
-- superbilly – Excel-Import (Billy-Liste) vorbereiten
-- 1) source='excel' für projects & bookings erlauben (bisher manuell/zoho bzw.
--    manuell/personio) – kennzeichnet importierte Excel-Daten.
-- 2) Unique-Index auf bookings.external_id: deterministischer Schlüssel je Buchung
--    macht den Import idempotent (Upsert) und ermöglicht spätere Delta-Importe.
--    NULLs bleiben erlaubt (bestehende/manuelle Buchungen).
-- ============================================================

alter table projects drop constraint if exists projects_source_check;
alter table projects add constraint projects_source_check
  check (source in ('manuell', 'zoho', 'excel'));

alter table bookings drop constraint if exists bookings_source_check;
alter table bookings add constraint bookings_source_check
  check (source in ('manuell', 'personio', 'excel'));

-- Partiell (where external_id is not null): manuelle Buchungen dürfen weiterhin
-- NULL haben; nur Import-/Personio-IDs sind eindeutig. ON CONFLICT muss dieses
-- Prädikat mitgeben (… on conflict (external_id) where external_id is not null …).
create unique index if not exists uq_bookings_external_id
  on bookings(external_id) where external_id is not null;
