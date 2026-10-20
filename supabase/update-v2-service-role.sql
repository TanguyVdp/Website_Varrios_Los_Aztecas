-- ============================================================
-- Varrios portaal v2 — update: rechten voor de service role (Discord-bot)
--
-- De agenda-bot (GitHub) en de Edge Function "discord-agenda" gebruiken de service role.
-- De tabellen die via de SQL Editor gemaakt werden, gaven die rol geen rechten
-- ("permission denied for table absences"). Dit geeft de service role dezelfde rechten
-- als Supabase standaard geeft — ook voor tabellen en functies die later nog bijkomen.
--
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
-- ============================================================

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
