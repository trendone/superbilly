-- ============================================================
-- superbilly – milestones.product (Leistungskategorie/Produkttyp)
-- Aus Zoho Abgrenzung.Produkt (z. B. "Consulting / Visionary Keynote / 50100").
-- Format: Bereich / Leistungstyp / KTR-Nummer. Dient als Filterdimension in
-- der Auswertung (Projekt-Kategorie = dominantes Produkt seiner Meilensteine).
-- ============================================================

alter table milestones add column if not exists product text;
