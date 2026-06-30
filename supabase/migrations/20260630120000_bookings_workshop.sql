-- Markiert eine Buchung als Workshop (eigene Kachelfarbe im Planungsraster).
alter table public.bookings
  add column if not exists is_workshop boolean not null default false;
