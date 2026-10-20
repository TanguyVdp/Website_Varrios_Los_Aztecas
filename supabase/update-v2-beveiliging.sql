-- ============================================================
-- Varrios portaal v2 — update: beveiliging tegen codes raden
--
-- 1. Limiet op foute pogingen: na 10 foute codes vanaf hetzelfde toestel (IP) is dat
--    toestel 15 minuten geblokkeerd; na 30 foute pogingen op hetzelfde doel (profiel of
--    bosscode) ook. Geldt voor: inloggen, code wijzigen, bosscode, opslag-code, gangpot-code.
-- 2. Bosscode / opslag-code / gangpot-code worden nog maar op ÉÉN plek gecontroleerd
--    (fn_boss_login / fn_opslag_login / fn_gangpot_login). Die geven een geheime sleutel
--    terug die 24 uur geldig is; alle Boss-, opslag- en gangpot-acties vragen voortaan die
--    sleutel in plaats van de code zelf. Zo kan je de codes niet meer raden via die acties.
--    (De parameters heten nog p_boss_pin_hash / p_code_hash — de site stuurt er nu de sleutel in.)
-- 3. Een code wijzigen (opslag / gangpot) zet iedereen met die code opnieuw op slot.
--
-- ⚠️ Na het uitvoeren werkt het Boss menu pas weer met de nieuwe versie van de site
--    (die wordt meteen daarna online gezet).
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run). Mag opnieuw.
-- ============================================================

-- ---------- tabellen (niet leesbaar vanuit de browser) ----------
create table if not exists auth_failures (
  id bigserial primary key,
  kind text not null,          -- 'login' | 'boss' | 'opslag' | 'gangpot'
  target text not null,        -- profiel-id of 'boss' / 'opslag' / 'gangpot'
  ip text not null,
  ts timestamptz not null default now()
);
create index if not exists auth_failures_idx on auth_failures (kind, ip, ts);
alter table auth_failures enable row level security;

create table if not exists code_sessions (
  token text primary key,
  kind text not null,          -- 'boss' | 'opslag' | 'gangpot'
  expires_at timestamptz not null
);
alter table code_sessions enable row level security;

revoke all on auth_failures, code_sessions from anon, authenticated;

-- ---------- hulpfuncties ----------
-- IP van wie de aanvraag doet (Supabase geeft de headers door aan Postgres)
create or replace function _client_ip() returns text
language plpgsql stable as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  return coalesce(nullif(trim(h->>'cf-connecting-ip'), ''), nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''), 'onbekend');
end; $$;

