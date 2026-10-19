-- ============================================================
-- Varrios portaal v2 — update: GEEN gangpot-afroming meer in de Wiet loods
--
-- 1. Vanaf nu: 2 planten = 1 zakje en ALLES gaat naar wie inlegt.
--    De gangpot krijgt niets meer automatisch (enkel wat het gangpot-profiel zelf inlegt).
-- 2. Eenmalige correctie: het gangpot-deel (1 op 5) van inleg die al geregistreerd is,
--    gaat terug naar wie inlegde. Die zakjes blijven op dezelfde plaats in de wachtrij
--    (bij de inleg van die persoon); de aparte gangpot-regels verdwijnen.
--    Stopt met een fout (en verandert dan niets) als de gangpot al meer opgehaald heeft
--    dan hij na de correctie nog zou hebben.
--
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
-- ============================================================

begin;

-- ---------- 1. inleg zonder afroming ----------
drop function if exists fn_register_inleg(uuid, integer, integer);
create or replace function fn_register_inleg(p_user_id uuid, p_amount integer, p_huidig_momenteel_inleg integer)
returns loods_log
language plpgsql security definer set search_path = public as $$
declare v_before int; v_after int; v_user users; v_log loods_log; v_rest int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'ONGELDIG_AANTAL'; end if;
  select * into v_user from users where id = p_user_id for update;
  if v_user.id is null then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  -- max 6000 onverwerkt per persoon (de gangpot heeft geen limiet)
  if lower(v_user.name) <> 'gangpot' and p_huidig_momenteel_inleg is not null and p_huidig_momenteel_inleg + p_amount > 6000 then
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
grant execute on function fn_register_inleg(uuid, integer, integer) to anon, authenticated;

-- ---------- 2. eenmalige correctie ----------
-- afroming-regels herkennen: inleg van de gangpot met exact hetzelfde tijdstip als de inleg van iemand anders
-- (beide werden in dezelfde transactie geschreven)
create temp table _af on commit drop as
  select g.id as gid, g.amount, p.id as pid, p.user_id as puid, p.ts
  from loods_log g
  join loods_log p on p.ts = g.ts and p.type = 'inleg' and p.user_id is distinct from g.user_id
  where g.type = 'inleg' and g.user_id = (select id from users where lower(name) = 'gangpot');

-- verschuiving van het totaal per persoon en per tijdstip (+ voor wie inlegde, − voor de gangpot)
create temp table _shift on commit drop as
  select puid as user_id, ts, amount as delta from _af
  union all
  select (select id from users where lower(name) = 'gangpot'), ts, -amount from _af;

-- de planten terug bij de inleg-regel van de persoon zetten, de gangpot-regels weg
update loods_log p set amount = p.amount + a.amount from _af a where p.id = a.pid;
delete from loods_log where id in (select gid from _af);

-- cumulatief + zakjes opnieuw berekenen voor alle inleg-regels van de betrokken profielen
with s as (
  select l.id, l.amount, u.legacy_zakjes as lg,
         l.cumulative_after + coalesce((select sum(x.delta) from _shift x where x.user_id = l.user_id and x.ts <= l.ts), 0) as cum
  from loods_log l join users u on u.id = l.user_id
  where l.type = 'inleg' and l.user_id in (select user_id from _shift)
)
update loods_log l set
  cumulative_after = s.cum,
  zakjes_after = s.lg + floor(greatest(0, s.cum - s.lg * 3) / 2.0),
  zakjes_delta = (s.lg + floor(greatest(0, s.cum - s.lg * 3) / 2.0))
               - (s.lg + floor(greatest(0, s.cum - s.amount - s.lg * 3) / 2.0))
from s where l.id = s.id;

-- totalen van de profielen
update users u set total_ingelegd = u.total_ingelegd + t.delta
from (select user_id, sum(delta) as delta from _shift group by user_id) t
where u.id = t.user_id;

-- veiligheid: de gangpot mag niet meer opgehaald hebben dan hij nu nog heeft
do $$
declare v users;
begin
  select * into v from users where lower(name) = 'gangpot';
  if v.id is not null and v.opgehaald > v.legacy_zakjes + floor(greatest(0, v.total_ingelegd - v.legacy_zakjes * 3) / 2.0) then
    raise exception 'De gangpot heeft al meer zakjes opgehaald dan hij na de correctie nog zou hebben — er is niets veranderd.';
  end if;
end $$;

commit;
