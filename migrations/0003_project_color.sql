-- Kolor projektu wybierany przez użytkownika ('' = kolor automatyczny)
ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT '';
