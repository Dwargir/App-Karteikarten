# Semesterkartei – Hinweise für Claude Code

Statische Web-App ohne Build-Schritt (Vanilla JS, klassische Skripte mit gemeinsamem globalem Scope), gehostet auf GitHub Pages, optional mit Supabase. UI-Texte sind Deutsch.

## Dateien
- `js/core.js`: Helfer (`esc`, `md`, `renderMath`), Zustand `S`, Zusammenführen (`mergeDoc`, `mergeProfile`, `mergeRevlog`), IndexedDB (`save`, `remove`, Bilder im Store `img` + `Img` für Supabase Storage), `Sync` (Tabelle `kv`; bei lokal geänderten Schlüsseln wird zusammengeführt statt überschrieben, `push` holt vorher), `callClaude`/`askJSON`/`askText` (Option `context` → gecachter system-Block über `cachedSystem`), `FSRS` (`step`, `next`, `optimize`).
- `js/features.js`: Fachlogik (Lernplan `planToday`, Upload `genStart` mit `splitText` für lange Texte und `extractPptx`, `grade`/`undoGrade`, `editCard`/`deleteCard`/`searchCards`, Klausur + `openExam`, Erklär-Chat, Glossar, Mindmap, Lernzettel, Schwächen, YouTube, Teilen mit Bildern, Duell, `optimizeFsrs`, Backup).
- `js/views.js`: Ansichten `v…` liefern HTML-Strings. Nutzertext immer über `esc()` oder `md()`.
- `js/main.js`: `VIEWS`, `render`/`softRender`, Aktionen im Objekt `ACT` (ausgelöst über `data-act` / `data-v`), Formular- und Eingabe-Handler, Start.

## Datenmodell (IndexedDB `semesterkartei`, Store `kv`)
- `profile`: Fächer (mit `examDate`, `glossary`, `sheets`, `weak`), `log` (pro Tag `n`, `ok`, `newBy`), `exams` (Kurzfassung mit `id`), `prompts` + `activePromptId`, `prefs` (inkl. `fsrsW`, `fsrsInfo`), Löschmarken `delSubjects`, `delPrompts`.
- `d-…`: Dokument mit `summaries[]` + `activeSummary`, `cards[]` (`kind` basic|cloze, FSRS-Felder `s`, `d`, `due`, `last`, `reps`, `lapses`, Änderungszeit `u`, optional `img`), Löschmarken `delCards`, `text` (bis 80.000 Zeichen), `parts`, `warnings`, `mindmap`, `videos`, `videoResults`.
- `revlog`: Lernverlauf `items` = `[kartenId, zeit, note 1-4, neu 0|1]`, zurückgenommene Einträge in `del`.
- `x-…`: frühere Übungsklausur (`questions`, `answers`, `results`).
- Bilder: Store `img`, Schlüssel `<docId>:<seite>`; mit Konto auch im Bucket `img` unter `<userId>/<docId>/<seite>.jpg`.

## Regeln
- Bei Änderungen an App-Dateien `VERSION` in `sw.js` erhöhen.
- Farben nur über CSS-Variablen; helles und dunkles Theme pflegen.
- Neue Supabase-Tabellen immer mit Row Level Security in `supabase/schema.sql`.
- Karten ändern immer mit `u = Date.now()`, Karten/Fächer/Prompts löschen immer mit Löschmarke (`addTomb`), sonst holt der Sync sie zurück.
- Prompts mit Dokumentbezug geben das Material über `context` (bzw. `docContext(d)`) mit, nicht im Prompttext, damit der Cache greift.
- Vor dem Commit `npm test` ausführen; neue Logik in `tests/app.test.js` abdecken.
