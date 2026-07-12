-- ============================================================
-- superbilly – Vorgemerkte Ressourcen: neue Projekt-Status
--
-- Offene Zoho-Deals (Stage "Angebot verschickt" / "Verhandlungsphase")
-- werden über sync-zoho zusätzlich als Projekte gespiegelt und sind in der
-- Planung als vorgemerkte (reservierte) Ressource buchbar – schraffiert und
-- ohne Auslastungswirkung. Wird ein Deal beauftragt, setzt der Sync den Status
-- auf 'aktiv' (Buchungen zählen ab dann normal); geht er verloren, auf 'verloren'
-- (aus der Planung ausgeblendet). Der bestehende CHECK-Constraint kennt diese
-- Werte nicht und würde den Upsert blockieren – daher hier erweitern.
-- ============================================================

alter table projects drop constraint if exists projects_status_check;

alter table projects add constraint projects_status_check
  check (status in (
    'akquise','aktiv','pausiert','abgeschlossen',
    'angebot','verhandlung','verloren'
  ));
