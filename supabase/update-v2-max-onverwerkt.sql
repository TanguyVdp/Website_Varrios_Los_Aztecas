-- ============================================================
-- Varrios portaal v2 — update: de Boss stelt zelf in hoeveel planten één persoon tegelijk onverwerkt
-- in de Wiet loods mag hebben (Boss menu → Wiet loods → Wachtrij → "Limiet per persoon"). Standaard 6000.
-- Het gangpot-profiel heeft nog altijd geen limiet.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================

-- 1. de instelling
alter table loods_baseline add column if not exists max_onverwerkt integer not null default 6000;

create or replace function fn_set_max_onverwerkt(p_max integer)
returns loods_baseline language plpgsql security definer set search_path = public as $$
declare v_row loods_baseline;
begin
  perform _require_boss(null);
  if p_max is null or p_max < 100 or p_max > 100000 then raise exception 'ONGELDIGE_MAX_INLEG'; end if;
  update loods_baseline set max_onverwerkt = p_max, set_at = now(),
    set_by = coalesce((select 'Boss (' || name || ')' from users where id = _me()), set_by)
    where id = true returning * into v_row;
  return v_row;
end; $$;
revoke execute on function fn_set_max_onverwerkt(integer) from public, anon;
grant execute on function fn_set_max_onverwerkt(integer) to authenticated, service_role;

-- 2. inleggen controleert de ingestelde limiet i.p.v. de vaste 6000
--    (_fn_register_inleg = de echte functie achter fn_register_inleg, zie update-v2-discord-login.sql)
create or replace function _fn_register_inleg(p_user_id uuid, p_amount integer, p_huidig_momenteel_inleg integer)
returns loods_log
language plpgsql security definer set search_path = public as $$
declare v_before int; v_after int; v_user users; v_log loods_log; v_rest int; v_max int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  select * into v_user from users where id = p_user_id for update;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  -- max onverwerkt per persoon (ingesteld door de Boss; de gangpot heeft geen limiet)
  v_max := coalesce((select max_onverwerkt from loods_baseline where id = true), 6000);
  if lower(v_user.name) <> 'gangpot' and p_huidig_momenteel_inleg is not null and p_huidig_momenteel_inleg + p_amount > v_max then
    raise exception 'MAX_ONVERWERKT_BEREIKT';
  end if;
  v_rest := greatest(0, v_user.total_ingelegd - v_user.legacy_zakjes * 3);
  v_before := v_user.legacy_zakjes + floor(v_rest / 2.0);
  update users set total_ingelegd = total_ingelegd + p_amount
    where id = p_user_id returning * into v_user;
  v_rest := greatest(0, v_user.total_ingelegd - v_user.legacy_zakjes * 3);
  v_after := v_user.legacy_zakjes + floor(v_rest / 2.0);
  insert into loods_log(type, user_id, user_name, amount, cumulative_after, zakjes_after, zakjes_delta)
    values ('inleg', v_user.id, v_user.name, p_amount, v_user.total_ingelegd, v_after, v_after - v_before)
    returning * into v_log;
  return v_log;
end; $$;
revoke execute on function _fn_register_inleg(uuid, integer, integer) from public, anon, authenticated;
