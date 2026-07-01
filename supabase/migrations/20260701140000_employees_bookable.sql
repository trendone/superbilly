-- ============================================================
-- superbilly – Mitarbeiter „nicht buchbar" (z. B. Geschäftsführung, Assistenz)
--
-- Solche Personen sollen als Stammdatensatz existieren, aber NICHT in der
-- Planungsansicht (Billy-Raster) und Auswertung auftauchen. Steuerung über
-- ein Flag; im Admin per Checkbox „nicht buchbar" (= bookable=false) setzbar.
-- ============================================================

alter table employees
  add column if not exists bookable boolean not null default true;
