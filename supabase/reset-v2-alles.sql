-- ============================================================
-- Varrios portaal v2 — VOLLEDIGE DATA RESET (enkel de leden blijven)
--
-- LET OP — DIT KAN NIET ONGEDAAN GEMAAKT WORDEN. Dit wordt gewist:
--   Wiet loods:   logboek, klanten + geschiedenis, ieders Ingelegd / Opgehaald / Legacy → 0
--                 (ook zakjes die nog niet opgehaald waren), wachtrij-kalibratie / pauze / correctie → 0
--   Opslag loods: alle missies
--   Gangpot:      alle items (Base blijft bestaan met 0), het logboek en alle wekelijkse bijdragen
--   Agenda:       alle activiteiten + aanmeldingen
--   Lobby:        alle mededelingen
--   Afwezigheid:  alle meldingen
--   Amfi loods:   alle tickets + chats (ticketnummers beginnen terug bij #001)
--
-- Blijft WEL staan:
--   - alle leden: naam, code, foto, volgorde, Discord-ID, rang, toegang, amfi-medewerker
--   - bosscode, opslag-code, gangpot-code
--   - instellingen: wachtrij-snelheid, amfi-recept en prijzen, onderhoudsscherm aan/uit
--
-- Supabase SQL Editor > New query > plak > Run.
-- ============================================================

begin;

-- Wiet loods
delete from customer_log;
delete from customers;
delete from loods_log;
update users set total_ingelegd = 0, opgehaald = 0, legacy_zakjes = 0;
update loods_baseline set
  offset_minutes = 0, paused = false, paused_at = null, ratio_cutover_at = null,
  zakjes_correctie = 0, set_by = null, set_at = now()
where id = true;

-- Opslag loods
delete from missions;

-- Gangpot
delete from gangpot_log;
delete from gangpot_payments;
delete from gangpot_items where lower(naam) <> 'base';
update gangpot_items set aantal = 0, sort_order = 0 where lower(naam) = 'base';

-- Agenda + mededelingen
delete from event_rsvps;
delete from events;
delete from notices;

-- Afwezigheid
delete from absences;

-- Amfi loods
delete from amfi_messages;
delete from amfi_tickets;
update portal_settings set ticket_seq = 0 where id = true;

commit;
