-- ============================================================
-- Varrios portaal v2 — alle nieuwe afdelingen in de bestaande database.
--
-- Voegt ENKEL nieuwe dingen toe (tabellen, kolommen, functies). Bestaande tabellen
-- en functies van de Wietloods blijven ongewijzigd → de oude site blijft werken
-- en de Discord-bot ook. Mag meerdere keren uitgevoerd worden.
--
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak alles > Run).
--
-- Codes: de opslag-code en de gangpot-code starten gelijk aan de huidige bosscode.
-- De Boss kan ze daarna wijzigen in Boss menu → Opslag loods / Gangpot bijhouden.
-- De site start in ONDERHOUD: enkel met de bosscode kom je erop. De Boss zet dat
-- uit in Boss menu → Website.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- leden: rang, toegang, amfi-medewerker ----------
alter table users add column if not exists rank text;
alter table users add column if not exists access_wiet boolean not null default true;
alter table users add column if not exists access_opslag boolean not null default false;
alter table users add column if not exists access_amfi boolean not null default false;
alter table users add column if not exists amfi_staff boolean not null default false;

-- (kolommen enkel achteraan toevoegen — zo blijft de view compatibel met de oude site)
create or replace view users_public as
  select id, name, total_ingelegd, opgehaald, created_at, (pin_hash is not null) as claimed, avatar_url, sort_order, discord_id, legacy_zakjes,
         rank, access_wiet, access_opslag, access_amfi, amfi_staff
  from users;
grant select on users_public to anon, authenticated;

-- ---------- instellingen van het portaal ----------
-- publiek leesbaar: geen codes, enkel een versienummer per code (wijzigt de code → iedereen terug op slot)
create table if not exists portal_settings (
  id boolean primary key default true,
  site_onderhoud boolean not null default true,
  opslag_v integer not null default 1,
  gangpot_v integer not null default 1,
  amfi jsonb,
  ticket_seq integer not null default 0,
  constraint portal_settings_singleton check (id)
);
insert into portal_settings (id) values (true) on conflict (id) do nothing;

-- codes staan (gehasht) in admin_config, dat niet leesbaar is
alter table admin_config add column if not exists opslag_pin_hash text;
alter table admin_config add column if not exists gangpot_pin_hash text;
update admin_config set opslag_pin_hash = boss_pin_hash where id = true and opslag_pin_hash is null;
update admin_config set gangpot_pin_hash = boss_pin_hash where id = true and gangpot_pin_hash is null;

-- ---------- afwezigheden ----------
create table if not exists absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  user_name text not null,
  van date not null,
  tot date not null,
  reden text not null,
  toelichting text,
  status text not null default 'aangevraagd' check (status in ('aangevraagd','goedgekeurd','afgekeurd')),
  reactie text,
  beoordeeld_door text,
  beoordeeld_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- mededelingen + agenda ----------
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  tekst text not null,
  soort text not null,
  door text,
  created_at timestamptz not null default now()
);
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  type text not null,
  datum date not null,
  tijd text,
  plaats text,
  info text,
  door text,
  created_at timestamptz not null default now()
);
create table if not exists event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  user_name text not null,
  status text not null check (status in ('aanwezig','misschien','afwezig')),
  reden text,
  ts timestamptz not null default now(),
  unique (event_id, user_id)
);

-- ---------- gangpot ----------
create table if not exists gangpot_items (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  eenheid text not null default 'stuks',
  aantal numeric not null default 0,
  sort_order integer not null default 0
);
create unique index if not exists gangpot_items_naam_uidx on gangpot_items (lower(naam));
insert into gangpot_items (naam, eenheid, aantal, sort_order) values ('Base', 'stuks', 0, 0) on conflict do nothing;

create table if not exists gangpot_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references gangpot_items(id) on delete set null,
  item_naam text not null,
  eenheid text,
  delta numeric not null,
  aantal_after numeric not null,
  note text,
  door text,
  ts timestamptz not null default now()
);
create table if not exists gangpot_payments (
  id uuid primary key default gen_random_uuid(),
  week date not null,
  user_id uuid not null references users(id) on delete cascade,
  user_name text not null,
  paid_at timestamptz not null default now(),
  door text,
  unique (user_id, week)
);

