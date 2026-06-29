-- ============================================================
-- superbilly – milestones um Integrations-Felder erweitern (v2.x)
-- Rechnungs-Meilensteine kommen aus Zoho-Modul „Abgrenzungen" (sync-abgrenzungen).
-- external_id = Abgrenzungs-Datensatz-ID (Idempotenz), source unterscheidet
-- manuell gepflegte von gespiegelten Meilensteinen.
-- ============================================================

alter table milestones add column if not exists external_id text;
alter table milestones add column if not exists source text not null default 'manuell'
  check (source in ('manuell','zoho'));
alter table milestones add column if not exists invoice_number text;

-- Idempotenz: vollwertige Unique-Constraint (mehrere NULLs für manuelle Meilensteine erlaubt).
alter table milestones add constraint milestones_external_id_key unique (external_id);
