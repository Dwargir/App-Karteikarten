# Supabase einrichten (ca. 10 Minuten)

Supabase ist der kostenlose Server hinter Sync, Teilen per Link, Quiz-Duell und dem geschützten Claude-Zugang. Du brauchst nur einen Browser.

## 1. Projekt anlegen

1. Auf <https://supabase.com> mit GitHub anmelden.
2. **New project**: Name `semesterkartei`, ein Datenbank-Passwort vergeben (gut aufheben), Region **Frankfurt (eu-central-1)**.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).

## 2. Datenbank-Tabellen anlegen

1. Links **SQL Editor** → **New query**.
2. Den kompletten Inhalt von [`supabase/schema.sql`](../supabase/schema.sql) einfügen → **Run**.
3. Es sollte „Success. No rows returned“ erscheinen. Das Skript legt auch die Tabelle für das Tageslimit und die Storage-Buckets `img` und `share-img` für Abbildungen an.

> **Update von einer älteren Version:** Das Skript einfach noch einmal komplett ausführen. Es ist so geschrieben, dass vorhandene Tabellen und Daten erhalten bleiben.

## 3. Anmeldung einstellen

1. Links **Authentication → URL Configuration**.
2. **Site URL**: `https://dwargir.github.io/App-Karteikarten/`
3. Unter **Redirect URLs** dieselbe Adresse hinzufügen.
4. Optional, wenn nur du (und ausgewählte Freunde) die App nutzen sollen: **Authentication → Sign In / Providers → Email** und nach dem Anlegen eurer Konten **Allow new users to sign up** ausschalten.

## 4. Claude-Funktion anlegen (API-Schlüssel sicher auf dem Server)

1. Links **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name: `claude` (genau so).
3. Den Inhalt von [`supabase/functions/claude/index.ts`](../supabase/functions/claude/index.ts) einfügen → **Deploy**.
4. **Edge Functions → Secrets** (bzw. **Manage secrets**) und anlegen:
   - `ANTHROPIC_API_KEY` = dein Schlüssel von <https://console.anthropic.com/settings/keys>
   - `ALLOWED_EMAILS` = `du@uni.de,freundin@uni.de` – nur diese Konten dürfen Claude über deinen Schlüssel nutzen. **Ohne diese Liste lehnt die Funktion jede Anfrage ab**, damit sich niemand Fremdes registriert und auf deine Kosten Claude nutzt.
   - nur falls wirklich jedes registrierte Konto Claude nutzen soll: `ALLOW_ALL_USERS` = `true` (statt `ALLOWED_EMAILS`).
   - optional `DAILY_LIMIT` = Anfragen pro Konto und Tag (Standard `150`, `0` = kein Limit). Wer das Limit erreicht, sieht in der App einen Hinweis und kann am nächsten Tag weitermachen. Wie viel jedes Konto verbraucht hat, steht in der Tabelle `usage`.
5. Nach einer Änderung an `index.ts` die Funktion neu deployen (im Editor auf **Deploy**).

> Ohne Edge Function funktioniert die App trotzdem: Dann trägt jede Person in den Einstellungen einen eigenen API-Schlüssel ein.

## 5. App mit Supabase verbinden

1. Links **Project Settings → API** (bzw. **Data API**).
2. **Project URL** und den Key **anon public** kopieren.
3. Im Repository die Datei `config.js` öffnen und beide Werte eintragen:

   ```js
   window.SK_CONFIG = {
     supabaseUrl: "https://abcdxyz.supabase.co",
     supabaseAnonKey: "eyJhbGciOi...",
     useProxyByDefault: true
   };
   ```

   Beide Werte sind öffentlich und dürfen ins Repository. Die Daten schützt Row Level Security: Jede Person sieht nur ihre eigenen Karten.
4. Änderung committen. Nach ein bis zwei Minuten ist GitHub Pages aktualisiert.

Alternativ kannst du die Werte auch nur auf deinem Gerät eintragen: **Einstellungen → Konto und Sync → Server-Verbindung**.

## 6. Konto anlegen

In der App: **Einstellungen → Konto und Sync → Registrieren**. Bestätige die E-Mail und melde dich an. Deine bisherigen Karten werden automatisch ins Konto übernommen und auf allen Geräten synchronisiert, auf denen du angemeldet bist.

## Kosten

- Supabase: Der kostenlose Plan reicht für dich und eine Lerngruppe locker. Projekte ohne Aktivität pausiert Supabase nach einer Woche; ein Klick im Dashboard weckt sie wieder.
- Claude: Abgerechnet über dein Anthropic-API-Guthaben. Ein Skript mit 30 Seiten kostet mit Sonnet je nach Länge grob einige Cent.

## Was wo liegt

| Daten | Ort |
| --- | --- |
| Fächer, Dokumente, Karten, Lernfortschritt, Masterprompts | Tabelle `kv` (nur für dich lesbar) |
| Abbildungen aus Folien | Storage-Bucket `img` (privat, nur für dich) und auf jedem Gerät im Browser |
| Lernverlauf (für die FSRS-Anpassung) | Tabelle `kv`, Schlüssel `revlog` |
| Frühere Übungsklausuren mit Aufgaben | Tabelle `kv`, Schlüssel `x-…` |
| Abbildungen geteilter Stapel | Storage-Bucket `share-img` (lesbar für alle mit Link) |
| Claude-Nutzung pro Tag | Tabelle `usage` (nur die Edge Function schreibt) |
| Geteilte Stapel | Tabelle `shares` (lesbar für alle mit Link) |
| Duelle und Ranglisten | Tabellen `duels`, `duel_players` (lesbar für angemeldete Nutzer mit Code) |
| API-Schlüssel (Server-Variante) | Supabase-Secret, nie im Browser |
