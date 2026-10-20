# Wietloods — setup & hosting

Zelfstandige webapp (geen build-stap, geen framework) met een gedeelde
Supabase-database. Iedereen opent gewoon de link, geen Claude-account nodig.

- `index.html` — de volledige app (HTML + CSS + JS in één bestand, zelfde stijl als het origineel)
- `supabase/schema.sql` — database-tabellen + functies, eenmalig uit te voeren
- `supabase/update-boss-menu.sql` — extra update: bosscode + Boss menu (na schema.sql uitvoeren)
- `supabase/update-delete-profile.sql` — extra update: profiel verwijderen vanuit Boss menu (na update-boss-menu.sql)

## 1. Supabase-project aanmaken (database)

1. Ga naar [supabase.com](https://supabase.com) → maak gratis account → **New project**.
2. Kies een naam (bv. `loods25`) en een database-wachtwoord (bewaar dit ergens veilig, je hebt het verder niet nodig voor deze app).
3. Wacht tot het project klaar is (~1 min).
4. Ga naar **SQL Editor** (linkermenu) → **New query**.
5. Plak de volledige inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik **Run**.
   - Dit maakt de tabellen, de beveiligingsregels en de 4 startprofielen (siebe, ivar, bob, matis) aan.
6. Ga naar **Project Settings** (tandwiel) → **API**.
   - Kopieer de **Project URL** (bv. `https://xxxxx.supabase.co`)
   - Kopieer de **anon public** key (lange string onder "Project API keys")
   - Gebruik **niet** de `service_role` key — die is geheim en hoort nooit in de website.

## 2. Config invullen

Open `index.html`, zoek bovenaan in het `<script>`-blok:

```js
const SUPABASE_URL = "PLAK_HIER_JE_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "PLAK_HIER_JE_SUPABASE_ANON_KEY";
```

en vul je eigen URL en anon key in. Dat is de enige aanpassing die nodig is.

## 3. Naar GitHub, live via GitHub Pages

1. Maak een nieuwe (lege) repository aan op GitHub, bv. `loods25`.
2. Push deze map (`loods25-web/`) als de **root** van die repo:
   ```
   cd "loods25-web"
   git init
   git add .
   git commit -m "Loods 25 webapp"
   git branch -M main
   git remote add origin https://github.com/<jouw-gebruikersnaam>/loods25.git
   git push -u origin main
   ```
3. Ga op GitHub naar **Settings → Pages**.
4. Bij **Build and deployment** → **Source**: kies **Deploy from a branch**.
5. Bij **Branch**: kies `main` en map `/ (root)` → **Save**.
6. Na ~1 minuut staat de site live op:
   `https://<jouw-gebruikersnaam>.github.io/loods25/`

Elke keer dat je een wijziging pusht naar `main`, update GitHub Pages de site
automatisch binnen een minuut.

## Hoe het werkt (kort)

- **Geen backend-server nodig**: de browser praat rechtstreeks met Supabase
  via de `anon` key. Dat is veilig omdat alle schrijfacties (inleg, ophalen,
  klant aanmaken, levering registreren, profiel claimen) alleen via
  vastgelegde database-functies mogen — niemand kan via de browserconsole
  tegoeden vervalsen.
- **Pincodes** worden nooit onversleuteld opgeslagen; de browser hasht ze
  (SHA-256) voor ze naar de database gaan.
- **Live sync**: de app luistert via Supabase Realtime naar wijzigingen, dus
  als iemand anders iets inlegt of ophaalt, zie jij dat binnen een paar
  seconden verschijnen zonder te moeten herladen.
- **Gratis**: Supabase's gratis tier (500MB database, ruim genoeg voor dit
  gebruik) + GitHub Pages (gratis statische hosting) kosten niets voor een
  groep van 25 mensen. Let op: een gratis Supabase-project pauzeert na 7
  dagen zonder verkeer — gewoon de site openen maakt hem weer wakker (kan
  de allereerste keer na een lange stilte een paar seconden duren).

## Boss menu

Naast "live gedeeld" bovenaan staat een knop **Boss menu**, vergrendeld met
een eigen bosscode (los van ieders persoonlijke profielcode). Wie de code
kent ziet een overzicht per persoon (ingelegd/opgehaald/geleverd aan
klanten) en het volledige logboek van alle 25 profielen samen, filterbaar
op persoon.

Stel de bosscode in via `supabase/update-boss-menu.sql` (regel met
`encode(digest('XXXX', 'sha256'), ...)` — vervang `'XXXX'` door je eigen
code) en voer dat bestand eenmalig uit in de SQL Editor, na `schema.sql`.
Je kan de code later wijzigen door diezelfde regel opnieuw uit te voeren
met een nieuwe waarde.

In het Boss menu kun je ook profielen verwijderen (bv. iemand die stopt).
Dat vereist `supabase/update-delete-profile.sql` — eenmalig uitvoeren, na
`update-boss-menu.sql`. Verwijderen controleert je bosscode ook aan de
database-kant, dus dat kan niemand omzeilen via de browserconsole. Het
logboek van die persoon blijft gewoon bewaard (met naam); enkel het
inlogprofiel verdwijnt, dus die naam wordt weer vrij om opnieuw te claimen.

## Lokaal testen (optioneel)

`index.html` rechtstreeks openen via `file://` werkt niet volledig omdat
pincode-hashing (`crypto.subtle`) een "secure context" vereist. Start
in plaats daarvan een simpel lokaal servertje in deze map, bv.:

```
npx serve .
```

en open de getoonde `http://localhost:...` link.
