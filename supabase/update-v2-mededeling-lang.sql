-- ============================================================
-- Varrios portaal v2 — update: langere mededelingen (1.500 tekens i.p.v. 400)
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
create or replace function fn_add_notice(p_titel text, p_tekst text, p_soort text, p_door text, p_boss_pin_hash text, p_tag boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform _require_boss(p_boss_pin_hash);
  if length(trim(coalesce(p_titel, ''))) = 0 then raise exception 'GEEN_TITEL'; end if;
  if length(trim(coalesce(p_tekst, ''))) = 0 then raise exception 'GEEN_TEKST'; end if;
  if p_soort not in ('info','belangrijk','dringend') then raise exception 'ONGELDIG_TYPE'; end if;
  insert into notices(titel, tekst, soort, door, tag) values (left(trim(p_titel), 80), left(trim(p_tekst), 1500), p_soort, p_door, coalesce(p_tag, false))
    returning id into v_id;
  return v_id;
end; $$;
grant execute on function fn_add_notice(text, text, text, text, text, boolean) to authenticated;
