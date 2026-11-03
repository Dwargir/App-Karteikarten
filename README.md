# Semesterkartei

Lern-App für die Uni: Dokumente hochladen, und Claude erstellt daraus Karteikarten, Zusammenfassungen nach deinem eigenen Masterprompt, Mindmaps, Glossare und Übungsklausuren. Die App plant jeden Tag, was du lernst, und merkt sich mit dem FSRS-Algorithmus, wie gut du jede Karte kannst.

## Funktionen

**Lernen**
- Tägliche Abfrage mit **FSRS** (dem Algorithmus aus Anki): Abstände passen sich deinem Gedächtnis an, Zielsicherheit einstellbar.
- **Lernplan bis zur Prüfung:** Mit Prüfungstermin verteilt die App die neuen Karten auf die verbleibenden Tage, die letzten zwei Tage sind reine Wiederholung.
- **Kartentypen:** Frage/Antwort, Lückentext, Formeln (LaTeX), Abbildungen aus den Folien.
- **„Erklär mir das“:** Chat mit Claude zu jeder Karte, mit Nachfragen.
- **Schwächen-Analyse:** Claude findet die Lücken hinter oft falsch beantworteten Karten und erstellt gezielte Übungskarten.

**Aus den Unterlagen**
- Upload von PDF, Word, Text oder Fotos. Gescannte PDFs liest Claude direkt.
- **Masterprompts:** eigene Anweisungen für Zusammenfassungen speichern und zwischen ihnen wechseln. Pro Dokument mehrere Versionen.
- Mindmap pro Dokument, Glossar pro Fach, **Klausur-Lernzettel** aus mehreren Dokumenten.
- Drucken oder als PDF speichern.
- Erklärvideos: YouTube-Suche oder mit API-Schlüssel direkt eingebettet.

**Prüfung und Gruppe**
- Übungsklausuren mit Multiple Choice und offenen Aufgaben, die Claude bewertet.
- **Quiz-Duell** mit Kommilitonen über einen 6-stelligen Code.
- Kartenstapel **per Link teilen**.

**App**
- Installierbar als App (PWA) auf iPhone und Android, offline lernbar.
- Tägliche Erinnerung als Kalendertermin.
- **Sync** zwischen Geräten über dein Konto. Backup-Export und -Import.

## Einrichtung

1. **GitHub Pages:** Repository → Settings → Pages → Branch `main`, Ordner `/ (root)`. Die App läuft dann unter `https://dwargir.github.io/App-Karteikarten/`.
2. **Supabase** (Sync, Teilen, Duell, geschützter API-Schlüssel): Anleitung in [`docs/SUPABASE.md`](docs/SUPABASE.md).
3. **Ohne Supabase** geht es auch: In den Einstellungen einen eigenen Anthropic-API-Schlüssel eintragen. Dann liegen die Daten nur im Browser, Teilen per Link und Duell sind aus.

## Lokal starten

Statische Seite ohne Build-Schritt:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst, Navigation, Bibliotheken |
| `config.js` | Supabase-URL und Anon-Key |
| `style.css` | Design, helles und dunkles Theme, Druckansicht |
| `js/core.js` | Helfer, Zustand, IndexedDB, Sync, Claude-Aufrufe, FSRS |
| `js/features.js` | Lernplan, Generierung, Abfrage, Klausur, Chat, Glossar, Mindmap, Lernzettel, Teilen, Duell |
| `js/views.js` | Alle Ansichten |
| `js/main.js` | Rendern, Ereignisse, Start |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `supabase/schema.sql` | Tabellen und Zugriffsregeln |
| `supabase/functions/claude/` | Edge Function als Claude-Proxy |

## Datenschutz

- Ohne Konto liegen alle Daten nur in deinem Browser. Mit Konto zusätzlich in deinem Supabase-Projekt, geschützt durch Row Level Security.
- Hochgeladene Inhalte gehen an die Anthropic-API (direkt oder über deine Edge Function).
- Ein eigener API-Schlüssel wird im `localStorage` gespeichert. Mit der Server-Variante liegt er nur auf dem Server.
