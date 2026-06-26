-- ============================================================
-- superbilly – Zusätzliche System-Kategorie "Kurzarbeit"
-- Entscheidung Import: Kurzarbeit = eigene nicht-buchbare Kategorie,
-- "UNI" wird beim Import auf "Admin" gemappt (keine eigene Kategorie).
-- ============================================================

insert into projects (name, color, is_system, status) values
  ('Kurzarbeit', '#0ea5e9', true, 'aktiv');
