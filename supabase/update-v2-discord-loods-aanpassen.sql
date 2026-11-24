-- ============================================================
-- Varrios portaal v2 — update: loods-missies "Gedaan aanpassen" (Discord, met code)
-- Vereist eerst supabase/update-v2-discord-loods.sql.
-- Een missie van vandaag aan- of afvinken. Aanvinken telt de base erbij (zoals de gewone knop),
-- afvinken haalt er af wat die missie toen opgebracht had (nooit onder 0).
-- De code wordt in de Edge Function gecontroleerd (secret LOODS_RESET_CODE), niet hier.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
create or replace function fn_loods_zet(p_datum date, p_type text, p_aan boolean, p_discord_id text, p_door text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_bij integer; v_oud integer; v_base integer;
begin
  if p_datum <> (now() at time zone 'Europe/Brussels')::date then raise exception 'ANDERE_DAG'; end if;
  v_bij := case p_type when 'handelaar' then 600 when 'skylift' then 200 when 'terrorbite' then 0 end;
  if v_bij is null then raise exception 'ONBEKENDE_MISSIE'; end if;
  if p_aan then
    insert into loods_missies (datum, type, discord_id, door, base_erbij)
      values (p_datum, p_type, p_discord_id, left(p_door, 80), v_bij)
      on conflict do nothing;
    if found then
      update loods_voorraad set base = base + v_bij, updated_at = now(), updated_by = left(p_door, 80) where id;
    end if;
  else
    delete from loods_missies where datum = p_datum and type = p_type returning base_erbij into v_oud;
    if found then
      update loods_voorraad set base = greatest(0, base - coalesce(v_oud, 0)), updated_at = now(), updated_by = left(p_door, 80) where id;
    end if;
  end if;
  select base into v_base from loods_voorraad where id;
  return v_base;
end $$;

revoke execute on function fn_loods_zet(date, text, boolean, text, text) from public, anon, authenticated;
grant execute on function fn_loods_zet(date, text, boolean, text, text) to service_role;
