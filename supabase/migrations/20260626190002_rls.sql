-- ============================================================
-- superbilly – Row-Level-Security (v1.1 Fundament)
-- Sicherheitsmodell: angemeldete Nutzer (authenticated) haben Vollzugriff.
--
-- HINWEIS (DEV): Solange noch kein Login existiert, erhält die anon-Rolle
-- vorübergehend LESERECHT, damit das Frontend bereits Daten zeigen kann.
-- Diese anon-Policies werden entfernt, sobald der E-Mail-/SSO-Login steht
-- (siehe konzept.md §4.6). Es liegen noch keine sensiblen Daten vor.
-- ============================================================

alter table employees             enable row level security;
alter table employee_hours_periods enable row level security;
alter table projects              enable row level security;
alter table workpackages          enable row level security;
alter table milestones            enable row level security;
alter table bookings              enable row level security;
alter table actuals               enable row level security;

-- Angemeldete Nutzer: Vollzugriff (Rollen Planer/Admin folgen später)
create policy auth_all on employees              for all to authenticated using (true) with check (true);
create policy auth_all on employee_hours_periods for all to authenticated using (true) with check (true);
create policy auth_all on projects               for all to authenticated using (true) with check (true);
create policy auth_all on workpackages           for all to authenticated using (true) with check (true);
create policy auth_all on milestones             for all to authenticated using (true) with check (true);
create policy auth_all on bookings               for all to authenticated using (true) with check (true);
create policy auth_all on actuals                for all to authenticated using (true) with check (true);

-- DEV-only: anon darf vorerst lesen (vor Login). Beim Auth-Schritt entfernen.
create policy dev_anon_read on employees              for select to anon using (true);
create policy dev_anon_read on employee_hours_periods for select to anon using (true);
create policy dev_anon_read on projects               for select to anon using (true);
create policy dev_anon_read on workpackages           for select to anon using (true);
create policy dev_anon_read on milestones             for select to anon using (true);
create policy dev_anon_read on bookings               for select to anon using (true);
create policy dev_anon_read on actuals                for select to anon using (true);
