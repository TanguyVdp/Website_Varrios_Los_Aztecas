-- ============================================================
-- Varrios portaal v2 — update: de Boss kan elke afwezigheid schrappen
-- (Boss menu → Afwezigheden → "Schrappen"). Vraagt de bosscode.
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
-- ============================================================

create or replace function fn_boss_delete_absence(p_id uuid, p_boss_pin_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _require_boss(p_boss_pin_hash);
  delete from absences where id = p_id;
  if not found then raise exception 'AFWEZIGHEID_NIET_GEVONDEN'; end if;
  return true;
end; $$;
grant execute on function fn_boss_delete_absence(uuid, text) to anon, authenticated;
