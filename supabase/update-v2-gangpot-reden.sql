-- ============================================================
-- Varrios portaal v2 — update: gangpot zonder foefelen
-- 1. Erbij, eruit, nieuw item (met een aantal) of item verwijderen: een REDEN is verplicht (min. 3 tekens).
--    Ook voor de base in de opslag loods.
-- 2. "Door" vult de database zelf in met de naam van wie ingelogd is (niet meer wat de browser stuurt).
-- 3. Een item verwijderen komt nu ook in de historiek (wat er nog in zat + de reden).
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================

-- naam van wie ingelogd is (de bot/service role: de meegegeven naam)
create or replace function _caller_name(p_fallback text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from users where id = _me()), nullif(trim(coalesce(p_fallback, '')), ''), 'onbekend');
$$;
create or replace function _require_reden(p_note text) returns text
language plpgsql immutable as $$
declare v text := left(trim(coalesce(p_note, '')), 120);
begin
  if length(v) < 3 then raise exception 'REDEN_GANGPOT'; end if;
  return v;
end; $$;
revoke execute on function _caller_name(text), _require_reden(text) from public, anon, authenticated;

-- nieuw item: met een aantal > 0 moet je zeggen wat het is / waar het vandaan komt
drop function if exists fn_gangpot_add_item(text, text, numeric, text, text);
create or replace function fn_gangpot_add_item(p_naam text, p_eenheid text, p_aantal numeric, p_door text, p_code_hash text, p_note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_item gangpot_items; v_naam text := left(trim(coalesce(p_naam, '')), 40); v_note text;
begin
  if not _gangpot_ok(p_code_hash) then raise exception 'ONJUISTE_GANGPOTCODE'; end if;
  if length(v_naam) = 0 then raise exception 'ONGELDIGE_NAAM'; end if;
  if exists (select 1 from gangpot_items where lower(naam) = lower(v_naam)) then raise exception 'ITEM_BESTAAT_AL'; end if;
  if p_aantal is null or p_aantal < 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  v_note := case when p_aantal > 0 then 'Nieuw item — ' || _require_reden(p_note) else 'Nieuw item' end;
  insert into gangpot_items(naam, eenheid, aantal, sort_order)
    values (v_naam, coalesce(nullif(left(trim(coalesce(p_eenheid, '')), 12), ''), 'stuks'), p_aantal,
            (select coalesce(max(sort_order), -1) + 1 from gangpot_items))
    returning * into v_item;
  insert into gangpot_log(item_id, item_naam, eenheid, delta, aantal_after, note, door)
    values (v_item.id, v_item.naam, v_item.eenheid, p_aantal, p_aantal, v_note, _caller_name(p_door));
  return true;
end; $$;

create or replace function fn_gangpot_mutate(p_item_id uuid, p_delta numeric, p_note text, p_door text, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_item gangpot_items; v_note text;
begin
  if not _gangpot_ok(p_code_hash) then raise exception 'ONJUISTE_GANGPOTCODE'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  v_note := _require_reden(p_note);
  select * into v_item from gangpot_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'NIET_GEVONDEN'; end if;
  if v_item.aantal + p_delta < 0 then raise exception 'TE_WEINIG_IN_POT'; end if;
  update gangpot_items set aantal = aantal + p_delta where id = p_item_id returning * into v_item;
  insert into gangpot_log(item_id, item_naam, eenheid, delta, aantal_after, note, door)
    values (v_item.id, v_item.naam, v_item.eenheid, p_delta, v_item.aantal, v_note, _caller_name(p_door));
  return true;
end; $$;

-- verwijderen: reden verplicht + in de historiek (wat er nog in zat)
drop function if exists fn_gangpot_delete_item(uuid, text);
create or replace function fn_gangpot_delete_item(p_item_id uuid, p_code_hash text, p_note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_item gangpot_items; v_note text;
begin
  if not _gangpot_ok(p_code_hash) then raise exception 'ONJUISTE_GANGPOTCODE'; end if;
  v_note := _require_reden(p_note);
  select * into v_item from gangpot_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'NIET_GEVONDEN'; end if;
  insert into gangpot_log(item_id, item_naam, eenheid, delta, aantal_after, note, door)
    values (null, v_item.naam, v_item.eenheid, -v_item.aantal, 0, 'Item verwijderd — ' || v_note, _caller_name(null));
  delete from gangpot_items where id = p_item_id;
  return true;
end; $$;

-- base in de opslag loods: ook met reden
create or replace function fn_mutate_base(p_delta numeric, p_note text, p_door text, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _opslag_ok(p_code_hash) then raise exception 'ONJUISTE_OPSLAGCODE'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  perform _gangpot_book('Base', 'stuks', p_delta, _require_reden(p_note), _caller_name(p_door));
  return true;
end; $$;

revoke execute on function fn_gangpot_add_item(text, text, numeric, text, text, text), fn_gangpot_delete_item(uuid, text, text),
  fn_gangpot_mutate(uuid, numeric, text, text, text), fn_mutate_base(numeric, text, text, text) from public, anon;
grant execute on function fn_gangpot_add_item(text, text, numeric, text, text, text), fn_gangpot_delete_item(uuid, text, text),
  fn_gangpot_mutate(uuid, numeric, text, text, text), fn_mutate_base(numeric, text, text, text) to authenticated, service_role;
