-- ============================================================
-- Varrios portaal v2 — EENMALIGE fix: logboek van Mika K. gelijk trekken met zijn totaal
--
-- Op 10/11 zette een Boss-correctie het totaal ingelegd van Mika van 25.928 naar 25.628 (300 planten minder),
-- maar zijn inleg-regels in het logboek bleven staan → de wachtrij rekende nog met 150 zakjes die er niet waren.
-- Dit script haalt die 300 planten weg uit zijn laatste inleg-regel(s) van vóór die correctie
-- (een regel die er volledig door verdwijnt, wordt verwijderd) en herberekent zijn cumulatief/zakjes per regel.
--
-- Veilig: controleert eerst dat het verschil nog exact −300 is, en op het einde dat alles klopt.
-- Klopt er iets niet, dan stopt het met een foutmelding en verandert er NIETS.
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
-- ============================================================
begin;

do $$
declare
  v_uid uuid; v_lg int; v_total int; v_corr timestamptz; v_rest int := 300; v_take int; r record;
begin
  select id, legacy_zakjes, total_ingelegd into v_uid, v_lg, v_total from users where lower(trim(name)) = 'mika k.';
  if v_uid is null then raise exception 'Profiel "Mika K." niet gevonden — niets veranderd.'; end if;

  if v_total - (select coalesce(sum(amount), 0) from loods_log where user_id = v_uid and type = 'inleg') <> -300 then
    raise exception 'Het verschil bij Mika is geen -300 meer (al rechtgezet?) — niets veranderd.';
  end if;

  select max(ts) into v_corr from loods_log
   where user_id = v_uid and type = 'correctie' and note like '%25928%25628%';
  if v_corr is null then raise exception 'De correctie van 10/11 (25928 → 25628) niet gevonden — niets veranderd.'; end if;

  -- 300 planten weghalen uit de laatste inleg-regel(s) vóór de correctie
  for r in select id, amount from loods_log
            where user_id = v_uid and type = 'inleg' and ts < v_corr order by ts desc, id desc loop
    exit when v_rest = 0;
    v_take := least(r.amount, v_rest);
    if v_take = r.amount then
      delete from loods_log where id = r.id;
    else
      update loods_log set amount = amount - v_take,
             note = coalesce(note || ' · ', '') || 'gecorrigeerd: -' || v_take || ' planten (Boss-correctie 10/11)'
       where id = r.id;
    end if;
    v_rest := v_rest - v_take;
  end loop;
  if v_rest > 0 then raise exception 'Niet genoeg inleg gevonden vóór de correctie — niets veranderd.'; end if;

  -- cumulatief + zakjes per inleg-regel opnieuw berekenen (zelfde formule als fn_register_inleg)
  with s as (
    select id, sum(amount) over (order by ts, id) as cum
      from loods_log where user_id = v_uid and type = 'inleg'
  ), z as (
    select id, cum, v_lg + floor(greatest(0, cum - v_lg * 3) / 2.0)::int as za from s
  ), d as (
    select id, cum, za, lag(za, 1, v_lg) over (order by cum, id) as prev from z
  )
  update loods_log l set cumulative_after = d.cum, zakjes_after = d.za, zakjes_delta = d.za - d.prev
    from d where l.id = d.id;

  -- controle: het logboek telt nu exact op tot het totaal
  if v_total <> (select coalesce(sum(amount), 0) from loods_log where user_id = v_uid and type = 'inleg') then
    raise exception 'Controle mislukt: logboek ≠ totaal — niets veranderd.';
  end if;
end $$;

commit;

-- resultaat: verschil moet nu 0 zijn
select u.name, u.total_ingelegd,
  (select sum(amount) from loods_log l where l.user_id = u.id and l.type = 'inleg') as som_inleg_logboek,
  u.total_ingelegd - (select sum(amount) from loods_log l where l.user_id = u.id and l.type = 'inleg') as verschil
from users u where lower(trim(u.name)) = 'mika k.';
