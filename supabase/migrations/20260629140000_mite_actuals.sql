-- ============================================================
-- superbilly – Mite Ist-Zeiten (v2.3, konzept.md §3.7 & §4.5)
-- project_actuals: aggregierte Ist-Zeiten pro Projekt/Monat/Service aus Mite.
-- project_external_map: bestätigte Ausnahmen-Zuordnungen (Mite-Projekt → Projekt),
--   falls die Angebotsnummer im Mite-Projektnamen fehlt/abweicht.
-- ============================================================

-- ---------- Aggregierte Ist-Zeiten (koexistiert mit booking-bezogenem actuals) ----------
create table project_actuals (
  project_id   uuid not null references projects(id) on delete cascade,
  source       text not null default 'mite',
  period       date not null,                 -- Monatsanfang (für Verlauf)
  service_code text not null default '',      -- Mite service_id ('' wenn ohne Service)
  service_name text,                          -- z. B. "1.800€ Durchschnittstagessatz"
  minutes      int  not null default 0,
  revenue_eur  numeric,                        -- aus Mite-revenue (Cent) / 100
  updated_at   timestamptz not null default now(),
  primary key (project_id, source, period, service_code)
);
create index idx_project_actuals_project on project_actuals(project_id);

-- ---------- Ausnahmen-Mapping Mite-Projekt → Projekt (Mensch bestätigt) ----------
create table project_external_map (
  source      text not null,                   -- 'mite'
  external_id text not null,                   -- Mite project_id
  project_id  uuid not null references projects(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (source, external_id)
);
create index idx_project_external_map_project on project_external_map(project_id);

-- ---------- RLS (analog §4.7) ----------
alter table project_actuals     enable row level security;
alter table project_external_map enable row level security;

-- Ist-Zeiten: nur lesen für authenticated; Schreiben nur Service-Role (sync-mite, umgeht RLS)
create policy auth_read on project_actuals for select to authenticated using (true);

-- Mapping: authenticated darf pflegen (Ausnahmen werden im UI bestätigt)
create policy auth_all on project_external_map for all to authenticated using (true) with check (true);
