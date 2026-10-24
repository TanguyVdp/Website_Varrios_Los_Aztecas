-- ============================================================
-- Varrios portaal v2 — update: "geplaatst door" bij de agenda = rang + naam (zoals bij mededelingen)
-- Bestaande activiteiten "Boss (naam)" → "<rang> naam" (rang uit de Ledenlijst), bv. "Generaal Jeffry T.".
-- De agenda-bot past de berichten in Discord daarna vanzelf aan.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
update events e
   set door = coalesce(case u.rank
       when 'oprichter' then 'Oprichter' when 'kolonel' then 'Kolonel' when 'generaal' then 'Generaal'
       when 'adviseur' then 'Adviseur' when 'kapitein' then 'Kapitein' when 'strateeg' then 'Strateeg'
       when 'coordinator' then 'Coördinator' when 'veteraan' then 'Veteraan' when 'broeder' then 'Broeder'
       when 'lid' then 'Lid' when 'koerier' then 'Koerier' end || ' ', '') || u.name
  from users u
 where e.door = 'Boss (' || u.name || ')'
returning e.titel, e.datum, e.door;
