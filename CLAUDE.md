# Semesterkartei – Hinweise für Claude Code

Statische Web-App ohne Build-Schritt (Vanilla JS, klassische Skripte mit gemeinsamem globalem Scope), gehostet auf GitHub Pages, optional mit Supabase. UI-Texte sind Deutsch.

## Dateien
- `js/core.js`: Helfer (`esc`, `md`, `renderMath`), Zustand `S`, IndexedDB (`save`, `remove`, Bilder im Store `img`), `Sync` (Supabase-Tabelle `kv`, Last-Write-Wins über `_u`/`ts`, Tombstones), `callClaude`/`askJSON`/`askText` (direkt mit eigenem Schlüssel oder über Edge Function `claude`), `FSRS`.
- `js/features.js`: Fachlogik (Lernplan `planToday`, Upload `genStart`, `grade`, Klausur, Erklär-Chat, Glossar, Mindmap, Lernzettel, Schwächen, YouTube, Teilen, Duell, Backup).
- `js/views.js`: Ansichten `v…` liefern HTML-Strings. Nutzertext immer über `esc()` oder `md()`.
- `js/main.js`: `VIEWS`, `render`/`softRender`, Aktionen im Objekt `ACT` (ausgelöst über `data-act` / `data-v`), Formular- und Eingabe-Handler, Start.

## Datenmodell (IndexedDB `semesterkartei`, Store `kv`)
- `profile`: Fächer (mit `examDate`, `glossary`, `sheets`, `weak`), `log` (pro Tag `n`, `ok`, `newBy`), `exams`, `prompts` + `activePromptId`, `prefs`.
- `d-…`: Dokument mit `summaries[]` + `activeSummary`, `cards[]` (`kind` basic|cloze, FSRS-Felder `s`, `d`, `due`, `last`, `reps`, `lapses`, optional `img`), `text`, `mindmap`, `videos`, `videoResults`.

## Regeln
- Bei Änderungen an App-Dateien `VERSION` in `sw.js` erhöhen.
- Farben nur über CSS-Variablen; helles und dunkles Theme pflegen.
- Neue Supabase-Tabellen immer mit Row Level Security in `supabase/schema.sql`.
