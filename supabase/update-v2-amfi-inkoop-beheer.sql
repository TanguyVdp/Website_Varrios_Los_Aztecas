-- ============================================================
-- Varrios portaal v2 — update: inkoop beheren in Boss menu → Amfi loods
--   * aanpassen: wie, aantal (0 mag), prijs per stuk, opmerking  → fn_amfi_edit_inkoop
--   * uitbetalen: per medewerker of alles → registraties krijgen uitbetaald_at en tellen niet meer mee
--     in de kosten en de voorraad (opnieuw starten vanaf 0); ze blijven bewaard in het archief → fn_amfi_inkoop_uitbetaald
--   * terugzetten (uitbetaling ongedaan maken voor één regel) → fn_amfi_inkoop_terug
--   * verwijderen bestond al (fn_amfi_delete_inkoop)
-- Enkel wie het Boss menu heeft (ook als die "als gangpot" werkt). Voer dit uit in de Supabase SQL Editor. Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
alter table amfi_inkoop drop constraint if exists amfi_inkoop_aantal_check;
alter table amfi_inkoop add constraint amfi_inkoop_aantal_check check (aantal >= 0);
alter table amfi_inkoop add column if not exists uitbetaald_at timestamptz;
alter table amfi_inkoop add column if not exists uitbetaald_door text;

create or replace function fn_amfi_edit_inkoop(p_id uuid, p_user_id uuid, p_aantal integer, p_prijs numeric, p_note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user users;
begin
  perform _require_boss(null);
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  if p_aantal is null or p_aantal < 0 or p_aantal > 1000000 then raise exception 'ONGELDIG_AANTAL'; end if;
  if p_prijs is null or p_prijs < 0 then raise exception 'ONGELDIGE_PRIJS'; end if;
  update amfi_inkoop set user_id = v_user.id, user_name = v_user.name, aantal = p_aantal, prijs = p_prijs,
    totaal = round(p_aantal * p_prijs, 2), note = nullif(left(trim(coalesce(p_note, '')), 120), '')
    where id = p_id;
  if not found then raise exception 'NIET_GEVONDEN'; end if;
  return true;
end; $$;

-- p_user_id null = alles wat nog open staat; geeft het aantal uitbetaalde regels terug
create or replace function fn_amfi_inkoop_uitbetaald(p_user_id uuid, p_door text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform _require_boss(null);
  update amfi_inkoop set uitbetaald_at = now(), uitbetaald_door = left(coalesce(p_door, ''), 60)
    where uitbetaald_at is null and (p_user_id is null or user_id = p_user_id);
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

create or replace function fn_amfi_inkoop_terug(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(null);
  update amfi_inkoop set uitbetaald_at = null, uitbetaald_door = null where id = p_id;
  if not found then raise exception 'NIET_GEVONDEN'; end if;
  return true;
end; $$;

revoke execute on function fn_amfi_edit_inkoop(uuid, uuid, integer, numeric, text) from public, anon;
revoke execute on function fn_amfi_inkoop_uitbetaald(uuid, text) from public, anon;
revoke execute on function fn_amfi_inkoop_terug(uuid) from public, anon;
grant execute on function fn_amfi_edit_inkoop(uuid, uuid, integer, numeric, text) to authenticated;
grant execute on function fn_amfi_inkoop_uitbetaald(uuid, text) to authenticated;
grant execute on function fn_amfi_inkoop_terug(uuid) to authenticated;
grant execute on all functions in schema public to service_role;