-- ---------- opslag loods: missies (elk type maar 1× per dag) ----------
create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  type text not null,
  user_id uuid references users(id) on delete set null,
  user_name text not null,
  ts timestamptz not null default now(),
  unique (datum, type)
);

-- ---------- amfi loods: tickets + chat ----------
create table if not exists amfi_tickets (
  id uuid primary key default gen_random_uuid(),
  nr integer not null,
  user_id uuid references users(id) on delete set null,
  user_name text not null,
  keer integer not null,
  levering text not null check (levering in ('zelf','wij')),
  opmerking text,
  quote jsonb not null,
  status text not null default 'wachtrij' check (status in ('wachtrij','bezig','klaar','geannuleerd')),
  medewerker_id uuid references users(id) on delete set null,
  medewerker_naam text,
  read jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists amfi_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references amfi_tickets(id) on delete cascade,
  sender text not null check (sender in ('bot','user','staff')),
  user_id uuid references users(id) on delete set null,
  user_name text not null,
  text text not null,
  ts timestamptz not null default now()
);
create index if not exists amfi_messages_ticket_idx on amfi_messages (ticket_id, ts);

-- ---------- lezen mag iedereen (zoals de Wietloods), schrijven enkel via de functies hieronder ----------
do $$
declare t text;
begin
  foreach t in array array['portal_settings','absences','notices','events','event_rsvps','gangpot_items','gangpot_log',
                           'gangpot_payments','missions','amfi_tickets','amfi_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "select %s" on %I', t, t);
    execute format('create policy "select %s" on %I for select using (true)', t, t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

-- live bijwerken (Supabase Realtime)
do $$
declare t text;
begin
  foreach t in array array['loods_baseline','portal_settings','absences','notices','events','event_rsvps','gangpot_items',
                           'gangpot_log','gangpot_payments','missions','amfi_tickets','amfi_messages'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================
-- hulpfuncties voor de codes (niet rechtstreeks aan te roepen vanuit de browser)
-- ============================================================
create or replace function _is_boss(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select p_hash is not null and exists(select 1 from admin_config where id = true and boss_pin_hash = p_hash);
$$;
create or replace function _require_boss(p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _is_boss(p_hash) then raise exception 'ONJUISTE_BOSSCODE'; end if;
end; $$;
create or replace function _gangpot_ok(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select _is_boss(p_hash) or (p_hash is not null and exists(select 1 from admin_config where id = true and gangpot_pin_hash = p_hash));
$$;
create or replace function _opslag_ok(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select _is_boss(p_hash) or (p_hash is not null and exists(select 1 from admin_config where id = true and opslag_pin_hash = p_hash));
$$;
create or replace function _vandaag() returns date
language sql stable as $$ select (now() at time zone 'Europe/Brussels')::date; $$;
revoke execute on function _is_boss(text), _require_boss(text), _gangpot_ok(text), _opslag_ok(text) from public, anon, authenticated;

-- ============================================================
-- website in onderhoud + codes
-- ============================================================
create or replace function fn_set_site_onderhoud(p_on boolean, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  update portal_settings set site_onderhoud = coalesce(p_on, true) where id = true;
  return true;
end; $$;

-- geeft het versienummer van de code terug (de browser onthoudt dat → code gewijzigd = terug op slot)
create or replace function fn_verify_opslag(p_pin_hash text)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if not exists(select 1 from admin_config where id = true and opslag_pin_hash = p_pin_hash) then raise exception 'ONJUISTE_OPSLAGCODE'; end if;
  select opslag_v into v from portal_settings where id = true;
  return v;
end; $$;
create or replace function fn_verify_gangpot(p_pin_hash text)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if not exists(select 1 from admin_config where id = true and gangpot_pin_hash = p_pin_hash) then raise exception 'ONJUISTE_GANGPOTCODE'; end if;
  select gangpot_v into v from portal_settings where id = true;
  return v;
end; $$;
create or replace function fn_set_opslag_code(p_new_pin_hash text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  if p_new_pin_hash is null or length(p_new_pin_hash) <> 64 then raise exception 'ONGELDIGE_CODE'; end if;
  update admin_config set opslag_pin_hash = p_new_pin_hash where id = true;
  update portal_settings set opslag_v = opslag_v + 1 where id = true;
  return true;
end; $$;
create or replace function fn_set_gangpot_code(p_new_pin_hash text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  if p_new_pin_hash is null or length(p_new_pin_hash) <> 64 then raise exception 'ONGELDIGE_CODE'; end if;
  update admin_config set gangpot_pin_hash = p_new_pin_hash where id = true;
  update portal_settings set gangpot_v = gangpot_v + 1 where id = true;
  return true;
end; $$;

-- ============================================================
-- leden (boss)
-- ============================================================
create or replace function fn_boss_create_profile(p_name text, p_rank text, p_access_wiet boolean, p_access_opslag boolean,
  p_access_amfi boolean, p_amfi_staff boolean, p_boss_pin_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_next int;
begin
  perform _require_boss(p_boss_pin_hash);
  if (select count(*) from users) >= 25 then raise exception 'LOODS_VOL'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'ONGELDIGE_NAAM'; end if;
  if exists (select 1 from users where lower(name) = lower(trim(p_name))) then raise exception 'NAAM_BESTAAT_AL'; end if;
  select coalesce(max(sort_order), 0) + 1 into v_next from users where lower(name) <> 'gangpot';
  insert into users(name, sort_order, rank, access_wiet, access_opslag, access_amfi, amfi_staff)
    values (trim(p_name), v_next, nullif(p_rank, ''), coalesce(p_access_wiet, false), coalesce(p_access_opslag, false),
            coalesce(p_access_amfi, false) or coalesce(p_amfi_staff, false), coalesce(p_amfi_staff, false))
    returning id into v_id;
  return v_id;
end; $$;

-- key: 'wiet' | 'opslag' | 'amfi' | 'amfi_staff' (medewerker geeft ook amfi-toegang; geen amfi-toegang = geen medewerker)
create or replace function fn_boss_set_access(p_user_id uuid, p_key text, p_on boolean, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  if p_key = 'wiet' then update users set access_wiet = p_on where id = p_user_id;
  elsif p_key = 'opslag' then update users set access_opslag = p_on where id = p_user_id;
  elsif p_key = 'amfi' then update users set access_amfi = p_on, amfi_staff = case when p_on then amfi_staff else false end where id = p_user_id;
  elsif p_key = 'amfi_staff' then update users set amfi_staff = p_on, access_amfi = case when p_on then true else access_amfi end where id = p_user_id;
  else raise exception 'GEEN_TOEGANG';
  end if;
  if not found then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return true;
end; $$;

create or replace function fn_boss_set_rank(p_user_id uuid, p_rank text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  update users set rank = nullif(p_rank, '') where id = p_user_id;
  if not found then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  return true;
end; $$;

-- ============================================================
-- afwezigheid
-- ============================================================
create or replace function fn_add_absence(p_user_id uuid, p_van date, p_tot date, p_reden text, p_toelichting text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user users; v_id uuid; v_note text;
begin
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  if p_van is null or p_tot is null then raise exception 'ONGELDIGE_DATUM'; end if;
  if p_tot < p_van then raise exception 'EINDE_VOOR_START'; end if;
  if p_tot < _vandaag() then raise exception 'DATUM_VERLEDEN'; end if;
  if p_reden not in ('vakantie','werk','ziek','familie','andere') then raise exception 'GEEN_REDEN'; end if;
  v_note := nullif(left(trim(coalesce(p_toelichting, '')), 140), '');
  if p_reden = 'andere' and v_note is null then raise exception 'TOELICHTING_NODIG'; end if;
  if exists (select 1 from absences where user_id = p_user_id and status <> 'afgekeurd' and van <= p_tot and tot >= p_van) then
    raise exception 'AFWEZIG_OVERLAP';
  end if;
  insert into absences(user_id, user_name, van, tot, reden, toelichting)
    values (v_user.id, v_user.name, p_van, p_tot, p_reden, v_note) returning id into v_id;
  return v_id;
end; $$;

create or replace function fn_delete_absence(p_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select user_id into v_owner from absences where id = p_id;
  if not found then raise exception 'AFWEZIGHEID_NIET_GEVONDEN'; end if;
  if v_owner is distinct from p_user_id then raise exception 'GEEN_RECHT'; end if;
  delete from absences where id = p_id;
  return true;
end; $$;

-- status: 'goedgekeurd' | 'afgekeurd' | null (= enkel reageren)
create or replace function fn_review_absence(p_id uuid, p_status text, p_reactie text, p_door text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_re text;
begin
  perform _require_boss(p_boss_pin_hash);
  if p_status is not null and p_status not in ('aangevraagd','goedgekeurd','afgekeurd') then raise exception 'ONGELDIGE_STATUS'; end if;
  v_re := nullif(left(trim(coalesce(p_reactie, '')), 200), '');
  if p_status is null and v_re is null then raise exception 'REACTIE_NODIG'; end if;
  update absences set status = coalesce(p_status, status), reactie = coalesce(v_re, reactie),
    beoordeeld_door = p_door, beoordeeld_at = now() where id = p_id;
  if not found then raise exception 'AFWEZIGHEID_NIET_GEVONDEN'; end if;
  return true;
end; $$;

-- boss: elke afwezigheid schrappen
create or replace function fn_boss_delete_absence(p_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  delete from absences where id = p_id;
  if not found then raise exception 'AFWEZIGHEID_NIET_GEVONDEN'; end if;
  return true;
end; $$;

-- ============================================================
-- mededelingen + agenda (boss) en aanmelden (leden)
-- ============================================================
create or replace function fn_add_notice(p_titel text, p_tekst text, p_soort text, p_door text, p_boss_pin_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform _require_boss(p_boss_pin_hash);
  if length(trim(coalesce(p_titel, ''))) = 0 then raise exception 'GEEN_TITEL'; end if;
  if length(trim(coalesce(p_tekst, ''))) = 0 then raise exception 'GEEN_TEKST'; end if;
  if p_soort not in ('info','belangrijk','dringend') then raise exception 'ONGELDIG_TYPE'; end if;
  insert into notices(titel, tekst, soort, door) values (left(trim(p_titel), 80), left(trim(p_tekst), 400), p_soort, p_door)
    returning id into v_id;
  return v_id;
end; $$;
create or replace function fn_delete_notice(p_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  delete from notices where id = p_id;
  if not found then raise exception 'NIET_GEVONDEN'; end if;
  return true;
end; $$;

create or replace function fn_add_event(p_titel text, p_type text, p_datum date, p_tijd text, p_plaats text, p_info text,
  p_door text, p_boss_pin_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform _require_boss(p_boss_pin_hash);
  if length(trim(coalesce(p_titel, ''))) = 0 then raise exception 'GEEN_TITEL'; end if;
  if p_type not in ('vergadering','actie','deal','feest','andere') then raise exception 'ONGELDIG_TYPE'; end if;
  if p_datum is null then raise exception 'GEEN_DATUM'; end if;
  if p_tijd is not null and p_tijd !~ '^\d{2}:\d{2}$' then raise exception 'ONGELDIGE_TIJD'; end if;
  insert into events(titel, type, datum, tijd, plaats, info, door)
    values (left(trim(p_titel), 80), p_type, p_datum, p_tijd, nullif(left(trim(coalesce(p_plaats, '')), 80), ''),
            nullif(left(trim(coalesce(p_info, '')), 300), ''), p_door)
    returning id into v_id;
  return v_id;
end; $$;
create or replace function fn_delete_event(p_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  delete from events where id = p_id;
  if not found then raise exception 'NIET_GEVONDEN'; end if;
  return true;
end; $$;

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

-- ============================================================
-- gangpot (gangpot-code of bosscode)
-- ============================================================
-- interne boeking op een item (maakt het aan als het nog niet bestaat)
create or replace function _gangpot_book(p_naam text, p_eenheid text, p_delta numeric, p_note text, p_door text)
returns void language plpgsql security definer set search_path = public as $$
declare v_item gangpot_items;
begin
  select * into v_item from gangpot_items where lower(naam) = lower(p_naam) for update;
  if v_item.id is null then
    insert into gangpot_items(naam, eenheid, aantal, sort_order)
      values (p_naam, p_eenheid, 0, (select coalesce(max(sort_order), -1) + 1 from gangpot_items)) returning * into v_item;
  end if;
  if v_item.aantal + p_delta < 0 then raise exception 'TE_WEINIG_IN_POT'; end if;
  update gangpot_items set aantal = aantal + p_delta where id = v_item.id returning * into v_item;
  insert into gangpot_log(item_id, item_naam, eenheid, delta, aantal_after, note, door)
    values (v_item.id, v_item.naam, v_item.eenheid, p_delta, v_item.aantal, p_note, p_door);
end; $$;
revoke execute on function _gangpot_book(text, text, numeric, text, text) from public, anon, authenticated;

create or replace function fn_gangpot_add_item(p_naam text, p_eenheid text, p_aantal numeric, p_door text, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_item gangpot_items; v_naam text := left(trim(coalesce(p_naam, '')), 40);
begin
  if not _gangpot_ok(p_code_hash) then raise exception 'ONJUISTE_GANGPOTCODE'; end if;
  if length(v_naam) = 0 then raise exception 'ONGELDIGE_NAAM'; end if;
  if exists (select 1 from gangpot_items where lower(naam) = lower(v_naam)) then raise exception 'ITEM_BESTAAT_AL'; end if;
  if p_aantal is null or p_aantal < 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  insert into gangpot_items(naam, eenheid, aantal, sort_order)
    values (v_naam, coalesce(nullif(left(trim(coalesce(p_eenheid, '')), 12), ''), 'stuks'), p_aantal,
            (select coalesce(max(sort_order), -1) + 1 from gangpot_items))
    returning * into v_item;
  insert into gangpot_log(item_id, item_naam, eenheid, delta, aantal_after, note, door)
    values (v_item.id, v_item.naam, v_item.eenheid, p_aantal, p_aantal, 'Nieuw item', p_door);
  return true;
end; $$;

create or replace function fn_gangpot_mutate(p_item_id uuid, p_delta numeric, p_note text, p_door text, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_item gangpot_items;
begin
  if not _gangpot_ok(p_code_hash) then raise exception 'ONJUISTE_GANGPOTCODE'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  select * into v_item from gangpot_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'NIET_GEVONDEN'; end if;
  if v_item.aantal + p_delta < 0 then raise exception 'TE_WEINIG_IN_POT'; end if;
  update gangpot_items set aantal = aantal + p_delta where id = p_item_id returning * into v_item;
  insert into gangpot_log(item_id, item_naam, eenheid, delta, aantal_after, note, door)
    values (v_item.id, v_item.naam, v_item.eenheid, p_delta, v_item.aantal, nullif(left(trim(coalesce(p_note, '')), 120), ''), p_door);
  return true;
end; $$;

create or replace function fn_gangpot_delete_item(p_item_id uuid, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _gangpot_ok(p_code_hash) then raise exception 'ONJUISTE_GANGPOTCODE'; end if;
  delete from gangpot_items where id = p_item_id;
  if not found then raise exception 'NIET_GEVONDEN'; end if;
  return true;
end; $$;

-- wekelijkse bijdrage (week = datum van de vervaldag)
create or replace function fn_boss_set_gangpot_paid(p_user_id uuid, p_week date, p_paid boolean, p_door text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user users;
begin
  perform _require_boss(p_boss_pin_hash);
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  if p_week is null then raise exception 'ONGELDIGE_DATUM'; end if;
  delete from gangpot_payments where user_id = p_user_id and week = p_week;
  if p_paid then
    insert into gangpot_payments(week, user_id, user_name, door) values (p_week, v_user.id, v_user.name, p_door);
  end if;
  return true;
end; $$;

-- ============================================================
-- opslag loods (opslag-code of bosscode)
-- ============================================================
create or replace function fn_complete_mission(p_type text, p_user_id uuid, p_code_hash text)
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
  if p_type = 'basecoke' then
    perform _gangpot_book('Base', 'stuks', 600, 'Base coke missie — ' || v_user.name, v_user.name);
  end if;
  return true;
end; $$;

create or replace function fn_mutate_base(p_delta numeric, p_note text, p_door text, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _opslag_ok(p_code_hash) then raise exception 'ONJUISTE_OPSLAGCODE'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  perform _gangpot_book('Base', 'stuks', p_delta, nullif(left(trim(coalesce(p_note, '')), 120), ''), p_door);
  return true;
end; $$;

-- ============================================================
-- amfi loods
-- ============================================================
-- p_intro = eerste bot-bericht, met {nr} en {pos} als plaatshouders (de browser maakt de tekst op)
create or replace function fn_amfi_create_ticket(p_user_id uuid, p_keer integer, p_levering text, p_opmerking text,
  p_quote jsonb, p_intro text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user users; v_nr int; v_t amfi_tickets; v_pos int; v_opm text;
begin
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  if not (v_user.access_amfi or v_user.amfi_staff or lower(v_user.name) = 'gangpot') then raise exception 'GEEN_TOEGANG'; end if;
  if p_keer is null or p_keer <= 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  if p_keer > 100 then raise exception 'TE_VEEL_KEER'; end if;
  if p_levering not in ('zelf','wij') then raise exception 'ONGELDIGE_LEVERING'; end if;
  if exists (select 1 from amfi_tickets where user_id = p_user_id and status in ('wachtrij','bezig')) then raise exception 'AL_OPEN_TICKET'; end if;
  update portal_settings set ticket_seq = ticket_seq + 1 where id = true returning ticket_seq into v_nr;
  v_opm := nullif(left(trim(coalesce(p_opmerking, '')), 300), '');
  insert into amfi_tickets(nr, user_id, user_name, keer, levering, opmerking, quote)
    values (v_nr, v_user.id, v_user.name, p_keer, p_levering, v_opm, p_quote) returning * into v_t;
  select count(*) into v_pos from amfi_tickets where status = 'wachtrij' and created_at <= v_t.created_at;
  insert into amfi_messages(ticket_id, sender, user_id, user_name, text, ts)
    values (v_t.id, 'bot', null, 'Varrios bot', replace(replace(p_intro, '{nr}', lpad(v_nr::text, 3, '0')), '{pos}', v_pos::text), v_t.created_at);
  if v_opm is not null then
    insert into amfi_messages(ticket_id, sender, user_id, user_name, text, ts)
      values (v_t.id, 'user', v_user.id, v_user.name, v_opm, v_t.created_at + interval '1 millisecond');
  end if;
  return v_t.id;
end; $$;

-- wie mag wat: eigenaar, amfi-medewerker of Boss (bosscode)
create or replace function fn_amfi_message(p_ticket_id uuid, p_user_id uuid, p_name text, p_text text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_t amfi_tickets; v_user users; v_owner boolean; v_staff boolean; v_text text;
begin
  select * into v_t from amfi_tickets where id = p_ticket_id;
  if v_t.id is null then raise exception 'TICKET_NIET_GEVONDEN'; end if;
  if v_t.status not in ('wachtrij','bezig') then raise exception 'TICKET_GESLOTEN'; end if;
  select * into v_user from users where id = p_user_id;
  v_owner := v_user.id is not null and v_user.id = v_t.user_id;
  v_staff := _is_boss(p_boss_pin_hash) or coalesce(v_user.amfi_staff, false);
  if not v_owner and not v_staff then raise exception 'GEEN_MEDEWERKER'; end if;
  v_text := left(trim(coalesce(p_text, '')), 500);
  if length(v_text) = 0 then raise exception 'LEEG_BERICHT'; end if;
  insert into amfi_messages(ticket_id, sender, user_id, user_name, text)
    values (v_t.id, case when v_owner then 'user' else 'staff' end, v_user.id,
            case when v_owner then v_user.name else coalesce(nullif(p_name, ''), v_user.name) end, v_text);
  update amfi_tickets set updated_at = now() where id = v_t.id;
  return true;
end; $$;

create or replace function fn_amfi_claim(p_ticket_id uuid, p_user_id uuid, p_name text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_t amfi_tickets; v_user users;
begin
  select * into v_t from amfi_tickets where id = p_ticket_id for update;
  if v_t.id is null then raise exception 'TICKET_NIET_GEVONDEN'; end if;
  select * into v_user from users where id = p_user_id;
  if not (_is_boss(p_boss_pin_hash) or coalesce(v_user.amfi_staff, false)) then raise exception 'GEEN_MEDEWERKER'; end if;
  if v_t.status not in ('wachtrij','bezig') then raise exception 'TICKET_GESLOTEN'; end if;
  update amfi_tickets set status = 'bezig', medewerker_id = v_user.id, medewerker_naam = coalesce(nullif(p_name, ''), v_user.name),
    updated_at = now() where id = v_t.id;
  insert into amfi_messages(ticket_id, sender, user_name, text)
    values (v_t.id, 'bot', 'Varrios bot', coalesce(nullif(p_name, ''), v_user.name) || ' helpt je nu verder.');
  return true;
end; $$;

-- status: 'klaar' | 'wachtrij' (terugzetten) door medewerker/boss — 'geannuleerd' ook door de eigenaar zolang het in de wachtrij staat
create or replace function fn_amfi_set_status(p_ticket_id uuid, p_status text, p_user_id uuid, p_name text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_t amfi_tickets; v_user users; v_owner boolean; v_staff boolean; v_txt text; v_name text;
begin
  select * into v_t from amfi_tickets where id = p_ticket_id for update;
  if v_t.id is null then raise exception 'TICKET_NIET_GEVONDEN'; end if;
  if p_status not in ('wachtrij','bezig','klaar','geannuleerd') then raise exception 'ONGELDIGE_STATUS'; end if;
  select * into v_user from users where id = p_user_id;
  v_owner := v_user.id is not null and v_user.id = v_t.user_id;
  v_staff := _is_boss(p_boss_pin_hash) or coalesce(v_user.amfi_staff, false);
  if not (v_staff or (v_owner and p_status = 'geannuleerd' and v_t.status = 'wachtrij')) then raise exception 'GEEN_MEDEWERKER'; end if;
  if v_t.status not in ('wachtrij','bezig') then raise exception 'TICKET_GESLOTEN'; end if;
  v_name := coalesce(nullif(p_name, ''), v_user.name);
  v_txt := case p_status
    when 'klaar' then 'Ticket afgerond door ' || v_name || '. Bedankt!'
    when 'geannuleerd' then 'Ticket geannuleerd door ' || case when v_owner then v_t.user_name else v_name end || '.'
    when 'wachtrij' then 'Je ticket staat terug in de wachtrij — een andere medewerker neemt het over.'
    else v_name || ' helpt je nu verder.' end;
  update amfi_tickets set status = p_status, updated_at = now(),
    medewerker_id = case when p_status = 'wachtrij' then null else medewerker_id end,
    medewerker_naam = case when p_status = 'wachtrij' then null else medewerker_naam end
    where id = v_t.id;
  insert into amfi_messages(ticket_id, sender, user_name, text) values (v_t.id, 'bot', 'Varrios bot', v_txt);
  return true;
end; $$;

create or replace function fn_amfi_mark_read(p_ticket_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update amfi_tickets set read = read || jsonb_build_object(p_user_id::text, now()) where id = p_ticket_id;
  return true;
end; $$;

create or replace function fn_boss_set_amfi_settings(p_settings jsonb, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or jsonb_typeof(p_settings -> 'winkels') <> 'array' then
    raise exception 'ONGELDIGE_PRIJZEN';
  end if;
  update portal_settings set amfi = p_settings where id = true;
  return true;
end; $$;

-- ============================================================
-- rechten
-- ============================================================
grant execute on function
  fn_set_site_onderhoud(boolean, text),
  fn_verify_opslag(text), fn_verify_gangpot(text),
  fn_set_opslag_code(text, text), fn_set_gangpot_code(text, text),
  fn_boss_create_profile(text, text, boolean, boolean, boolean, boolean, text),
  fn_boss_set_access(uuid, text, boolean, text),
  fn_boss_set_rank(uuid, text, text),
  fn_add_absence(uuid, date, date, text, text), fn_delete_absence(uuid, uuid),
  fn_review_absence(uuid, text, text, text, text), fn_boss_delete_absence(uuid, text),
  fn_add_notice(text, text, text, text, text), fn_delete_notice(uuid, text),
  fn_add_event(text, text, date, text, text, text, text, text), fn_delete_event(uuid, text),
  fn_set_rsvp(uuid, uuid, text, text),
  fn_gangpot_add_item(text, text, numeric, text, text), fn_gangpot_mutate(uuid, numeric, text, text, text),
  fn_gangpot_delete_item(uuid, text), fn_boss_set_gangpot_paid(uuid, date, boolean, text, text),
  fn_complete_mission(text, uuid, text), fn_mutate_base(numeric, text, text, text),
  fn_amfi_create_ticket(uuid, integer, text, text, jsonb, text),
  fn_amfi_message(uuid, uuid, text, text, text), fn_amfi_claim(uuid, uuid, text, text),
  fn_amfi_set_status(uuid, text, uuid, text, text), fn_amfi_mark_read(uuid, uuid),
  fn_boss_set_amfi_settings(jsonb, text)
to anon, authenticated;
