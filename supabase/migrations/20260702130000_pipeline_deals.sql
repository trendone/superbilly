-- ============================================================
-- superbilly – v2.2 Pipeline-Forecast: offene Zoho-Deals als weiche Last.
--
-- Bewusst eine EIGENE Tabelle (nicht ein Flag auf projects), damit die Pipeline
-- vollständig vom committed-Datenmodell isoliert bleibt: Planungsraster (Billy),
-- Auswertung und Projekte lesen projects/bookings und sehen davon nichts.
--
-- Befüllt von der Edge Function sync-pipeline (COQL auf Deals, Stage ∈
-- {Angebot versendet, Verhandlungsphase}, Leistungsbereich = Consulting),
-- delete-all + insert je Lauf (volatil: verlässt ein Deal die Stages,
-- verschwindet er). Read-only im Client (Service-Role umgeht RLS, Muster wie
-- project_actuals / sync_unmatched, Konzept §4.7).
-- ============================================================

create table pipeline_deals (
  external_id    text primary key,        -- Zoho Deal-ID (Idempotenz)
  name           text not null,           -- Deal_Name
  client         text,                    -- Account_Name
  stage          text,                    -- Zoho Deal-Stage (Angebot versendet | Verhandlungsphase)
  probability    int,                     -- Zoho Probability 0..100 (Gewichtung der weichen Last)
  amount_eur     numeric,                 -- Volumen netto (→ erwartete Tage = /2000)
  closing_date   date,                    -- Abschlussdatum (Start der Verteilung)
  service_date   date,                    -- Leitungserbringung (Info/Fallback)
  source         text not null default 'zoho',
  last_synced_at timestamptz not null default now()
);

alter table pipeline_deals enable row level security;
-- Lesen für alle Angemeldeten; Schreiben nur via Service-Role (Sync, umgeht RLS).
create policy pipeline_read on pipeline_deals for select to authenticated using (true);