-- te veel foute pogingen? → TE_VEEL_POGINGEN
create or replace function _guard(p_kind text, p_target text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth_failures where ts < now() - interval '1 day';
  if (select count(*) from auth_failures where kind = p_kind and ip = _client_ip() and ts > now() - interval '15 minutes') >= 10
     or (select count(*) from auth_failures where kind = p_kind and target = p_target and ts > now() - interval '15 minutes') >= 30 then
    raise exception 'TE_VEEL_POGINGEN';
  end if;
end; $$;
create or replace function _fail(p_kind text, p_target text) returns void
language sql security definer set search_path = public as $$
  insert into auth_failures(kind, target, ip) values (p_kind, p_target, _client_ip());
$$;
create or replace function _clear(p_kind text) returns void
language sql security definer set search_path = public as $$
  delete from auth_failures where kind = p_kind and ip = _client_ip();
$$;
-- nieuwe sleutel (64 tekens, willekeurig)
create or replace function _new_session(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  delete from code_sessions where expires_at < now();
  insert into code_sessions(token, kind, expires_at) values (v, p_kind, now() + interval '24 hours');
  return v;
end; $$;

-- de Boss-, opslag- en gangpot-acties controleren voortaan de sleutel (niet meer de code)
create or replace function _is_boss(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select p_hash is not null and exists(select 1 from code_sessions where token = p_hash and kind = 'boss' and expires_at > now());
$$;
create or replace function _gangpot_ok(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select _is_boss(p_hash) or (p_hash is not null and exists(select 1 from code_sessions where token = p_hash and kind = 'gangpot' and expires_at > now()));
$$;
create or replace function _opslag_ok(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select _is_boss(p_hash) or (p_hash is not null and exists(select 1 from code_sessions where token = p_hash and kind = 'opslag' and expires_at > now()));
$$;
revoke execute on function _client_ip(), _guard(text, text), _fail(text, text), _clear(text), _new_session(text),
  _is_boss(text), _gangpot_ok(text), _opslag_ok(text) from public, anon, authenticated;

-- ============================================================
-- inloggen + codes controleren (met limiet)
-- ============================================================
create or replace function fn_verify_login(p_user_id uuid, p_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _guard('login', p_user_id::text);
  if exists(select 1 from users where id = p_user_id and pin_hash = p_pin_hash) then
    perform _clear('login');
    return true;
  end if;
  perform _fail('login', p_user_id::text);
  return false;
end; $$;

-- eigen code wijzigen: foute huidige code → false (telt mee als foute poging)
create or replace function fn_change_pin(p_user_id uuid, p_old_pin_hash text, p_new_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_new_pin_hash is null or length(p_new_pin_hash) <> 64 then raise exception 'ONGELDIGE_CODE'; end if;
  perform _guard('login', p_user_id::text);
  if not exists(select 1 from users where id = p_user_id and pin_hash = p_old_pin_hash) then
    perform _fail('login', p_user_id::text);
    return false;
  end if;
  perform _clear('login');
  update users set pin_hash = p_new_pin_hash where id = p_user_id;
  return true;
end; $$;

-- bosscode → sleutel (null = foute code)
create or replace function fn_boss_login(p_pin_hash text)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform _guard('boss', 'boss');
  if exists(select 1 from admin_config where id = true and boss_pin_hash = p_pin_hash) then
    perform _clear('boss');
    return _new_session('boss');
  end if;
  perform _fail('boss', 'boss');
  return null;
end; $$;

-- opslag- / gangpot-code → { token, v } (null = foute code); v = versie van de code (voor "op slot" bij wijzigen)
create or replace function fn_opslag_login(p_pin_hash text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _guard('opslag', 'opslag');
  if exists(select 1 from admin_config where id = true and opslag_pin_hash = p_pin_hash) then
    perform _clear('opslag');
    return json_build_object('token', _new_session('opslag'), 'v', (select opslag_v from portal_settings where id = true));
  end if;
  perform _fail('opslag', 'opslag');
  return null;
end; $$;
create or replace function fn_gangpot_login(p_pin_hash text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _guard('gangpot', 'gangpot');
  if exists(select 1 from admin_config where id = true and gangpot_pin_hash = p_pin_hash) then
    perform _clear('gangpot');
    return json_build_object('token', _new_session('gangpot'), 'v', (select gangpot_v from portal_settings where id = true));
  end if;
  perform _fail('gangpot', 'gangpot');
  return null;
end; $$;

-- codes wijzigen (boss): iedereen met de oude code opnieuw op slot
create or replace function fn_set_opslag_code(p_new_pin_hash text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  if p_new_pin_hash is null or length(p_new_pin_hash) <> 64 then raise exception 'ONGELDIGE_CODE'; end if;
  update admin_config set opslag_pin_hash = p_new_pin_hash where id = true;
  update portal_settings set opslag_v = opslag_v + 1 where id = true;
  delete from code_sessions where kind = 'opslag';
  return true;
end; $$;
create or replace function fn_set_gangpot_code(p_new_pin_hash text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  if p_new_pin_hash is null or length(p_new_pin_hash) <> 64 then raise exception 'ONGELDIGE_CODE'; end if;
  update admin_config set gangpot_pin_hash = p_new_pin_hash where id = true;
  update portal_settings set gangpot_v = gangpot_v + 1 where id = true;
  delete from code_sessions where kind = 'gangpot';
  return true;
end; $$;

-- de oude "code juist?"-functies niet meer bereikbaar (geen limiet → niet meer gebruiken)
revoke execute on function fn_verify_boss(text), fn_verify_opslag(text), fn_verify_gangpot(text) from public, anon, authenticated;

-- ============================================================
-- Boss-functies van de oude site: zelfde werking, maar met de sleutel i.p.v. de bosscode
-- ============================================================
create or replace function fn_delete_profile(p_user_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  delete from users where id = p_user_id;
  if not found then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return true;
end; $$;

create or replace function fn_boss_reset_pin(p_user_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  update users set pin_hash = null where id = p_user_id;
  if not found then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return true;
end; $$;

create or replace function fn_boss_set_order(p_order jsonb, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id_text text; v_idx integer := 0;
begin
  perform _require_boss(p_boss_pin_hash);
  for v_id_text in select * from jsonb_array_elements_text(p_order) loop
    update users set sort_order = v_idx where id = v_id_text::uuid;
    v_idx := v_idx + 1;
  end loop;
  return true;
end; $$;

create or replace function fn_boss_set_discord_id(p_user_id uuid, p_discord_id text, p_boss_pin_hash text)
returns users language plpgsql security definer set search_path = public as $$
declare v_user users;
begin
  perform _require_boss(p_boss_pin_hash);
  update users set discord_id = nullif(trim(coalesce(p_discord_id, '')), '')
    where id = p_user_id returning * into v_user;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return v_user;
end; $$;

create or replace function fn_set_loods_baseline(
  p_offset_minutes integer, p_batch_size integer, p_batch_minutes integer,
  p_zakjes_correctie integer, p_boss_pin_hash text, p_set_by text
)
returns loods_baseline language plpgsql security definer set search_path = public as $$
declare v_row loods_baseline;
begin
  perform _require_boss(p_boss_pin_hash);
  if p_offset_minutes is null then raise exception 'ONGELDIG_AANTAL'; end if;
  if p_batch_size is null or p_batch_size <= 0 then raise exception 'ONGELDIGE_BATCH'; end if;
  if p_batch_minutes is null or p_batch_minutes <= 0 then raise exception 'ONGELDIGE_BATCH'; end if;
  if p_zakjes_correctie is null then raise exception 'ONGELDIG_AANTAL'; end if;
  update loods_baseline set offset_minutes = p_offset_minutes, batch_size = p_batch_size, batch_minutes = p_batch_minutes,
    zakjes_correctie = p_zakjes_correctie, set_at = now(), set_by = p_set_by
    where id = true returning * into v_row;
  return v_row;
end; $$;

create or replace function fn_set_maintenance(p_paused boolean, p_boss_pin_hash text)
returns loods_baseline language plpgsql security definer set search_path = public as $$
declare v_row loods_baseline; v_pause_minutes int;
begin
  perform _require_boss(p_boss_pin_hash);
  select * into v_row from loods_baseline where id = true;
  if p_paused then
    update loods_baseline set paused = true, paused_at = now()
      where id = true returning * into v_row;
  else
    if v_row.paused and v_row.paused_at is not null then
      v_pause_minutes := round(extract(epoch from (now() - v_row.paused_at)) / 60.0);
    else
      v_pause_minutes := 0;
    end if;
    update loods_baseline set paused = false, paused_at = null,
      offset_minutes = offset_minutes + v_pause_minutes
      where id = true returning * into v_row;
  end if;
  return v_row;
end; $$;

create or replace function fn_boss_set_user_data(
  p_user_id uuid, p_total_ingelegd integer, p_opgehaald integer, p_legacy_zakjes integer,
  p_boss_pin_hash text, p_set_by text
)
returns users language plpgsql security definer set search_path = public as $$
declare v_before users; v_after users; v_note text;
begin
  perform _require_boss(p_boss_pin_hash);
  if p_total_ingelegd is null or p_total_ingelegd < 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  if p_opgehaald is null or p_opgehaald < 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  if p_legacy_zakjes is null or p_legacy_zakjes < 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  select * into v_before from users where id = p_user_id for update;
  if v_before.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  update users set total_ingelegd = p_total_ingelegd, opgehaald = p_opgehaald, legacy_zakjes = p_legacy_zakjes
    where id = p_user_id returning * into v_after;
  v_note := format('ingelegd %s→%s, opgehaald %s→%s, legacy %s→%s%s',
    v_before.total_ingelegd, v_after.total_ingelegd,
    v_before.opgehaald, v_after.opgehaald,
    v_before.legacy_zakjes, v_after.legacy_zakjes,
    case when p_set_by is not null then ' (door ' || p_set_by || ')' else '' end);
  insert into loods_log(type, user_id, user_name, amount, note)
    values ('correctie', v_after.id, v_after.name, 0, v_note);
  return v_after;
end; $$;

create or replace function fn_boss_delete_klant(p_customer_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  delete from customers where id = p_customer_id;
  if not found then raise exception 'KLANT_NIET_GEVONDEN'; end if;
  return true;
end; $$;

create or replace function fn_boss_set_klant_data(
  p_customer_id uuid, p_name text, p_groep text, p_phone text,
  p_total_geleverd integer, p_total_verkocht integer, p_total_omzet numeric,
  p_boss_pin_hash text, p_set_by text
)
returns customers language plpgsql security definer set search_path = public as $$
declare v_before customers; v_after customers; v_note text;
begin
  perform _require_boss(p_boss_pin_hash);
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'ONGELDIGE_NAAM'; end if;
  if exists (select 1 from customers where lower(name) = lower(trim(p_name)) and id <> p_customer_id) then
    raise exception 'KLANT_BESTAAT_AL';
  end if;
  if p_total_geleverd is null or p_total_geleverd < 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  if p_total_verkocht is null or p_total_verkocht < 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  if p_total_omzet is null or p_total_omzet < 0 then raise exception 'ONGELDIGE_PRIJS'; end if;
  select * into v_before from customers where id = p_customer_id for update;
  if v_before.id is null then raise exception 'KLANT_NIET_GEVONDEN'; end if;
  update customers set
    name = trim(p_name), groep = nullif(trim(coalesce(p_groep,'')),''), phone = nullif(trim(coalesce(p_phone,'')),''),
    total_geleverd = p_total_geleverd, total_verkocht = p_total_verkocht, total_omzet = p_total_omzet
    where id = p_customer_id returning * into v_after;
  v_note := format('naam "%s"->"%s", geswapt %s->%s, verkocht %s->%s, omzet €%s->€%s%s',
    v_before.name, v_after.name, v_before.total_geleverd, v_after.total_geleverd,
    v_before.total_verkocht, v_after.total_verkocht, v_before.total_omzet, v_after.total_omzet,
    case when p_set_by is not null then ' (door ' || p_set_by || ')' else '' end);
  insert into customer_log(customer_id, by_user_id, by_user_name, amount, cumulative_after, zakjes_after, zakjes_delta, kind, note)
    values (v_after.id, null, coalesce(p_set_by,'Boss'), 0, v_after.total_geleverd, 0, 0, 'correctie', v_note);
  return v_after;
end; $$;

-- ============================================================
-- rechten
-- ============================================================
grant execute on function
  fn_verify_login(uuid, text), fn_change_pin(uuid, text, text),
  fn_boss_login(text), fn_opslag_login(text), fn_gangpot_login(text),
  fn_set_opslag_code(text, text), fn_set_gangpot_code(text, text),
  fn_delete_profile(uuid, text), fn_boss_reset_pin(uuid, text), fn_boss_set_order(jsonb, text),
  fn_boss_set_discord_id(uuid, text, text),
  fn_set_loods_baseline(integer, integer, integer, integer, text, text), fn_set_maintenance(boolean, text),
  fn_boss_set_user_data(uuid, integer, integer, integer, text, text),
  fn_boss_delete_klant(uuid, text),
  fn_boss_set_klant_data(uuid, text, text, text, integer, integer, numeric, text, text)
to anon, authenticated;
