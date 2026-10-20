-- ============================================================
-- Varrios portaal v2 — update: Discord-bot voor de agenda
--
-- 1. Tabel agenda_discord: welk Discord-bericht hoort bij welke activiteit,
--    en welke herinneringen (24u / 2u) al verstuurd zijn. Niet leesbaar vanuit
--    de browser — enkel de bot (service role) gebruikt ze.
-- 2. Aanmelden als "afwezig" vraagt een reden (op de site én via Discord: een keuze
--    zoals "Werk", "School", "Privé" … of zelf getypt). Mag opnieuw uitgevoerd worden.
--
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
-- ============================================================

create table if not exists agenda_discord (
  event_id uuid primary key,              -- geen foreign key: blijft bestaan na het verwijderen van de activiteit,
                                          -- zodat de bot het bericht nog op "geannuleerd" kan zetten
  channel_id text not null,
  message_id text not null,
  counts text,                            -- laatst getoonde stand (om onnodige updates te vermijden)
  reminded_24 boolean not null default false,
  reminded_2 boolean not null default false,
  closed boolean not null default false,
  posted_at timestamptz not null default now()
);
alter table agenda_discord enable row level security;   -- geen policies = enkel de service role kan erbij

-- aanmelden: bij "afwezig" is een reden verplicht
create or replace function fn_set_rsvp(p_event_id uuid, p_user_id uuid, p_status text, p_reden text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_datum date; v_user users; v_reden text;
begin
  select datum into v_datum from events where id = p_event_id;
  if not found then raise exception 'NIET_GEVONDEN'; end if;
  if v_datum < _vandaag() then raise exception 'EVENT_VOORBIJ'; end if;
  if p_status not in ('aanwezig','misschien','afwezig') then raise exception 'ONGELDIGE_STATUS'; end if;
  v_reden := nullif(left(trim(coalesce(p_reden, '')), 140), '');
  if p_status = 'afwezig' and v_reden is null then raise exception 'REDEN_NODIG'; end if;
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  insert into event_rsvps(event_id, user_id, user_name, status, reden, ts)
    values (p_event_id, v_user.id, v_user.name, p_status, v_reden, now())
    on conflict (event_id, user_id) do update set status = excluded.status, reden = excluded.reden,
      user_name = excluded.user_name, ts = now();
  return true;
end; $$;
grant execute on function fn_set_rsvp(uuid, uuid, text, text) to anon, authenticated, service_role;
