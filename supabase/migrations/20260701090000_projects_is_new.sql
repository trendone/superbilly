-- ============================================================
-- superbilly – projects.is_new: Kennzeichnung frisch aus Zoho importierter
-- Projekte für den neuen Bereich "Neue Projekte" (Pipeline: neu + noch nicht
-- verplante Projekte). Wird von sync-zoho auf true gesetzt, wenn der Deal
-- (external_id) vorher noch nicht in der Tabelle existierte. Automatisch
-- zurückgesetzt, sobald die erste Planungsbuchung angelegt wird
-- (src/lib/data.ts createBooking).
-- ============================================================

alter table projects add column if not exists is_new boolean not null default false;
