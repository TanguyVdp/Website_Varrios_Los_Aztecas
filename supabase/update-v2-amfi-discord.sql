-- ============================================================
-- Varrios portaal v2 — update: amfi-tickets melden in het lead-kanaal op Discord
-- Onthoudt welk Discord-bericht bij welk ticket hoort, zodat de bot dat bericht kan bijwerken
-- als de status verandert (wachtrij → in behandeling → afgerond). Enkel voor de bot (service role).
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
create table if not exists amfi_discord (
  ticket_id uuid primary key,      -- geen foreign key: blijft ook staan als een ticket ooit verwijderd wordt
  channel_id text not null,
  message_id text not null,
  sig text,                        -- laatst getoonde tekst (om onnodige updates te vermijden)
  posted_at timestamptz not null default now()
);
alter table amfi_discord enable row level security;   -- geen policies = enkel de service role
revoke all on amfi_discord from anon, authenticated;
grant select, insert, update, delete on amfi_discord to service_role;
