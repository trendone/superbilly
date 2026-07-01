-- ============================================================
-- superbilly – Rollenmodell (admin | user)
--
-- Ziel: nur Admins dürfen den Bereich „Verwaltung" nutzen (Mitarbeiter,
-- Arbeitszeit-Perioden, Abteilungen, System-Kategorien). Alle angemeldeten
-- @trendone.com-Nutzer bleiben normale „user" (Planung: Buchungen, Projekte).
--
-- Rollen werden per E-Mail geführt (Login ist Magic-Link, E-Mail ist der
-- stabile Schlüssel). Wer nicht in user_roles steht, gilt als „user".
-- ============================================================

create table user_roles (
  email      text primary key,
  role       text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

-- E-Mail immer klein speichern (Login normalisiert ebenfalls auf lowercase).
create or replace function public.normalize_user_role_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(new.email);
  return new;
end;
$$;

create trigger normalize_user_role_email_trg
  before insert or update on user_roles
  for each row execute function public.normalize_user_role_email();

-- Ersten Admin setzen (weitere Admins danach über die Verwaltung).
insert into user_roles (email, role) values ('v.aspern@trendone.com', 'admin')
  on conflict (email) do update set role = 'admin';

-- ---------- Helper: ist der aktuelle Nutzer Admin? ----------
-- SECURITY DEFINER, damit die interne Abfrage RLS auf user_roles umgeht
-- (sonst Rekursion in der user_roles-Policy). search_path leer = sicher.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where email = lower(auth.jwt() ->> 'email') and role = 'admin'
  );
$$;

-- ---------- RLS für user_roles ----------
alter table user_roles enable row level security;

-- Lesen: jeder Angemeldete (das Frontend braucht die eigene Rolle fürs Tab-Gating).
create policy roles_read  on user_roles for select to authenticated using (true);
-- Schreiben: nur Admins (Rollen vergeben/entziehen).
create policy roles_write on user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- RLS-Härtung der Verwaltungs-Tabellen: Lesen für alle Angemeldeten,
-- Schreiben nur Admin. Diese Tabellen werden ausschließlich im Bereich
-- „Verwaltung" gepflegt; die Planung (Buchungen/Projekte) bleibt unberührt.
-- ============================================================

-- employees ------------------------------------------------------------------
drop policy if exists auth_all      on employees;
drop policy if exists dev_anon_read on employees;   -- Sicherheitshalber
create policy emp_read  on employees for select to authenticated using (true);
create policy emp_write on employees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- employee_hours_periods -----------------------------------------------------
drop policy if exists auth_all      on employee_hours_periods;
drop policy if exists dev_anon_read on employee_hours_periods;
create policy hp_read  on employee_hours_periods for select to authenticated using (true);
create policy hp_write on employee_hours_periods for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- departments ----------------------------------------------------------------
drop policy if exists auth_all      on departments;
drop policy if exists dev_anon_read on departments;  -- war seit der departments-Migration noch aktiv
create policy dep_read  on departments for select to authenticated using (true);
create policy dep_write on departments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Hinweis: System-Kategorien sind projects.is_system=true. projects wird auch
-- von der Planung geschrieben (manuelle Projekte), daher bleibt projects hier
-- bewusst mit auth_all offen; das Tab-Gating im Frontend verhindert den Zugriff
-- über die UI. Eine feinere projects-Härtung ist ein eigener Schritt.
