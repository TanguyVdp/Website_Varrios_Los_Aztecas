-- ============================================================
-- Varrios portaal v2 — update: Amfi loods = vaste ruil + beheer in het Boss menu
--
-- Ruil (instelbaar in Boss menu → Amfi loods, opgeslagen in portal_settings.amfi -> 'ruil'):
--   klant levert 50 amfetamine + € 50.000 wit + € 250.000 zwart  →  krijgt 47 mythische
--   de loods houdt 3 mythische + de € 50.000 wit geld
--   altijd exact 50 per ticket; daarna 48u cooldown (vanaf het afronden van je vorige ticket)
-- Het oude model (zelf aanleveren / wij kopen aan) verdwijnt; oude tickets blijven leesbaar.
--
-- Nieuw:
--   * amfi_tickets: afgerond_at / afgerond_door_* + wat de ruil opbracht (bevroren bij het afronden)
--   * amfi_inkoop:  wat medewerkers voor de loods kochten (enkel producten uit toegelaten winkels,
--                   prijs komt uit de instellingen, niet uit de browser)
--
-- ⚠️ fn_amfi_create_ticket / fn_amfi_set_status zijn omhulsels (update-v2-discord-login.sql):
--    hier worden de echte functies _fn_amfi_create_ticket / _fn_amfi_set_status vervangen.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================

-- ---------- 1. tickets: nieuwe kolommen ----------
alter table amfi_tickets add column if not exists afgerond_at timestamptz;
alter table amfi_tickets add column if not exists afgerond_door_id uuid references users(id) on delete set null;
alter table amfi_tickets add column if not exists afgerond_door_naam text;
alter table amfi_tickets add column if not exists amfetamine integer;        -- binnengebracht (enkel bij een ruil)
alter table amfi_tickets add column if not exists wit_geld numeric;          -- naar de loods
alter table amfi_tickets add column if not exists zwart_geld numeric;
alter table amfi_tickets add column if not exists mythisch_klant integer;    -- terug naar de klant
alter table amfi_tickets add column if not exists mythisch_loods integer;    -- blijft in de loods

-- levering 'ruil' = het nieuwe model
alter table amfi_tickets drop constraint if exists amfi_tickets_levering_check;
alter table amfi_tickets add constraint amfi_tickets_levering_check check (levering in ('zelf','wij','ruil'));

-- oude afgeronde tickets: afrondmoment + medewerker overnemen (tellen mee bij "geholpen", niet bij de opbrengst)
update amfi_tickets set afgerond_at = updated_at, afgerond_door_id = medewerker_id, afgerond_door_naam = medewerker_naam
  where status = 'klaar' and afgerond_at is null;

create index if not exists amfi_tickets_user_klaar_idx on amfi_tickets (user_id, afgerond_at) where status = 'klaar';

-- ---------- 2. instellingen: ruil + toegelaten winkels ----------
-- standaardwaarden als de Boss nog niets ingesteld heeft
create or replace function _amfi_ruil() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('amfetamine', 50, 'wit_geld', 50000, 'zwart_geld', 250000,
                            'mythisch_klant', 47, 'mythisch_loods', 3, 'cooldown_uur', 48)
         || coalesce((select amfi -> 'ruil' from portal_settings where id = true), '{}'::jsonb);
$$;

update portal_settings set amfi = jsonb_set(coalesce(amfi, '{}'::jsonb), '{ruil}', _amfi_ruil()) where id = true;

-- winkels: 'inkoop' = mag gebruikt worden voor de inkoopregistratie (standaard: groothandel, apotheek, standaard winkel)
update portal_settings set amfi = jsonb_set(amfi, '{winkels}', (
    select coalesce(jsonb_agg(case when w ? 'inkoop' then w
                                   else w || jsonb_build_object('inkoop', lower(w ->> 'naam') in ('groothandel','apotheek','standaard winkel')) end), '[]'::jsonb)
    from jsonb_array_elements(amfi -> 'winkels') w))
  where id = true and jsonb_typeof(amfi -> 'winkels') = 'array';

