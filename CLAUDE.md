# Semesterkartei – Hinweise für Claude Code

Statische Web-App ohne Build-Schritt (Vanilla JS), gehostet auf GitHub Pages. UI-Texte sind Deutsch.

- `app.js`: Zustand in `S`; Ansichten sind Funktionen `vHeute`, `vFaecher`, `vDoc`, `vUpload`, `vReview`, `vKlausur`, `vStats`, `vSettings`, die HTML-Strings liefern (`VIEWS`). Klicks laufen über `data-act` / `data-v` und das Objekt `ACT`.
- Speicher: IndexedDB `semesterkartei`, Store `kv`. Schlüssel `profile` (Fächer, Lernlog, Klausurergebnisse) und je Dokument eine ID `d-…` mit `type:"doc"` inkl. Karten.
- Claude: `askJSON(prompt, {images, pdfs, signal, maxTokens, onProgress})` ruft die Messages-API direkt aus dem Browser auf (Header `anthropic-dangerous-direct-browser-access`), streamt und parst JSON.
- Spaced Repetition: `INTERVALS` (Tage je Stufe 0–5), `nextBox`, `grade`.
- Farben nur über CSS-Variablen in `style.css`; helles und dunkles Theme pflegen.
- Benutzertexte immer mit `esc()` einsetzen.
