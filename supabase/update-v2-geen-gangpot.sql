-- ============================================================
-- Varrios portaal v2 — de Gangpot is weg van de website (04/11/2026)
-- De base coke-missie boekt geen +600 Base meer in de gangpot: een missie wordt enkel nog afgevinkt.
-- Uit te voeren in de Supabase SQL Editor. Raakt geen data aan: de tabellen gangpot_items, gangpot_log en
-- gangpot_payments en hun functies blijven gewoon staan (de site gebruikt ze niet meer).
-- ⚠️ fn_complete_mission is een omhulsel (update-v2-discord-login.sql) → de echte functie is _fn_complete_mission.
-- ============================================================
create or replace function _fn_complete_mission(p_type text, p_user_id uuid, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user users;
begin
  if not _opslag_ok(p_code_hash) then raise exception 'ONJUISTE_OPSLAGCODE'; end if;
  if p_type not in ('basecoke','terrorbite') then raise exception 'ONGELDIGE_MISSIE'; end if;
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  begin
    insert into missions(datum, type, user_id, user_name) values (_vandaag(), p_type, v_user.id, v_user.name);
  exception when unique_violation then raise exception 'MISSIE_AL_GEDAAN';
  end;
  return true;
end; $$;
