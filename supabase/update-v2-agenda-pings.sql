-- ============================================================
-- Varrios portaal v2 — update: vermeldingen in het agenda-kanaal opruimen
-- Lukt een herinnering per DM niet, dan tagt de bot die leden in het agenda-kanaal. Deze tabel onthoudt
-- die berichten, zodat de bot wie intussen antwoordde eruit haalt en het bericht verwijdert zodra
-- iedereen geantwoord heeft (of de activiteit begonnen is). Enkel voor de bot (service role).
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
create table if not exists agenda_pings (
  message_id text primary key,
  channel_id text not null,
  event_id uuid not null,          -- geen foreign key: ook na het verwijderen van de activiteit nog op te ruimen
  hours integer not null,          -- 24 of 2
  users jsonb not null,            -- [{ id, discord_id }] die nog niet geantwoord hebben
  created_at timestamptz not null default now()
);
alter table agenda_pings enable row level security;   -- geen policies = enkel de service role
revoke all on agenda_pings from anon, authenticated;
grant select, insert, update, delete on agenda_pings to service_role;