-- ---------- 3. ticket aanmaken: altijd exact de ruil, max 1 open ticket, cooldown ----------
create or replace function _fn_amfi_create_ticket(p_user_id uuid, p_keer integer, p_levering text, p_opmerking text,
  p_quote jsonb, p_intro text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user users; v_nr int; v_t amfi_tickets; v_pos int; v_opm text; v_ruil jsonb; v_last timestamptz; v_quote jsonb;
begin
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  if not (v_user.access_amfi or v_user.amfi_staff or v_user.is_owner or lower(v_user.name) = 'gangpot') then raise exception 'GEEN_TOEGANG'; end if;
  perform pg_advisory_xact_lock(hashtext('amfi_ticket_' || p_user_id::text));   -- 2× tegelijk klikken = 1 ticket
  v_ruil := _amfi_ruil();
  if p_levering is distinct from 'ruil' then raise exception 'ONGELDIGE_LEVERING'; end if;
  if p_keer is distinct from (v_ruil ->> 'amfetamine')::int then raise exception 'TE_VEEL_KEER'; end if;
  if exists (select 1 from amfi_tickets where user_id = p_user_id and status in ('wachtrij','bezig')) then raise exception 'AL_OPEN_TICKET'; end if;
  select max(afgerond_at) into v_last from amfi_tickets where user_id = p_user_id and status = 'klaar';
  if v_last is not null and v_last + make_interval(hours => (v_ruil ->> 'cooldown_uur')::int) > now() then raise exception 'AMFI_COOLDOWN'; end if;
  -- de offerte komt van de server (niet uit de browser)
  v_quote := jsonb_build_object('type', 'ruil', 'keer', (v_ruil ->> 'amfetamine')::int, 'levering', 'ruil',
    'amfetamine', (v_ruil ->> 'amfetamine')::int, 'wit_geld', (v_ruil ->> 'wit_geld')::numeric, 'zwart_geld', (v_ruil ->> 'zwart_geld')::numeric,
    'mythisch_klant', (v_ruil ->> 'mythisch_klant')::int, 'mythisch_loods', (v_ruil ->> 'mythisch_loods')::int,
    'cooldown_uur', (v_ruil ->> 'cooldown_uur')::int);
  update portal_settings set ticket_seq = ticket_seq + 1 where id = true returning ticket_seq into v_nr;
  v_opm := nullif(left(trim(coalesce(p_opmerking, '')), 300), '');
  insert into amfi_tickets(nr, user_id, user_name, keer, levering, opmerking, quote)
    values (v_nr, v_user.id, v_user.name, (v_ruil ->> 'amfetamine')::int, 'ruil', v_opm, v_quote) returning * into v_t;
  select count(*) into v_pos from amfi_tickets where status = 'wachtrij' and created_at <= v_t.created_at;
  insert into amfi_messages(ticket_id, sender, user_id, user_name, text, ts)
    values (v_t.id, 'bot', null, 'Varrios bot', replace(replace(p_intro, '{nr}', lpad(v_nr::text, 3, '0')), '{pos}', v_pos::text), v_t.created_at);
  if v_opm is not null then
    insert into amfi_messages(ticket_id, sender, user_id, user_name, text, ts)
      values (v_t.id, 'user', v_user.id, v_user.name, v_opm, v_t.created_at + interval '1 millisecond');
  end if;
  return v_t.id;
end; $$;

-- ---------- 4. status: bij 'klaar' de ruil vastleggen (kan maar één keer: het ticket is daarna gesloten) ----------
create or replace function _fn_amfi_set_status(p_ticket_id uuid, p_status text, p_user_id uuid, p_name text, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_t amfi_tickets; v_user users; v_owner boolean; v_staff boolean; v_txt text; v_name text; v_q jsonb; v_ruil boolean;
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
  v_q := v_t.quote;
  v_ruil := v_t.levering = 'ruil';
  v_txt := case p_status
    when 'klaar' then case when v_ruil then
        'Ruil afgerond door ' || v_name || ': ' || (v_q ->> 'amfetamine') || ' amfetamine + € ' || replace(to_char((v_q ->> 'wit_geld')::numeric, 'FM999,999,999'), ',', '.') ||
        ' wit + € ' || replace(to_char((v_q ->> 'zwart_geld')::numeric, 'FM999,999,999'), ',', '.') || ' zwart ontvangen → ' || (v_q ->> 'mythisch_klant') ||
        ' mythische gegeven. Je kan een nieuw ticket maken vanaf ' ||
        to_char((now() + make_interval(hours => coalesce((v_q ->> 'cooldown_uur')::int, 0))) at time zone 'Europe/Brussels', 'DD/MM "om" HH24:MI') || '. Bedankt!'
      else 'Ticket afgerond door ' || v_name || '. Bedankt!' end
    when 'geannuleerd' then 'Ticket geannuleerd door ' || case when v_owner then v_t.user_name else v_name end || '.'
    when 'wachtrij' then 'Je ticket staat terug in de wachtrij — een andere medewerker neemt het over.'
    else v_name || ' helpt je nu verder.' end;
  update amfi_tickets set status = p_status, updated_at = now(),
    medewerker_id = case when p_status = 'wachtrij' then null when p_status = 'klaar' then coalesce(medewerker_id, v_user.id) else medewerker_id end,
    medewerker_naam = case when p_status = 'wachtrij' then null when p_status = 'klaar' then coalesce(medewerker_naam, v_name) else medewerker_naam end,
    afgerond_at = case when p_status = 'klaar' then now() end,
    afgerond_door_id = case when p_status = 'klaar' then v_user.id end,
    afgerond_door_naam = case when p_status = 'klaar' then v_name end,
    amfetamine = case when p_status = 'klaar' and v_ruil then (v_q ->> 'amfetamine')::int end,
    wit_geld = case when p_status = 'klaar' and v_ruil then (v_q ->> 'wit_geld')::numeric end,
    zwart_geld = case when p_status = 'klaar' and v_ruil then (v_q ->> 'zwart_geld')::numeric end,
    mythisch_klant = case when p_status = 'klaar' and v_ruil then (v_q ->> 'mythisch_klant')::int end,
    mythisch_loods = case when p_status = 'klaar' and v_ruil then (v_q ->> 'mythisch_loods')::int end
    where id = v_t.id;
  insert into amfi_messages(ticket_id, sender, user_name, text) values (v_t.id, 'bot', 'Varrios bot', v_txt);
  return true;
end; $$;

-- ---------- 5. inkoop: wat medewerkers voor de loods kochten ----------
create table if not exists amfi_inkoop (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,   -- wie het gekocht heeft
  user_name text not null,
  winkel text not null,
  product text not null,
  aantal integer not null check (aantal > 0),
  prijs numeric not null,                                  -- prijs per stuk op het moment van registreren
  totaal numeric not null,
  zwart boolean not null default false,
  note text,
  door text,                                               -- wie het ingevuld heeft
  ts timestamptz not null default now()
);
create index if not exists amfi_inkoop_ts_idx on amfi_inkoop (ts);

alter table amfi_inkoop enable row level security;
drop policy if exists "leden lezen" on amfi_inkoop;
create policy "leden lezen" on amfi_inkoop for select to authenticated using ((select _is_member()));
revoke all on amfi_inkoop from anon;
grant select on amfi_inkoop to authenticated;
grant select, insert, update, delete on amfi_inkoop to service_role;
do $$ begin
  alter publication supabase_realtime add table amfi_inkoop;
exception when duplicate_object then null;
end $$;

-- enkel producten uit een winkel met 'inkoop' aan, met een prijs; de prijs komt uit de instellingen
create or replace function fn_amfi_add_inkoop(p_user_id uuid, p_product text, p_aantal integer, p_note text, p_door text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user users; v_w jsonb; v_p jsonb; v_id uuid; v_prijs numeric;
begin
  perform _require_boss(null);
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  if p_aantal is null or p_aantal <= 0 or p_aantal > 1000000 then raise exception 'ONGELDIG_AANTAL'; end if;
  select w, p into v_w, v_p
    from portal_settings s, jsonb_array_elements(s.amfi -> 'winkels') w, jsonb_array_elements(w -> 'producten') p
    where s.id = true and coalesce((w ->> 'inkoop')::boolean, false)
      and lower(trim(p ->> 'naam')) = lower(trim(coalesce(p_product, '')))
      and nullif(p ->> 'prijs', '') is not null
    limit 1;
  if v_p is null then raise exception 'PRODUCT_NIET_TOEGELATEN'; end if;
  v_prijs := (v_p ->> 'prijs')::numeric;
  insert into amfi_inkoop(user_id, user_name, winkel, product, aantal, prijs, totaal, zwart, note, door)
    values (v_user.id, v_user.name, v_w ->> 'naam', v_p ->> 'naam', p_aantal, v_prijs, round(p_aantal * v_prijs, 2),
            coalesce((v_p ->> 'zwart')::boolean, false), nullif(left(trim(coalesce(p_note, '')), 120), ''), left(coalesce(p_door, ''), 60))
    returning id into v_id;
  return v_id;
end; $$;

create or replace function fn_amfi_delete_inkoop(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(null);
  delete from amfi_inkoop where id = p_id;
  if not found then raise exception 'NIET_GEVONDEN'; end if;
  return true;
end; $$;

-- ---------- 6. instellingen opslaan: ook de ruil controleren ----------
create or replace function fn_boss_set_amfi_settings(p_settings jsonb, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform _require_boss(p_boss_pin_hash);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or jsonb_typeof(p_settings -> 'winkels') <> 'array'
     or jsonb_typeof(p_settings -> 'ruil') <> 'object' then
    raise exception 'ONGELDIGE_PRIJZEN';
  end if;
  foreach k in array array['amfetamine','wit_geld','zwart_geld','mythisch_klant','mythisch_loods','cooldown_uur'] loop
    if jsonb_typeof(p_settings -> 'ruil' -> k) <> 'number' or (p_settings -> 'ruil' ->> k)::numeric < 0
       or (p_settings -> 'ruil' ->> k)::numeric <> trunc((p_settings -> 'ruil' ->> k)::numeric) then
      raise exception 'ONGELDIGE_RUIL';
    end if;
  end loop;
  if (p_settings -> 'ruil' ->> 'amfetamine')::numeric <= 0 then raise exception 'ONGELDIGE_RUIL'; end if;
  update portal_settings set amfi = p_settings where id = true;
  return true;
end; $$;

-- ---------- 7. rechten ----------
revoke execute on function _amfi_ruil() from public, anon, authenticated;
revoke execute on function _fn_amfi_create_ticket(uuid, integer, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function _fn_amfi_set_status(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function fn_amfi_add_inkoop(uuid, text, integer, text, text) from public, anon;
revoke execute on function fn_amfi_delete_inkoop(uuid) from public, anon;
grant execute on function fn_amfi_add_inkoop(uuid, text, integer, text, text) to authenticated;
grant execute on function fn_amfi_delete_inkoop(uuid) to authenticated;
grant execute on all functions in schema public to service_role;
