-- ============================================================
-- Wietloods — update: bosscode + gangpot-pincode (code hier weggehaald — vul zelf in, en zet ze nooit in dit bestand)
--
-- Zet de bosscode (voor het Boss menu) EN de persoonlijke inlogcode van
-- het profiel "gangpot" allebei op XXXX — zelfde code, dus makkelijk te
-- onthouden voor wie gangpot beheert.
--
-- Later een ANDERE code? Gewoon dit bestand opnieuw draaien met 'XXXX'
-- overal vervangen door de nieuwe code.
--
-- Voer dit EENMALIG uit in de Supabase SQL Editor (New query > plak > Run).
-- Vereist dat het profiel "gangpot" bestaat — voer dus eerst (of in
-- dezelfde sessie, volgorde maakt niet uit) update-gangpot-afroming.sql
-- uit; voor de zekerheid wordt het hier ook defensief aangemaakt als het
-- nog niet bestaat.
-- ============================================================

insert into users (name, sort_order)
select 'gangpot', coalesce((select max(sort_order) from users), 0) + 1
where not exists (select 1 from users where lower(name) = 'gangpot');

update admin_config set boss_pin_hash = encode(digest('XXXX', 'sha256'), 'hex') where id = true;

update users set pin_hash = encode(digest('XXXX', 'sha256'), 'hex') where lower(name) = 'gangpot';
