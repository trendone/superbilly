-- ============================================================
-- superbilly – Login-Schritt: anon-Leserechte entfernen +
-- E-Mail-Domain serverseitig auf @trendone.com beschränken.
--
-- Voraussetzung: Magic-Link-Login (Supabase Auth) ist jetzt aktiv.
-- Damit entfällt der Dev-Notbehelf, dass anon (= nicht angemeldet)
-- lesen darf. Ab hier gilt: nur authenticated hat Zugriff
-- (auth_all-Policies aus 20260626190002_rls.sql bleiben bestehen).
-- ============================================================

-- 1) Dev-Notbehelf entfernen: anon darf nichts mehr lesen.
drop policy if exists dev_anon_read on employees;
drop policy if exists dev_anon_read on employee_hours_periods;
drop policy if exists dev_anon_read on projects;
drop policy if exists dev_anon_read on workpackages;
drop policy if exists dev_anon_read on milestones;
drop policy if exists dev_anon_read on bookings;
drop policy if exists dev_anon_read on actuals;

-- 2) Domain-Beschränkung: nur @trendone.com-Adressen dürfen ein Konto bekommen.
--    Greift beim ersten Magic-Link/Signup; verbindliche, serverseitige Durchsetzung
--    (der Clientcheck in auth.ts ist nur UX). SECURITY DEFINER, weil der Trigger
--    auf dem auth-Schema läuft.
create or replace function public.enforce_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if split_part(lower(new.email), '@', 2) <> 'trendone.com' then
    raise exception 'Nur @trendone.com-Adressen sind für superbilly zugelassen.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_email_domain_trg on auth.users;
create trigger enforce_email_domain_trg
  before insert on auth.users
  for each row execute function public.enforce_email_domain();
