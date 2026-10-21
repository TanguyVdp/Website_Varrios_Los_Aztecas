-- ============================================================
-- Varrios portaal v2 — update: ondertekening van mededelingen met rang + naam
-- 1. notice_discord.sig: de bot onthoudt wat er in het Discord-bericht staat; wijzigt de mededeling,
--    dan werkt de bot het bericht in Discord bij.
-- 2. Bestaande mededelingen "Boss (naam)" → "<rang> naam" (rang uit de Ledenlijst), bv. "Kapitein Bob V.".
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
alter table notice_discord add column if not exists sig text;

update notices n
   set door = coalesce(case u.rank
       when 'oprichter' then 'Oprichter' when 'kolonel' then 'Kolonel' when 'generaal' then 'Generaal'
       when 'adviseur' then 'Adviseur' when 'kapitein' then 'Kapitein' when 'strateeg' then 'Strateeg'
       when 'coordinator' then 'Coördinator' when 'veteraan' then 'Veteraan' when 'broeder' then 'Broeder'
       when 'lid' then 'Lid' when 'koerier' then 'Koerier' end || ' ', '') || u.name
  from users u
 where n.door = 'Boss (' || u.name || ')'
returning n.titel, n.door;
