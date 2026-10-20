-- ============================================================
-- Varrios portaal v2 — update: inloggen met Discord i.p.v. codes
--
-- 1. Inloggen gebeurt via Discord (Supabase Auth). Je profiel wordt gevonden via het
--    Discord-ID dat de Boss in de Ledenlijst invulde (users.discord_id).
-- 2. Geen codes meer: Boss menu, gangpot aanpassen en de opslag loods worden vinkjes per lid
--    (users.perm_boss, users.perm_gangpot, users.access_opslag).
-- 3. Bob V. is eigenaar (users.is_owner): altijd alle rechten, niet af te nemen of te verwijderen.
-- 4. Lezen kan enkel nog als gekoppeld lid (niet meer met de publieke sleutel alleen).
--    Ledenacties controleren dat je het zelf bent (of de Boss die iets namens iemand doet).
--
-- ⚠️ Vooraf: Discord aangezet in Supabase → Authentication → Sign In / Providers (zie uitleg).
-- ⚠️ Na het uitvoeren werkt de site pas weer met de nieuwe versie (die wordt meteen online gezet).
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================

-- ---------- 0. controles vooraf (er is nog niets gewijzigd als dit faalt) ----------
do $$
declare d text;
begin
  if not exists (select 1 from users where lower(trim(name)) = 'bob v.') then
    raise exception 'Profiel "Bob V." niet gevonden — pas de naam aan in dit script (zoek op bob v.)';
  end if;
  if exists (select 1 from users where lower(trim(name)) = 'bob v.' and nullif(trim(coalesce(discord_id, '')), '') is null) then
    raise exception 'Bob V. heeft nog geen Discord-ID in de Ledenlijst — vul dat eerst in, anders kan niemand meer in het Boss menu';
  end if;
  select string_agg(name, ', ') into d from users
    where discord_id in (select discord_id from users where discord_id is not null group by discord_id having count(*) > 1);
  if d is not null then raise exception 'Deze profielen hebben hetzelfde Discord-ID: % — maak ze eerst uniek', d; end if;
end $$;

-- ---------- 1. kolommen ----------
alter table users add column if not exists is_owner boolean not null default false;
alter table users add column if not exists perm_boss boolean not null default false;
alter table users add column if not exists perm_gangpot boolean not null default false;
update users set discord_id = nullif(trim(discord_id), '') where discord_id is distinct from nullif(trim(discord_id), '');
update users set is_owner = true, perm_boss = true where lower(trim(name)) = 'bob v.';
create unique index if not exists users_discord_id_uidx on users (discord_id) where discord_id is not null;

-- ---------- 2. wie ben ik? ----------
-- Discord-ID van wie ingelogd is: uit auth.identities (kan de gebruiker zelf niet aanpassen, user_metadata wel)
create or replace function _my_discord() returns text
language sql stable security definer set search_path = public, auth as $$
  select provider_id from auth.identities where user_id = auth.uid() and provider = 'discord' limit 1;
$$;
create or replace function _me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from users where discord_id is not null and discord_id = _my_discord() limit 1;
$$;
create or replace function _is_member() returns boolean
language sql stable security definer set search_path = public as $$ select _me() is not null; $$;
-- de Discord-bot en de Edge Function (service role)
create or replace function _is_service() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role'
      or coalesce(current_setting('role', true), '') = 'service_role';
$$;

