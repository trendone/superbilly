-- ============================================================
-- superbilly – Initiales Schema (v1.1 Fundament)
-- Entspricht Abschnitt 3 in konzept.md. Postgres 17 (gen_random_uuid built-in).
-- ============================================================

-- ---------- Stammdaten ----------
create table employees (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text unique,                 -- Mapping-Schlüssel (Personio/SSO)
  weekly_hours numeric not null default 40,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table employee_hours_periods (       -- abweichende Arbeitszeiten
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees(id) on delete cascade,
  valid_from   date not null,
  weekly_hours numeric not null
);
create index idx_hours_periods_employee on employee_hours_periods(employee_id);

-- ---------- Projekte ----------
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,
  status      text not null default 'aktiv'
              check (status in ('akquise','aktiv','pausiert','abgeschlossen')),
  client      text,
  start_date  date,
  end_date    date,
  budget_days numeric,
  budget_eur  numeric,
  is_system   boolean not null default false,   -- Urlaub/Krank/Admin/Frei
  source      text not null default 'manuell' check (source in ('manuell','zoho')),
  external_id text,                              -- Zoho Deal-ID (Idempotenz)
  probability int,                               -- nur Pipeline-Deals
  created_at  timestamptz not null default now()
);
create unique index uq_projects_external_id on projects(external_id) where external_id is not null;

-- ---------- Arbeitspakete (PM-Kern) ----------
create table workpackages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  title       text not null,
  budget_days numeric,
  start_date  date,
  end_date    date,
  assignee_id uuid references employees(id) on delete set null,
  done        boolean not null default false
);
create index idx_workpackages_project on workpackages(project_id);

-- ---------- Meilensteine (Rechnungslogik) ----------
create table milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  title          text not null,
  due_date       date,
  amount_eur     numeric,
  invoice_status text not null default 'offen'
                 check (invoice_status in ('offen','gestellt','bezahlt'))
);
create index idx_milestones_project on milestones(project_id);

-- ---------- Buchungen (heute "tasks") ----------
create table bookings (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  workpackage_id uuid references workpackages(id) on delete set null,
  employee_id    uuid not null references employees(id) on delete cascade,
  start_date     date not null,
  end_date       date not null,
  budget         numeric not null check (budget in (0.5, 1)),
  note           text,
  locked         boolean not null default false,   -- aus Personio gespiegelt
  source         text not null default 'manuell' check (source in ('manuell','personio')),
  external_id    text,                             -- Personio-Abwesenheits-ID
  created_at     timestamptz not null default now(),
  check (end_date >= start_date)
);
create index idx_bookings_employee on bookings(employee_id);
create index idx_bookings_project on bookings(project_id);
create unique index uq_bookings_external_id on bookings(external_id) where external_id is not null;

-- ---------- Ist-Zeiterfassung (optional, später genutzt) ----------
create table actuals (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid references bookings(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  date        date not null,
  hours       numeric not null
);
create index idx_actuals_booking on actuals(booking_id);

-- ---------- System-Kategorien (kein Projektpool) ----------
-- Nicht-buchbare Zeit; aus Projekt-Reports ausgeklammert. "Frei" = freie Tage.
insert into projects (name, color, is_system, status) values
  ('Urlaub', '#64748b', true, 'aktiv'),
  ('Krank',  '#ef4444', true, 'aktiv'),
  ('Admin',  '#f59e0b', true, 'aktiv'),
  ('Frei',   '#94a3b8', true, 'aktiv');
