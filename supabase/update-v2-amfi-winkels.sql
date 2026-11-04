-- ============================================================
-- Varrios portaal v2 — fix: amfi-winkels in de database zetten
-- portal_settings.amfi had nog geen 'winkels' (de prijzen waren nooit opgeslagen; de site gebruikte de
-- standaardlijst uit de browser). Daardoor vond fn_amfi_add_inkoop geen enkel product → "Dat product mag niet".
-- Dit zet de standaardwinkels (zelfde als App.AMFI.DEFAULT.winkels in core/amfi-logic.js) in de database,
-- enkel als er nog geen winkels staan. De ruil-instellingen blijven zoals ze zijn.
-- Voer dit uit in de Supabase SQL Editor (New query > plak > Run). Opnieuw uitvoeren kan geen kwaad.
-- ============================================================
update portal_settings set amfi = coalesce(amfi, '{}'::jsonb) || jsonb_build_object('winkels', '[
  {"naam": "Groothandel", "info": null, "inkoop": true, "producten": [
    {"naam": "Energy drink", "prijs": 5, "zwart": false},
    {"naam": "Zout", "prijs": 5, "zwart": false},
    {"naam": "Bloem", "prijs": 5, "zwart": false},
    {"naam": "IJsblokjes", "prijs": 5, "zwart": false}]},
  {"naam": "Apotheek", "info": null, "inkoop": true, "producten": [
    {"naam": "Lactose", "prijs": 30, "zwart": false},
    {"naam": "Baking soda", "prijs": 25, "zwart": false},
    {"naam": "Mannitol", "prijs": 80, "zwart": false}]},
  {"naam": "Standaard winkel", "info": null, "inkoop": true, "producten": [
    {"naam": "Wasbenzine", "prijs": 45, "zwart": false},
    {"naam": "Koffiefilters", "prijs": 10, "zwart": false}]},
  {"naam": "Lidocaïne-locatie", "info": "Postcode 9141 — de NPC aan de achterkant verkoopt het", "inkoop": false, "producten": [
    {"naam": "Lidocaïne", "prijs": 2500, "zwart": true}]},
  {"naam": "Cayo eiland", "info": null, "inkoop": false, "producten": [
    {"naam": "Coke bladeren", "prijs": null, "zwart": false}]}
]'::jsonb)
where id = true and jsonb_typeof(coalesce(amfi, '{}'::jsonb) -> 'winkels') is distinct from 'array';

-- controle: dit moet de 5 winkels tonen
select jsonb_array_length(amfi -> 'winkels') as winkels, amfi -> 'ruil' as ruil from portal_settings where id = true;
