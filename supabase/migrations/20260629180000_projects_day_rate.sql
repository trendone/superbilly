-- ============================================================
-- superbilly – projects.day_rate_eur (manueller Tagessatz-Override)
-- Tagessatz-Logik in der Auswertung: manuell (dieses Feld) > aus Mite abgeleitet
-- > Standard 2.000 €. Budget in Tagen = budget_eur / effektiver Tagessatz.
-- ============================================================

alter table projects add column if not exists day_rate_eur numeric;