-- rechten: de parameter (vroeger de code/sleutel) wordt niet meer gebruikt
create or replace function _is_boss(p_hash text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from users where id = _me() and (is_owner or perm_boss));
$$;
create or replace function _require_boss(p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if _me() is null then raise exception 'NIET_INGELOGD'; end if;
  if not _is_boss(null) then raise exception 'GEEN_BOSS'; end if;
end; $$;
create or replace function _gangpot_ok(p_hash text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from users where id = _me() and (is_owner or perm_boss or perm_gangpot));
$$;
create or replace function _opslag_ok(p_hash text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from users where id = _me() and (is_owner or perm_boss or access_opslag));
$$;
-- ledenactie: je doet het voor jezelf, of je bent Boss (p_boss_ok) en doet het namens iemand
create or replace function _require_self(p_user_id uuid, p_boss_ok boolean) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid;
begin
  if _is_service() then return; end if;
  v_me := _me();
  if v_me is null then raise exception 'NIET_INGELOGD'; end if;
  if p_user_id is not null and p_user_id = v_me then return; end if;
  if p_boss_ok and _is_boss(null) then return; end if;
  raise exception 'GEEN_TOEGANG';
end; $$;
create or replace function _require_member() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if _is_service() then return; end if;
  if _me() is null then raise exception 'NIET_INGELOGD'; end if;
end; $$;

-- voor de site: wie ben ik + staat de site in onderhoud (dat laatste ook zonder in te loggen)
create or replace function fn_whoami() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('user_id', _me(), 'discord_id', _my_discord());
$$;
create or replace function fn_public_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('site_onderhoud', coalesce((select site_onderhoud from portal_settings where id = true), true));
$$;

-- ---------- 3. ledenacties: controle ervoor zetten ----------
-- De bestaande functie wordt hernoemd naar _fn_<naam> (niet meer rechtstreeks aan te roepen) en
-- fn_<naam> wordt een omhulsel met exact dezelfde parameters dat eerst controleert wie het doet.
-- ⚠️ Later iets aanpassen aan zo'n functie? Doe het in _fn_<naam>, niet in fn_<naam>.
do $$
declare
  r record; f record; v_args text; v_res text; v_call text; v_body text; v_check text;
begin
  for r in select * from (values
      ('fn_register_inleg', 'p_user_id', true),
      ('fn_register_ophalen', 'p_user_id', true),
      ('fn_create_klant', null, true),
      ('fn_register_levering', 'p_by_user_id', true),
      ('fn_register_levering_verkoop', 'p_by_user_id', true),
      ('fn_set_avatar', 'p_user_id', true),
      ('fn_add_absence', 'p_user_id', true),
      ('fn_delete_absence', 'p_user_id', true),
      ('fn_amfi_create_ticket', 'p_user_id', true),
      ('fn_amfi_message', 'p_user_id', true),
      ('fn_amfi_claim', 'p_user_id', true),
      ('fn_amfi_set_status', 'p_user_id', true),
      ('fn_amfi_mark_read', 'p_user_id', false),
      ('fn_set_rsvp', 'p_user_id', true),
      ('fn_complete_mission', 'p_user_id', true)
    ) as t(fname, uparam, boss_ok)
  loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_' || r.fname) then
      continue;   -- al omhuld (script opnieuw uitgevoerd)
    end if;
    for f in select p.oid, p.proargnames, p.pronargs, pg_get_function_arguments(p.oid) as args,
                    pg_get_function_identity_arguments(p.oid) as ident, pg_get_function_result(p.oid) as res, p.proretset
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = r.fname
    loop
      execute format('alter function public.%I(%s) rename to %I', r.fname, f.ident, '_' || r.fname);
      execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', '_' || r.fname, f.ident);
      select string_agg(format('%1$I => %1$I', a), ', ') into v_call from unnest(f.proargnames[1:f.pronargs]) a;
      v_call := format('%I(%s)', '_' || r.fname, coalesce(v_call, ''));
      v_check := case
        when r.uparam is null then 'perform _require_member();'
        when r.uparam = any(f.proargnames[1:f.pronargs]) then format('perform _require_self(%I, %L);', r.uparam, r.boss_ok)
        else 'perform _require_self(null, true);' end;
      v_body := case
        when f.res = 'void' then format('perform %s;', v_call)
        when f.proretset then format('return query select * from %s;', v_call)
        else format('return %s;', v_call) end;
      execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path = public as $w$ begin %s %s end $w$',
                     r.fname, f.args, f.res, v_check, v_body);
    end loop;
  end loop;
end $$;

