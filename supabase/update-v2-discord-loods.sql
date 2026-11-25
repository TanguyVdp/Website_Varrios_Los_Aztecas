-- ============================================================
-- Varrios portaal v2 — update: loods-missies via Discord (los van de site)
-- Elke dag een bericht in het loods-kanaal met 3 missies (handelaar, skylift, terrorbite), elk 1× per dag af te vinken.
-- Handelaar = +600 base, skylift = +400 base (was +200 tot 25/11/2026), terrorbite = niets. De base blijft over de dagen heen bewaard;
-- "Reset base" (met code, gecontroleerd in de Edge Function) zet ze op 0.
-- Enkel de bot (agenda-bot.mjs) en de Edge Function (discord-agenda) gebruiken dit (service role); leden zien het niet.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
create table if not exists loods_missies (
  datum      date not null,                 -- dag in Belgische tijd
  type       text not null,                 -- handelaar | skylift | terrorbite
  discord_id text,
  door       text,                          -- naam in Discord van wie het deed
  base_erbij integer not null default 0,
  at         timestamptz not null default now(),
  primary key (datum, type)                 -- elke missie maar 1× per dag
);

create table if not exists loods_voorraad (
  id         boolean primary key default true check (id),   -- altijd precies 1 rij
  base       integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into loods_voorraad (id, base) values (true, 0) on conflict do nothing;

create table if not exists loods_discord (       -- welk Discord-bericht bij welke dag hoort
  datum      date primary key,
  channel_id text not null,
  message_id text not null,
  gesloten   boolean not null default false     -- true = dag voorbij, knoppen weg
);

alter table loods_missies  enable row level security;   -- geen policies: enkel de service role
alter table loods_voorraad enable row level security;
alter table loods_discord  enable row level security;
grant select, insert, update, delete on loods_missies, loods_voorraad, loods_discord to service_role;

-- missie afvinken: 1× per dag (enkel vandaag), telt de base erbij op → geeft de nieuwe base terug
create or replace function fn_loods_missie(p_datum date, p_type text, p_discord_id text, p_door text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_bij integer; v_base integer;
begin
  if p_datum <> (now() at time zone 'Europe/Brussels')::date then raise exception 'ANDERE_DAG'; end if;
  v_bij := case p_type when 'handelaar' then 600 when 'skylift' then 400 when 'terrorbite' then 0 end;
  if v_bij is null then raise exception 'ONBEKENDE_MISSIE'; end if;
  insert into loods_missies (datum, type, discord_id, door, base_erbij)
    values (p_datum, p_type, p_discord_id, left(p_door, 80), v_bij)
    on conflict do nothing;
  if not found then raise exception 'AL_GEDAAN'; end if;
  update loods_voorraad set base = base + v_bij, updated_at = now(), updated_by = left(p_door, 80)
    where id returning base into v_base;
  return v_base;
end $$;

-- base resetten naar 0 (de code wordt in de Edge Function gecontroleerd, niet hier)
create or replace function fn_loods_reset(p_door text)
returns integer language plpgsql security definer set search_path = public as $$
begin
  update loods_voorraad set base = 0, updated_at = now(), updated_by = left(p_door, 80) where id;
  return 0;
end $$;

revoke execute on function fn_loods_missie(date, text, text, text) from public, anon, authenticated;
revoke execute on function fn_loods_reset(text) from public, anon, authenticated;
grant execute on function fn_loods_missie(date, text, text, text) to service_role;
grant execute on function fn_loods_reset(text) to service_role;
