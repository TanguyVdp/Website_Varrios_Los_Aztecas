-- ============================================================
-- Varrios portaal v2 — update: afwezigheid via Discord (#afwezigheid)
-- Houdt bij welk Discord-bericht bij welke afwezigheid hoort, zodat de bot (agenda-bot.mjs) en de
-- Edge Function (discord-agenda) het bericht kunnen bijwerken (goedgekeurd/afgekeurd) of weghalen (verwijderd op de site).
-- Enkel de bot/Edge Function (service role) gebruikt deze tabel; leden zien ze niet.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
create table if not exists absence_discord (
  absence_id uuid primary key,          -- geen foreign key: na verwijderen op de site moet de bot het bericht nog kunnen vinden
  channel_id text not null,
  message_id text not null,
  sig text,
  created_at timestamptz not null default now()
);
alter table absence_discord enable row level security;   -- geen policies: enkel de service role
grant select, insert, update, delete on absence_discord to service_role;
grant select, update on absences to service_role;
