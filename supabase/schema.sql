-- Semesterkartei: Datenbank-Schema für Supabase
-- Im Supabase-Dashboard unter "SQL Editor" komplett einfügen und auf "Run" klicken.

-- ---------- Sync: alle Daten eines Kontos als Schlüssel/Wert-Paare ----------
create table if not exists public.kv (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  key        text        not null,
  value      jsonb,
  ts         bigint      not null,              -- Änderungszeit auf dem Gerät (ms)
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(), -- Serverzeit, für inkrementellen Abgleich
  primary key (user_id, key)
);
create index if not exists kv_user_updated on public.kv (user_id, updated_at);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists kv_touch on public.kv;
create trigger kv_touch before insert or update on public.kv
  for each row execute function public.touch_updated_at();

alter table public.kv enable row level security;
drop policy if exists "kv: eigene Daten" on public.kv;
create policy "kv: eigene Daten" on public.kv for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Geteilte Kartenstapel (lesbar für jeden mit Link) ----------
create table if not exists public.shares (
  id         text        primary key,
  owner      uuid        not null default auth.uid() references auth.users on delete cascade,
  title      text        not null,
  deck       jsonb       not null,
  created_at timestamptz not null default now()
);
alter table public.shares enable row level security;
drop policy if exists "shares: lesen" on public.shares;
drop policy if exists "shares: anlegen" on public.shares;
drop policy if exists "shares: löschen" on public.shares;
create policy "shares: lesen"   on public.shares for select to anon, authenticated using (true);
create policy "shares: anlegen" on public.shares for insert to authenticated with check (owner = auth.uid());
create policy "shares: löschen" on public.shares for delete to authenticated using (owner = auth.uid());

-- ---------- Quiz-Duelle ----------
create table if not exists public.duels (
  id         text        primary key,
  host       uuid        not null default auth.uid() references auth.users on delete cascade,
  title      text        not null,
  questions  jsonb       not null,
  created_at timestamptz not null default now()
);
alter table public.duels enable row level security;
drop policy if exists "duels: lesen" on public.duels;
drop policy if exists "duels: anlegen" on public.duels;
drop policy if exists "duels: löschen" on public.duels;
create policy "duels: lesen"   on public.duels for select to authenticated using (true);
create policy "duels: anlegen" on public.duels for insert to authenticated with check (host = auth.uid());
create policy "duels: löschen" on public.duels for delete to authenticated using (host = auth.uid());

create table if not exists public.duel_players (
  duel_id    text        not null references public.duels on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  name       text        not null check (char_length(name) between 1 and 30),
  score      int         not null default 0,
  correct    int         not null default 0,
  finished   boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (duel_id, user_id)
);
alter table public.duel_players enable row level security;
drop policy if exists "players: lesen" on public.duel_players;
drop policy if exists "players: eigener Eintrag" on public.duel_players;
drop policy if exists "players: eigener Eintrag ändern" on public.duel_players;
create policy "players: lesen" on public.duel_players for select to authenticated using (true);
create policy "players: eigener Eintrag" on public.duel_players for insert to authenticated with check (user_id = auth.uid());
create policy "players: eigener Eintrag ändern" on public.duel_players for update to authenticated
  using (user_id = auth.uid() and finished = false) with check (user_id = auth.uid());
