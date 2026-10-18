-- ============================================================
-- Varrios portaal v2 — update: max 100 amfetamine per amfi-ticket (was 50)
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
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
