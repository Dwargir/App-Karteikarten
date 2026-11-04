# Semesterkartei

Lern-App für die Uni: Dokumente hochladen, und Claude erstellt daraus Karteikarten, Zusammenfassungen nach deinem eigenen Masterprompt, Mindmaps, Glossare und Übungsklausuren. Die App plant jeden Tag, was du lernst, und merkt sich mit dem FSRS-Algorithmus, wie gut du jede Karte kannst.

## Funktionen

**Lernen**
- Tägliche Abfrage mit **FSRS** (dem Algorithmus aus Anki): Abstände passen sich deinem Gedächtnis an, Zielsicherheit einstellbar. Ab 200 Wiederholungen lässt sich FSRS an deinen eigenen Lernverlauf anpassen.
- **Rückgängig** in der Abfrage (Taste Z), **Karten bearbeiten** direkt in der Abfrage oder im Dokument, **Suche** über alle Karten.
- **Lernplan bis zur Prüfung:** Mit Prüfungstermin verteilt die App die neuen Karten auf die verbleibenden Tage, die letzten zwei Tage sind reine Wiederholung.
- **Kartentypen:** Frage/Antwort, Lückentext, Formeln (LaTeX), Abbildungen aus den Folien.
- **„Erklär mir das“:** Chat mit Claude zu jeder Karte, mit Nachfragen.
- **Schwächen-Analyse:** Claude findet die Lücken hinter oft falsch beantworteten Karten und erstellt gezielte Übungskarten.

**Aus den Unterlagen**
- Upload von PDF, PowerPoint (.pptx, mit Folienbildern und Sprechernotizen), Word, Text oder Fotos. Gescannte PDFs liest Claude direkt.
- Lange Skripte (bis etwa 200 Seiten Fließtext) werden automatisch in Teilen verarbeitet, nichts wird stillschweigend abgeschnitten.
- **Masterprompts:** eigene Anweisungen für Zusammenfassungen speichern und zwischen ihnen wechseln. Pro Dokument mehrere Versionen.
- Mindmap pro Dokument, Glossar pro Fach, **Klausur-Lernzettel** aus mehreren Dokumenten.
- Drucken oder als PDF speichern.
- Erklärvideos: YouTube-Suche oder mit API-Schlüssel direkt eingebettet.

**Prüfung und Gruppe**
- Übungsklausuren mit Multiple Choice und offenen Aufgaben, die Claude bewertet. Frühere Klausuren lassen sich mit Aufgaben, Antworten und Korrektur wieder öffnen.
- **Quiz-Duell** mit Kommilitonen über einen 6-stelligen Code.
- Kartenstapel **per Link teilen**.

**App**
- Installierbar als App (PWA) auf iPhone und Android, offline lernbar.
- Tägliche Erinnerung als Kalendertermin.
- **Sync** zwischen Geräten über dein Konto, Karte für Karte zusammengeführt (offline auf zwei Geräten lernen geht nichts verloren). Abbildungen werden mit synchronisiert und beim Teilen mitgeschickt. Backup-Export und -Import.
- **Prompt-Caching:** Folgeanfragen zum selben Dokument (weitere Karten, Mindmap, Erklär-Chat) lesen das Material günstig aus dem Cache.

## Einrichtung

1. **GitHub Pages:** Repository → Settings → Pages → Branch `main`, Ordner `/ (root)`. Die App läuft dann unter `https://dwargir.github.io/App-Karteikarten/`.
2. **Supabase** (Sync, Teilen, Duell, geschützter API-Schlüssel): Anleitung in [`docs/SUPABASE.md`](docs/SUPABASE.md).
3. **Ohne Supabase** geht es auch: In den Einstellungen einen eigenen Anthropic-API-Schlüssel eintragen. Dann liegen die Daten nur im Browser, Teilen per Link und Duell sind aus.

## Auf Netlify veröffentlichen

1. Auf <https://app.netlify.com> mit dem GitHub-Konto anmelden.
2. **Add new project → Import an existing project → GitHub** und das Repository `App-Karteikarten` wählen.
3. Branch auswählen (`main`). Die übrigen Einstellungen kommen aus `netlify.toml`: kein Build-Befehl, veröffentlicht wird der Hauptordner.
4. **Deploy** klicken. Nach etwa einer Minute läuft die App unter `https://<name>.netlify.app`. Jeder Push auf den Branch aktualisiert sie automatisch.

Wer später Supabase nutzt, trägt diese Netlify-Adresse dort als Site URL und Redirect URL ein (siehe `docs/SUPABASE.md`, Schritt 3).

## Lokal starten

Statische Seite ohne Build-Schritt:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Tests

Braucht nur Node.js (ab Version 20), keine Pakete:

```bash
npm test
```

Die Tests laden `js/core.js`, `js/features.js` und `js/views.js` in eine Node-VM und prüfen FSRS (inkl. Anpassung), Lernplan, Sync-Zusammenführung, Rückgängig, Kartenbearbeitung und Suche, Aufteilung langer Texte, PowerPoint-Auslesen, Markdown und JSON-Parsing. GitHub Actions führt sie bei jedem Push aus.

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
| `supabase/functions/claude/` | Edge Function als Claude-Proxy (Freigabeliste, Tageslimit) |
| `tests/` | Automatische Tests (`npm test`) |
| `tools/make_icons.py` | Erzeugt die App-Icons |

## Datenschutz

- Ohne Konto liegen alle Daten nur in deinem Browser. Mit Konto zusätzlich in deinem Supabase-Projekt, geschützt durch Row Level Security.
- Hochgeladene Inhalte gehen an die Anthropic-API (direkt oder über deine Edge Function).
- Ein eigener API-Schlüssel wird im `localStorage` gespeichert. Mit der Server-Variante liegt er nur auf dem Server.
- Abbildungen liegen mit Konto zusätzlich im privaten Storage-Bucket `img`. Geteilte Stapel legen ihre Abbildungen im öffentlichen Bucket `share-img` ab (lesbar für alle mit dem Link).
