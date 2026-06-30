-- Abteilungen: einfaches Merkmal („Tag") für Mitarbeiter. Jeder Mitarbeiter
-- gehört zu höchstens einer Abteilung (eindeutig). Dient der Gruppierung im
-- Planungsraster und späteren Auswertungen.

create table departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- Eindeutige Zuordnung; beim Löschen der Abteilung bleibt der Mitarbeiter
-- bestehen und wird „ohne Abteilung".
alter table employees
  add column if not exists department_id uuid references departments(id) on delete set null;
create index idx_employees_department on employees(department_id);

-- RLS analog zu den übrigen Tabellen (authenticated Vollzugriff, anon DEV-Lesen).
alter table departments enable row level security;
create policy auth_all       on departments for all    to authenticated using (true) with check (true);
create policy dev_anon_read  on departments for select to anon          using (true);
