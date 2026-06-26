-- ============================================================
-- superbilly – DEV-SEED (Beispieldaten für die Entwicklung)
-- NICHT für Produktion. Idempotent: leert vorhandene (Nicht-System-)Daten
-- und legt frische Beispieldaten an. Buchungen liegen in der AKTUELLEN Woche.
-- Anwenden:  psql "$SUPABASE_DB_URL" -f supabase/seed.sql
-- ============================================================

begin;

delete from actuals;
delete from bookings;
delete from workpackages;
delete from milestones;
delete from employees;
delete from projects where is_system = false;

-- ---------- Mitarbeiter ----------
insert into employees (name, email, weekly_hours) values
  ('Anna Müller',  'anna.mueller@trendone.com',  40),
  ('Ben Schulz',   'ben.schulz@trendone.com',    40),
  ('Carla Vogt',   'carla.vogt@trendone.com',    32),
  ('David Klein',  'david.klein@trendone.com',   40),
  ('Eva Brandt',   'eva.brandt@trendone.com',    40);

-- ---------- Projekte (echte, nicht System) ----------
insert into projects (name, color, status, client, budget_days) values
  ('Website Relaunch', '#7c6dfa', 'aktiv',   'Acme GmbH', 20),
  ('Mobile App',       '#34d399', 'aktiv',   'Globex',    35),
  ('Markenstrategie',  '#fb923c', 'akquise', 'Initech',   null);

-- ---------- Buchungen in der aktuellen Woche ----------
-- Anker: Montag der laufenden Woche.
insert into bookings (employee_id, project_id, start_date, end_date, budget, note)
select e.id, p.id, d.start, d.ende, d.budget, d.note
from (values
  -- (Mitarbeiter, Projekt, Tagesoffset von Mo, Endoffset, Budget, Notiz)
  ('Anna Müller', 'Website Relaunch', 0, 2, 1.0, 'Konzeptphase'),
  ('Anna Müller', 'Markenstrategie',  3, 3, 0.5, 'Workshop-Vorbereitung'),
  ('Ben Schulz',  'Mobile App',       0, 4, 1.0, 'Sprint 3'),
  ('Carla Vogt',  'Website Relaunch', 1, 2, 1.0, null),
  ('Carla Vogt',  'Urlaub',           3, 4, 1.0, null),
  ('David Klein', 'Mobile App',       0, 1, 0.5, 'Code Review'),
  ('David Klein', 'Markenstrategie',  2, 3, 1.0, 'Pitch'),
  ('Eva Brandt',  'Frei',             0, 0, 1.0, null),
  ('Eva Brandt',  'Website Relaunch', 1, 4, 1.0, 'QA & Launch')
) as v(emp, proj, off_start, off_end, budget, note)
join employees e on e.name = v.emp
join projects  p on p.name = v.proj
cross join lateral (
  select (date_trunc('week', current_date)::date + v.off_start) as start,
         (date_trunc('week', current_date)::date + v.off_end)   as ende,
         v.budget as budget, v.note as note
) d;

commit;
