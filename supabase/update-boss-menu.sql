-- ============================================================
-- Wietloods — update: Boss menu + profielen opruimen
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run),
-- NA het hoofdschema (schema.sql) dat je al gerund hebt.
-- ============================================================

-- ============== BOSSCODE ==============

create table if not exists admin_config (
  id boolean primary key default true,
  boss_pin_hash text,
  constraint admin_config_singleton check (id)
);
insert into admin_config (id, boss_pin_hash) values (true, null)
  on conflict (id) do nothing;

-- Stel hier ZELF je bosscode in — vervang 'XXXX' door de code die jullie willen
-- gebruiken (cijfers of tekst, minstens 4 tekens). Deze regel bewaart enkel een
-- versleutelde hash, nooit de code zelf.
update admin_config set boss_pin_hash = encode(digest('XXXX', 'sha256'), 'hex') where id = true;

alter table admin_config enable row level security;
-- Bewust GEEN select-policy: de hash mag nooit naar de browser, enkel de
-- functie hieronder mag hem gebruiken (ze draait als eigenaar, dus mag lezen).

create or replace function fn_verify_boss(p_pin_hash text)
returns boolean
language sql security definer set search_path = public as $$
  select exists(select 1 from admin_config where id = true and boss_pin_hash = p_pin_hash);
$$;
grant execute on function fn_verify_boss(text) to anon, authenticated;

-- ============== REALTIME voor admin_config uitsluiten ==============
-- (niet nodig toe te voegen aan de realtime-publicatie: bevat enkel de
-- geheime hash en hoeft niet live gesynchroniseerd te worden)

-- ============== PROFIELEN OPRUIMEN ==============
-- Verwijdert de profielen "KDR" en "Piet". Hun eerdere inleg/ophaal- en
-- leveringsregels in het logboek BLIJVEN gewoon zichtbaar (met hun naam) —
-- enkel het inlogprofiel zelf verdwijnt, ze kunnen niet meer inloggen.

delete from users where lower(name) in ('kdr','piet');
