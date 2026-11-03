# Semesterkartei

Lern-App für die Uni: Dokumente hochladen, und Claude erstellt daraus automatisch Karteikarten, eine Zusammenfassung, Videovorschläge und Übungsklausuren. Die App fragt dich jeden Tag die Karten ab, die gerade fällig sind (Spaced Repetition).

## Funktionen

- **Upload:** PDF, Word (.docx), Text oder Fotos deiner Mitschrift. Gescannte PDFs liest Claude direkt.
- **Karteikarten:** 12–30 Karten pro Dokument, dazu eigene Karten und „10 weitere erstellen“.
- **Tägliche Abfrage:** Sechs Stufen. Gewusste Karten kommen nach 1, 3, 7, 16 und 35 Tagen wieder.
- **Zusammenfassung und Schlagworte** zu jedem Dokument.
- **Erklärvideos:** passende YouTube-Suchen zu den Kernthemen.
- **Übungsklausuren:** Multiple Choice und offene Aufgaben. Offene Antworten bewertet Claude mit Punkten und Feedback.
- **Fächer mit Prüfungstermin:** Countdown und Empfehlung, wie viel du pro Tag lernen solltest.
- **Statistik:** Lernserie, Trefferquote, Verlauf über 14 Tage, Fortschritt pro Fach.
- **Backup:** Export und Import als JSON-Datei.

## Einrichtung

1. App öffnen (GitHub Pages, siehe unten).
2. Oben rechts auf das Zahnrad tippen und einen **Anthropic-API-Schlüssel** eintragen. Den Schlüssel bekommst du unter <https://console.anthropic.com/settings/keys>. Die Kosten laufen über dein API-Guthaben, nicht über ein Claude-Abo.
3. Dokument hochladen und lernen.

## Datenschutz

- Alle Fächer, Dokumente und Karten liegen nur in deinem Browser (IndexedDB). Es gibt keinen Server.
- Der API-Schlüssel wird im `localStorage` deines Browsers gespeichert. Nutze die App deshalb nur auf eigenen Geräten.
- Hochgeladene Inhalte gehen direkt aus deinem Browser an die Anthropic-API.
- Auf ein anderes Gerät kommen deine Daten über **Einstellungen → Backup herunterladen / einspielen**.

## Lokal starten

Die App ist eine statische Seite ohne Build-Schritt:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Veröffentlichen mit GitHub Pages

Repository → **Settings → Pages** → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)`. Nach ein bis zwei Minuten ist die App unter `https://<dein-name>.github.io/semesterkartei/` erreichbar.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst, Navigation, Bibliotheken (pdf.js, mammoth) |
| `style.css` | Design (helles und dunkles Theme) |
| `app.js` | Gesamte Logik: Speicher, Claude-Aufrufe, Ansichten |
