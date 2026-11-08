-- ============================================================
-- Varrios portaal v2 — update: agenda-herinneringen als tag in het agenda-kanaal (geen DM's meer)
--  - 24u en 5u voor de start: tag wie nog niet geantwoord heeft
--  - 2u voor de start: tag wie "aanwezig" antwoordde
-- Die tag-berichten worden verwijderd zodra de activiteit verwijderd wordt (zie agenda-bot.mjs → cleanPings).
-- Zonder deze update slaat de bot de herinneringen gewoon over.
-- Bevat ook update-v2-agenda-pings.sql (tabel agenda_pings), dus die hoeft niet apart.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================

-- tag-berichten in het agenda-kanaal, zodat de bot ze kan inkorten/weghalen (enkel voor de bot = service role)
create table if not exists agenda_pings (
  message_id text primary key,
  channel_id text not null,
  event_id uuid not null,          -- geen foreign key: ook na het verwijderen van de activiteit nog op te ruimen
  hours integer not null,          -- aantal uur voor de start (24, 5 of 2)
  kind text not null default 'open', -- 'open' = nog niet geantwoord, 'aanwezig' = wie aanwezig stemde
  users jsonb not null,            -- [{ id, name, discord_id }] die nog in het bericht staan
  created_at timestamptz not null default now()
);
-- bestond de tabel al (oude versie), dan ontbreekt de kolom kind nog
alter table agenda_pings add column if not exists kind text not null default 'open';
alter table agenda_pings enable row level security;   -- geen policies = enkel de service role
revoke all on agenda_pings from anon, authenticated;
grant select, insert, update, delete on agenda_pings to service_role;

-- 5u-herinnering al gedaan? (24u en 2u hebben al een kolom)
alter table agenda_discord add column if not exists reminded_5 boolean not null default false;

-- activiteiten die al binnen 2u beginnen of gesloten zijn: geen 5u-herinnering meer achteraf
update agenda_discord set reminded_5 = true where (closed or reminded_2) and not reminded_5;
