-- ============================================================
-- Varrios portaal v2 — update: mededelingen ook in Discord
-- Tabel notice_discord: welk Discord-bericht hoort bij welke mededeling (zodat de bot
-- het bericht mee kan verwijderen). Niet leesbaar vanuit de browser — enkel de bot.
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
-- ============================================================

create table if not exists notice_discord (
  notice_id uuid primary key,             -- geen foreign key: blijft bestaan na het verwijderen van de mededeling,
                                          -- zodat de bot het bericht in Discord nog kan weghalen
  channel_id text not null,
  message_id text not null,
  posted_at timestamptz not null default now()
);
alter table notice_discord enable row level security;   -- geen policies = enkel de service role
revoke all on notice_discord from anon, authenticated;
grant select, insert, update, delete on notice_discord to service_role;
