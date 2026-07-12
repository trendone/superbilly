-- ============================================================
-- superbilly – Manuelle Verknüpfung Nicht-Zoho-Projekt → Zoho-Projekt
--
-- Ein intern/per Excel angelegtes Projekt kann von Hand mit einem gespiegelten
-- Zoho-Projekt „zusammengeführt" werden: das interne Projekt bleibt Träger der
-- Buchungen und zeigt zusätzlich Budget + Meilensteine des Zoho-Deals; die
-- separate Zoho-Karte wird in der Projektliste ausgeblendet.
--
-- Umgesetzt als self-FK `linked_project_id` auf dem NICHT-Zoho-Projekt, die auf
-- die id des Zoho-Projekts zeigt. Wichtig für „übersteht Re-Import": der
-- sync-zoho-Upsert schreibt ausschließlich source='zoho'-Zeilen und nimmt
-- `linked_project_id` nie in die Payload auf → die Verknüpfung bleibt beim
-- erneuten Import unangetastet (die id des Zoho-Projekts ist über
-- on_conflict=external_id stabil).
-- ============================================================

alter table projects
  add column if not exists linked_project_id uuid references projects(id) on delete set null;

-- Kein Selbstbezug.
alter table projects drop constraint if exists projects_linked_not_self;
alter table projects add constraint projects_linked_not_self
  check (linked_project_id is null or linked_project_id <> id);

-- 1:1 – ein Zoho-Projekt darf nur von genau einem internen Projekt beansprucht
-- werden, damit das Ausblenden der Zoho-Karte eindeutig bleibt.
create unique index if not exists uq_projects_linked_project
  on projects(linked_project_id) where linked_project_id is not null;
