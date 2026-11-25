-- ============================================================
-- Varrios portaal v2 — update: loods skylift = +400 base (was +200)
-- Handelaar blijft +600, terrorbite 0.
-- Zet ook de skylift van VANDAAG recht: was die al gedaan aan +200, dan wordt dat +400 en komt er 200 base bij.
-- Opnieuw uitvoeren kan geen kwaad (de rechtzetting gebeurt maar 1×).
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run).
-- ============================================================

-- 1. missie afvinken (gewone knop)
create or replace function fn_loods_missie(p_datum date, p_type text, p_discord_id text, p_door text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_bij integer; v_base integer;
begin
  if p_datum <> (now() at time zone 'Europe/Brussels')::date then raise exception 'ANDERE_DAG'; end if;
  v_bij := case p_type when 'handelaar' then 600 when 'skylift' then 400 when 'terrorbite' then 0 end;
  if v_bij is null then raise exception 'ONBEKENDE_MISSIE'; end if;
  insert into loods_missies (datum, type, discord_id, door, base_erbij)
    values (p_datum, p_type, p_discord_id, left(p_door, 80), v_bij)
    on conflict do nothing;
  if not found then raise exception 'AL_GEDAAN'; end if;
  update loods_voorraad set base = base + v_bij, updated_at = now(), updated_by = left(p_door, 80)
    where id returning base into v_base;
  return v_base;
end $$;

-- 2. "Gedaan aanpassen" (aan/af met code)
create or replace function fn_loods_zet(p_datum date, p_type text, p_aan boolean, p_discord_id text, p_door text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_bij integer; v_oud integer; v_base integer;
begin
  if p_datum <> (now() at time zone 'Europe/Brussels')::date then raise exception 'ANDERE_DAG'; end if;
  v_bij := case p_type when 'handelaar' then 600 when 'skylift' then 400 when 'terrorbite' then 0 end;
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

revoke execute on function fn_loods_missie(date, text, text, text) from public, anon, authenticated;
revoke execute on function fn_loods_zet(date, text, boolean, text, text) from public, anon, authenticated;
grant execute on function fn_loods_missie(date, text, text, text) to service_role;
grant execute on function fn_loods_zet(date, text, boolean, text, text) to service_role;

-- 3. skylift van vandaag rechtzetten (+200 → +400): 200 base erbij
do $$
begin
  update loods_missies set base_erbij = 400
    where datum = (now() at time zone 'Europe/Brussels')::date and type = 'skylift' and base_erbij = 200;
  if found then
    update loods_voorraad set base = base + 200, updated_at = now(), updated_by = 'skylift 200 → 400' where id;
  end if;
end $$;

-- controle: de base nu + wat er vandaag gedaan is
select m.type, m.door, m.base_erbij, m.at, v.base as base_in_loods_nu
  from loods_voorraad v
  left join loods_missies m on m.datum = (now() at time zone 'Europe/Brussels')::date
  order by m.at;
