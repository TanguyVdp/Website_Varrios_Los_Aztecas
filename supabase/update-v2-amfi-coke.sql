-- ============================================================
-- Varrios portaal v2 — update: de amfi-ruil vraagt ook 150 coke bladeren (van de klant)
-- Aantal is aanpasbaar in Boss menu → Amfi loods (0 = niet vragen). Tickets die al bestaan houden hun oude voorwaarden.
-- Vervangt _amfi_ruil, _fn_amfi_create_ticket (update-v2-amfi-gangpot.sql), _fn_amfi_set_status en
-- fn_boss_set_amfi_settings (update-v2-amfi-ruil.sql); verder ongewijzigd.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================

create or replace function _amfi_ruil() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('amfetamine', 50, 'coke_bladeren', 150, 'wit_geld', 50000, 'zwart_geld', 250000,
                            'mythisch_klant', 47, 'mythisch_loods', 3, 'cooldown_uur', 48)
         || coalesce((select amfi -> 'ruil' from portal_settings where id = true), '{}'::jsonb);
$$;

-- coke bladeren toevoegen aan de huidige instellingen (door de Boss ingestelde waarden blijven)
update portal_settings set amfi = jsonb_set(coalesce(amfi, '{}'::jsonb), '{ruil}', _amfi_ruil()) where id = true;

create or replace function _fn_amfi_create_ticket(p_user_id uuid, p_keer integer, p_levering text, p_opmerking text,
  p_quote jsonb, p_intro text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user users; v_nr int; v_t amfi_tickets; v_pos int; v_opm text; v_ruil jsonb; v_last timestamptz; v_quote jsonb; v_gp boolean;
begin
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  if not (v_user.access_amfi or v_user.amfi_staff or v_user.is_owner or lower(v_user.name) = 'gangpot') then raise exception 'GEEN_TOEGANG'; end if;
  v_gp := lower(trim(v_user.name)) = 'gangpot';   -- gangpot: geen limiet, geen cooldown
  perform pg_advisory_xact_lock(hashtext('amfi_ticket_' || p_user_id::text));   -- 2× tegelijk klikken = 1 ticket
  v_ruil := _amfi_ruil();
  if p_levering is distinct from 'ruil' then raise exception 'ONGELDIGE_LEVERING'; end if;
  if p_keer is distinct from (v_ruil ->> 'amfetamine')::int then raise exception 'TE_VEEL_KEER'; end if;
  if not v_gp and exists (select 1 from amfi_tickets where user_id = p_user_id and status in ('wachtrij','bezig')) then raise exception 'AL_OPEN_TICKET'; end if;
  select max(afgerond_at) into v_last from amfi_tickets where user_id = p_user_id and status = 'klaar';
  if not v_gp and v_last is not null and v_last + make_interval(hours => (v_ruil ->> 'cooldown_uur')::int) > now() then raise exception 'AMFI_COOLDOWN'; end if;
  -- de offerte komt van de server (niet uit de browser)
  v_quote := jsonb_build_object('type', 'ruil', 'keer', (v_ruil ->> 'amfetamine')::int, 'levering', 'ruil',
    'amfetamine', (v_ruil ->> 'amfetamine')::int, 'coke_bladeren', (v_ruil ->> 'coke_bladeren')::int, 'wit_geld', (v_ruil ->> 'wit_geld')::numeric, 'zwart_geld', (v_ruil ->> 'zwart_geld')::numeric,
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
        'Ruil afgerond door ' || v_name || ': ' || (v_q ->> 'amfetamine') || ' amfetamine + ' || case when coalesce((v_q ->> 'coke_bladeren')::int, 0) > 0 then (v_q ->> 'coke_bladeren') || ' coke bladeren + ' else '' end || '€ ' || replace(to_char((v_q ->> 'wit_geld')::numeric, 'FM999,999,999'), ',', '.') ||
        ' wit + € ' || replace(to_char((v_q ->> 'zwart_geld')::numeric, 'FM999,999,999'), ',', '.') || ' zwart ontvangen → ' || (v_q ->> 'mythisch_klant') ||
        ' mythische geleverd. Je kan een nieuw ticket maken vanaf ' ||
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

create or replace function fn_boss_set_amfi_settings(p_settings jsonb, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform _require_boss(p_boss_pin_hash);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or jsonb_typeof(p_settings -> 'winkels') <> 'array'
     or jsonb_typeof(p_settings -> 'ruil') <> 'object' then
    raise exception 'ONGELDIGE_PRIJZEN';
  end if;
  foreach k in array array['amfetamine','coke_bladeren','wit_geld','zwart_geld','mythisch_klant','mythisch_loods','cooldown_uur'] loop
    if jsonb_typeof(p_settings -> 'ruil' -> k) <> 'number' or (p_settings -> 'ruil' ->> k)::numeric < 0
       or (p_settings -> 'ruil' ->> k)::numeric <> trunc((p_settings -> 'ruil' ->> k)::numeric) then
      raise exception 'ONGELDIGE_RUIL';
    end if;
  end loop;
  if (p_settings -> 'ruil' ->> 'amfetamine')::numeric <= 0 then raise exception 'ONGELDIGE_RUIL'; end if;
  update portal_settings set amfi = p_settings where id = true;
  return true;
end; $$;

revoke execute on function _amfi_ruil() from public, anon, authenticated;
revoke execute on function _fn_amfi_create_ticket(uuid, integer, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function _fn_amfi_set_status(uuid, text, uuid, text, text) from public, anon, authenticated;

-- controle: dit moet "coke_bladeren": 150 tonen
select amfi -> 'ruil' as ruil from portal_settings where id = true;
