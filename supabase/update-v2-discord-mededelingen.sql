-- ============================================================
-- Varrios portaal v2 — update: mededelingen ook in Discord
-- Tabel notice_discord: welk Discord-bericht hoort bij welke mededeling (zodat de bot
-- het bericht mee kan verwijderen). Niet leesbaar vanuit de browser — enkel de bot.
-- Kolom notices.tag: de Boss kruist aan of de rol @Varrios Los Aztecas getagd wordt.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
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

-- ---------- tag in Discord (aankruisen bij het maken) ----------
alter table notices add column if not exists tag boolean not null default false;

create or replace function fn_add_notice(p_titel text, p_tekst text, p_soort text, p_door text, p_boss_pin_hash text, p_tag boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform _require_boss(p_boss_pin_hash);
  if length(trim(coalesce(p_titel, ''))) = 0 then raise exception 'GEEN_TITEL'; end if;
  if length(trim(coalesce(p_tekst, ''))) = 0 then raise exception 'GEEN_TEKST'; end if;
  if p_soort not in ('info','belangrijk','dringend') then raise exception 'ONGELDIG_TYPE'; end if;
  insert into notices(titel, tekst, soort, door, tag) values (left(trim(p_titel), 80), left(trim(p_tekst), 400), p_soort, p_door, coalesce(p_tag, false))
    returning id into v_id;
  return v_id;
end; $$;
-- de oude versie (zonder p_tag) blijft bestaan voor wie de site nog niet herladen heeft
grant execute on function fn_add_notice(text, text, text, text, text, boolean) to anon, authenticated;
