-- ============================================================
-- Varrios portaal v2 — update: je eigen naam wijzigen (eigen profiel), of als Boss die van iemand anders (Ledenlijst → Beheren)
-- 2–24 tekens, uniek (hoofdletters tellen niet), niet "gangpot", niet voor het gangpot-profiel.
-- De nieuwe naam komt ook in de aanmeldingen voor de agenda, de afwezigheden en open amfi-tickets;
-- logboeken (wiet loods, chat, inkoop, missies) behouden de naam van toen.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
create or replace function fn_set_name(p_user_id uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 24);
begin
  perform _require_self(p_user_id, true);   -- jezelf, of Boss
  if exists (select 1 from users where id = p_user_id and lower(trim(name)) = 'gangpot') then raise exception 'GANGPOT_NAAM'; end if;
  if length(v_name) < 2 or lower(v_name) = 'gangpot' then raise exception 'ONGELDIGE_NAAM'; end if;
  if exists (select 1 from users where lower(trim(name)) = lower(v_name) and id <> p_user_id) then raise exception 'NAAM_BESTAAT_AL'; end if;
  update users set name = v_name where id = p_user_id;
  if not found then raise exception 'GEBRUIKER_NIET_GEVONDEN'; end if;
  update event_rsvps set user_name = v_name where user_id = p_user_id;
  update absences set user_name = v_name where user_id = p_user_id;
  update amfi_tickets set user_name = v_name where user_id = p_user_id and status in ('wachtrij', 'bezig');
  return v_name;
end; $$;
revoke execute on function fn_set_name(uuid, text) from public, anon;
grant execute on function fn_set_name(uuid, text) to authenticated, service_role;

-- de oude Boss-versie (enkel op de demo-tak gebruikt) is niet meer nodig
drop function if exists fn_boss_set_name(uuid, text, text);