-- ---------- 4. Boss-functies met de nieuwe rechten ----------
-- key: 'wiet' | 'opslag' | 'amfi' | 'amfi_staff' | 'gangpot' (aanpassen) | 'boss' (Boss menu); eigenaar = altijd alles
create or replace function fn_boss_set_access(p_user_id uuid, p_key text, p_on boolean, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(null);
  if exists (select 1 from users where id = p_user_id and is_owner) then raise exception 'EIGENAAR'; end if;
  if p_key = 'wiet' then update users set access_wiet = p_on where id = p_user_id;
  elsif p_key = 'opslag' then update users set access_opslag = p_on where id = p_user_id;
  elsif p_key = 'amfi' then update users set access_amfi = p_on, amfi_staff = case when p_on then amfi_staff else false end where id = p_user_id;
  elsif p_key = 'amfi_staff' then update users set amfi_staff = p_on, access_amfi = case when p_on then true else access_amfi end where id = p_user_id;
  elsif p_key = 'gangpot' then update users set perm_gangpot = p_on where id = p_user_id;
  elsif p_key = 'boss' then update users set perm_boss = p_on where id = p_user_id;
  else raise exception 'GEEN_TOEGANG';
  end if;
  if not found then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return true;
end; $$;

create or replace function fn_delete_profile(p_user_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(null);
  if exists (select 1 from users where id = p_user_id and is_owner) then raise exception 'EIGENAAR'; end if;
  delete from users where id = p_user_id;
  if not found then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return true;
end; $$;

-- Discord-ID = de sleutel om in te loggen: uniek, en dat van de eigenaar kan enkel de eigenaar zelf wijzigen
create or replace function fn_boss_set_discord_id(p_user_id uuid, p_discord_id text, p_boss_pin_hash text)
returns users language plpgsql security definer set search_path = public as $$
declare v_user users; v_id text := nullif(trim(coalesce(p_discord_id, '')), '');
begin
  perform _require_boss(null);
  if v_id is not null and v_id !~ '^\d{15,22}$' then raise exception 'ONGELDIG_DISCORD_ID'; end if;
  if exists (select 1 from users where id = p_user_id and is_owner) and p_user_id <> _me() then raise exception 'EIGENAAR'; end if;
  if v_id is not null and exists (select 1 from users where discord_id = v_id and id <> p_user_id) then raise exception 'DISCORD_AL_GEBRUIKT'; end if;
  update users set discord_id = v_id where id = p_user_id returning * into v_user;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return v_user;
end; $$;

-- ---------- 5. lezen: enkel gekoppelde leden (en de bot) ----------
-- (kolommen enkel achteraan toevoegen)
create or replace view users_public as
  select id, name, total_ingelegd, opgehaald, created_at, (pin_hash is not null) as claimed, avatar_url, sort_order, discord_id, legacy_zakjes,
         rank, access_wiet, access_opslag, access_amfi, amfi_staff, is_owner, perm_boss, perm_gangpot
  from users
  where _is_member() or _is_service();
revoke all on users_public from anon;
grant select on users_public to authenticated, service_role;

do $$
declare t text; pol record;
begin
  foreach t in array array['loods_log','customers','customer_log','loods_baseline','portal_settings','absences','notices','events',
                           'event_rsvps','gangpot_items','gangpot_log','gangpot_payments','missions','amfi_tickets','amfi_messages'] loop
    execute format('alter table %I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', pol.policyname, t);
    end loop;
    execute format('create policy "leden lezen" on %I for select to authenticated using ((select _is_member()))', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

-- profielfoto's: enkel nog uploaden als lid (bekijken blijft publiek: de bucket is publiek)
drop policy if exists "avatars upload" on storage.objects;
create policy "avatars upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (select public._is_member()));
drop policy if exists "avatars update" on storage.objects;
create policy "avatars update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (select public._is_member()));

-- ---------- 6. rechten op functies ----------
-- eerst alles dicht (behalve functies van extensies), dan enkel wat de site gebruikt voor ingelogde gebruikers
do $$
declare f record;
begin
  for f in select p.proname, pg_get_function_identity_arguments(p.oid) as ident
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', f.proname, f.ident);
  end loop;
  for f in select p.proname, pg_get_function_identity_arguments(p.oid) as ident
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fn\_%'
             and p.proname not in ('fn_verify_login', 'fn_claim_profile', 'fn_create_profile', 'fn_change_pin', 'fn_update_name',
                                   'fn_verify_boss', 'fn_verify_opslag', 'fn_verify_gangpot', 'fn_boss_login', 'fn_opslag_login',
                                   'fn_gangpot_login', 'fn_set_opslag_code', 'fn_set_gangpot_code', 'fn_boss_reset_pin') loop
    execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;
-- nodig in de leesregels en de view (geven enkel ja/nee over wie het vraagt)
grant execute on function _is_member(), _is_service() to anon, authenticated, service_role;
grant execute on function fn_public_status() to anon, authenticated;
-- de bot en de Edge Function (service role) mogen alle functies gebruiken
grant execute on all functions in schema public to service_role;
-- nieuwe functies zijn voortaan niet vanzelf aan te roepen door anon
alter default privileges in schema public revoke execute on functions from public, anon;

-- codes en sleutels zijn niet meer nodig
delete from code_sessions;
delete from auth_failures;
