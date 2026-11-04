-- ============================================================
-- Varrios portaal v2 — update: de gangpot mag onbeperkt amfi-tickets maken
-- Wie het Boss menu heeft, kan op de site "Werken als Gangpot" (profiel → Gangpot-account). Tickets op naam van het
-- gangpot-profiel hebben geen limiet van 1 open ticket en geen cooldown. Een gewoon lid kan niet als gangpot handelen:
-- het omhulsel fn_amfi_create_ticket laat enkel jezelf of de Boss toe (_require_self, update-v2-discord-login.sql).
-- Vervangt _fn_amfi_create_ticket uit update-v2-amfi-ruil.sql (verder ongewijzigd).
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
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

revoke execute on function _fn_amfi_create_ticket(uuid, integer, text, text, jsonb, text) from public, anon, authenticated;
