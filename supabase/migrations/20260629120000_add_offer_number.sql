-- ============================================================
-- superbilly – projects.offer_number (Vorbereitung v2.1 Zoho / v2.3 Mite)
-- Angebotsnummer aus Zoho (Quotes.Angebotsnummer, Format "A - 8009").
-- Join-Key zu Mite (siehe konzept.md §4.5). Ein Eintrag je Angebot.
-- ============================================================

alter table projects add column if not exists offer_number text;

-- Schneller Gleichheits-Join Mite ↔ Projekt über die Angebotsnummer.
create index if not exists idx_projects_offer_number
  on projects(offer_number) where offer_number is not null;
