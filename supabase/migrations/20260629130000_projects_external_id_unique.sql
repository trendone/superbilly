-- ============================================================
-- superbilly – projects.external_id: vollwertige Unique-Constraint
-- Der ursprüngliche partielle Unique-Index (where external_id is not null)
-- kann von PostgREST-Upsert (on_conflict=external_id) NICHT genutzt werden
-- → Fehler 42P10. Eine reguläre Unique-Constraint erlaubt weiterhin mehrere
-- NULLs (System-Kategorien Urlaub/Krank/Admin/Frei/Kurzarbeit) und macht den
-- idempotenten Zoho-Sync (sync-zoho) möglich.
-- ============================================================

drop index if exists uq_projects_external_id;

alter table projects
  add constraint projects_external_id_key unique (external_id);
