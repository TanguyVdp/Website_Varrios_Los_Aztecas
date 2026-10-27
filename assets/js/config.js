/* ============================================================
 * Varrios portaal — centrale configuratie
 * Alle bedrijfsregels staan hier op één plek (in de oude app zaten ze
 * verspreid over index.html én de SQL-functies).
 * ============================================================ */
window.App = window.App || {};
App.views = {};

App.CONFIG = {
  // 'demo'     = nepdata in de browser (localStorage), raakt NOOIT de echte database
  // 'supabase' = de echte gedeelde database (zelfde Supabase-project als de oude Wietloods-site)
  //              ?demo achter de URL forceert de demo-modus; lokaal (Go Live, localhost, dubbelklik) is het altijd demo,
  //              behalve met ?live (inloggen met Discord werkt lokaal toch niet: die link staat niet in Supabase)
  mode: /[?&]demo\b/.test(location.search) || (/^(localhost|127\.0\.0\.1|)$/.test(location.hostname) && !/[?&]live\b/.test(location.search)) ? 'demo' : 'supabase',
  // publieke sleutel (zoals in de oude app): lezen mag iedereen, schrijven gaat enkel via de RPC-functies
  supabase: { url: 'https://tblkwyrmtccfggtelnsj.supabase.co', anonKey: 'sb_publishable_pqkMMN1YXz8mMd56_92BUQ_jKSQCfWx' },
  // true  = start met voorbeelddata (leden, logboek, tickets …)
  // false = lege testomgeving: geen leden of gegevens, enkel het gangpot-profiel en de instellingen.
  //         Elke stand heeft zijn eigen opslag in de browser, dus terugschakelen brengt de voorbeelddata terug.
  demoData: false
};

App.RULES = {
  RATIO_IN: 2, RATIO_OUT: 1,            // leden: 2 planten -> 1 zakje
  LEGACY_RATIO_IN: 3,                   // oude ratio, voor bevroren legacy_zakjes
  KLANT_RATIO_IN: 4, KLANT_RATIO_OUT: 1,// klanten swappen: 4 -> 1 zakje (meteen mee)
  MAX_MOMENTEEL_INLEG: 6000,            // max planten per persoon tegelijk onverwerkt
  MAX_USERS: 25,
  GANGPOT_NAME: 'gangpot',
  GANGPOT_DEEL: 0,                      // 0 = geen afroming meer: alles gaat naar wie inlegt (was 5 = 1 op 5 naar de gangpot)
  // dagelijkse server-restarts: een batch die dit raakt herbegint erna volledig
  RESTART_WINDOWS: [
    { h: 7,  m: 58, endH: 8,  endM: 3 },
    { h: 11, m: 58, endH: 12, endM: 3 },
    { h: 17, m: 58, endH: 18, endM: 3 }
  ],
  BASELINE_DEFAULT: {
    offset_minutes: 0, batch_size: 5, batch_minutes: 1,
    paused: false, paused_at: null, ratio_cutover_at: null,
    zakjes_correctie: 0, set_by: null
  }
};

// Afdelingen van het gangportaal. Ze verschijnen in de lobby, de sidebar en de tabbalk.
// tone = accentkleur (CSS-variabele), soon = nog in opbouw (krijgt een "binnenkort"-pagina),
// plans = wat de afdeling later moet kunnen (enkel getoond zolang ze in opbouw is).
App.MODULES = [
  { id: 'agenda', name: 'Agenda', icon: 'calendar', tone: 'cyan',
    tagline: 'Wat staat er op de planning',
    desc: 'Vergaderingen, acties, deals en feesten van de familia. De Boss plaatst ze, iedereen ziet ze.',
    routes: [{ path: 'agenda', label: 'Kalender', icon: 'calendar' }] },
  { id: 'gangpot', name: 'Gangpot', icon: 'crown', tone: 'gold',
    tagline: 'De kas van de familia',
    desc: 'Wat er in de gangpot zit: geld, wapens en spullen. Iedereen kan meekijken, aanpassen kan wie de Boss daarvoor aanvinkte.',
    routes: [{ path: 'gangpot', label: 'Inhoud', icon: 'vault' }] },
  // onderhoud: zolang dit ingevuld is, ziet iedereen een "in onderhoud"-pagina met deze uitleg (Boss kan toch binnen kijken)
  { id: 'amfiloods', name: 'Amfi loods', icon: 'flask', tone: 'sky', access: 'amfi',
    onderhoud: 'Wij proberen eerst de loods goed te upgraden, zodat hij al 2 volledige werknemers heeft voordat we mensen laten verwerken.',
    tagline: 'Bestellen via een ticket',
    desc: 'Breng amfetamine binnen voor mythische poeder: koop de ingrediënten zelf, of laat ze aankopen (€ 7.000 per poeder). Via een ticket en de wachtrij.',
    routes: [{ path: 'amfi', label: 'Tickets', icon: 'message' }] },
  { id: 'wietloods', name: 'Wiet loods', icon: 'leaf', tone: 'lime', access: 'wiet',
    tagline: 'Planten in, zakjes uit',
    desc: 'Inleggen, wachtrij volgen, zakjes ophalen en het gedeelde klantenbestand.',
    routes: [
      { path: 'loods',   label: 'Loods',   icon: 'warehouse' },
      { path: 'klanten', label: 'Klanten', icon: 'users' }
    ] },
  { id: 'afwezigheid', name: 'Afwezigheid', icon: 'userx', tone: 'rose',
    tagline: 'Wie is er wanneer niet',
    desc: 'Meld van wanneer tot wanneer je er niet bent, met een reden — zo weet de familia op wie ze kan rekenen.',
    routes: [{ path: 'afwezig', label: 'Overzicht', icon: 'userx' }] },
  // hidden: enkel zichtbaar (lobby, zijbalk) voor wie toegang heeft — staat daarom altijd achteraan
  { id: 'opslag', name: 'Opslag loods', icon: 'box', tone: 'warn', access: 'opslag', hidden: true,
    tagline: 'Dagelijkse missies',
    desc: 'Elke dag de base coke- en terrorbite-missie afvinken, en de voorraad base bijhouden.',
    routes: [{ path: 'opslag', label: 'Missies', icon: 'box' }] }
];
// de afdelingen die iemand te zien krijgt (verborgen afdelingen enkel met toegang)
App.visibleModules = me => App.MODULES.filter(m => !m.hidden || (me && App.hasAccess(me, m.access)));

// Afwezigheid: redenen (tone = kleur in lijst en planning). 'andere' vraagt verplicht een toelichting.
App.ABSENCE = {
  MAX_NOTE: 140,
  REASONS: [
    { id: 'vakantie', label: 'Vakantie',      icon: 'sun',       tone: 'sky' },
    { id: 'werk',     label: 'Werk / school', icon: 'briefcase', tone: 'violet' },
    { id: 'ziek',     label: 'Ziek',          icon: 'thermo',    tone: 'danger' },
    { id: 'familie',  label: 'Familie',       icon: 'heart',     tone: 'rose' },
    { id: 'andere',   label: 'Andere',        icon: 'dots',      tone: 'muted' }
  ]
};

// Afwezigheden worden door de Boss beoordeeld.
App.ABSENCE.STATUS = {
  aangevraagd: { label: 'Te keuren',   tone: 'warn',   icon: 'clock' },
  goedgekeurd: { label: 'Goedgekeurd', tone: 'lime',   icon: 'check' },
  afgekeurd:   { label: 'Afgekeurd',   tone: 'danger', icon: 'x' }
};

// Agenda: soorten activiteiten (tone = kleur in kalender en lijst)
App.AGENDA = {
  TYPES: [
    { id: 'vergadering', label: 'Vergadering', icon: 'users',  tone: 'violet' },
    { id: 'actie',       label: 'Actie',       icon: 'flame',  tone: 'danger' },
    { id: 'deal',        label: 'Deal',        icon: 'swap',   tone: 'lime' },
    { id: 'feest',       label: 'Feest',       icon: 'crown',  tone: 'gold' },
    { id: 'andere',      label: 'Andere',      icon: 'dots',   tone: 'cyan' }
  ]
};

// Toegang per lid — aan te vinken in Boss menu → Ledenlijst. Een afdeling met `access: '<key>'` in App.MODULES
// is enkel open voor leden met dat vinkje. 'amfi' = toegang tot de Amfi loods (tickets maken),
// 'amfi_staff' = amfi-medewerker (= user.amfi_staff, neemt tickets op; geeft automatisch ook toegang).
// 'gangpot' = de gangpot aanpassen (bekijken mag iedereen), 'boss' = Boss menu (geeft ook gangpot + opslag).
// De eigenaar (user.owner, Bob) heeft altijd alles.
App.ACCESS = [
  { key: 'amfi_staff', label: 'Amfi loods',   icon: 'flask',  tone: 'sky', hint: 'medewerker' },
  { key: 'amfi',       label: 'Amfi loods',   icon: 'flask',  tone: 'sky' },
  { key: 'wiet',       label: 'Wiet loods',   icon: 'leaf',   tone: 'lime' },
  { key: 'opslag',     label: 'Opslag loods', icon: 'box',    tone: 'warn' },
  { key: 'gangpot',    label: 'Gangpot',      icon: 'vault',  tone: 'gold', hint: 'aanpassen' },
  { key: 'boss',       label: 'Boss menu',    icon: 'shield', tone: 'violet' }
];
App.ACCESS_DEFAULT = { wiet: true, opslag: false, amfi: false, gangpot: false, boss: false };   // voor nieuwe profielen

// Rangen van Varrios Los Aztecas (volgorde = hoog → laag). lead = leiding (goud gevuld weergegeven).
// icon = naam uit core/icons.js. De Boss kiest per lid een rang in Boss menu → Ledenlijst.
App.RANKS = [
  { id: 'oprichter',   label: 'Oprichter',   icon: 'crown',      lead: true },
  { id: 'kolonel',     label: 'Kolonel',     icon: 'chevrons',   lead: true },
  { id: 'generaal',    label: 'Generaal',    icon: 'starLaurel', lead: true },
  { id: 'adviseur',    label: 'Adviseur',    icon: 'eagle' },
  { id: 'kapitein',    label: 'Kapitein',    icon: 'shieldStar' },
  { id: 'strateeg',    label: 'Strateeg',    icon: 'compass' },
  { id: 'coordinator', label: 'Coördinator', icon: 'gear' },
  { id: 'veteraan',    label: 'Veteraan',    icon: 'headset' },
  { id: 'broeder',     label: 'Broeder',     icon: 'chevronStar' },
  { id: 'lid',         label: 'Lid',         icon: 'chevronStar' },
  { id: 'koerier',     label: 'Koerier',     icon: 'mail' }
];
// oude rang-ids (eerste versie) → nieuwe
App.RANK_MIGRATE = { boss: 'oprichter', underboss: 'kolonel', capo: 'kapitein', veterano: 'veteraan', soldado: 'lid', prospect: 'koerier' };

// Opslag loods: 2 missies per dag. Eén keer afgevinkt = vast (kan niet meer veranderen).
// reward = wat er automatisch in de gangpot komt (item met die naam, wordt aangemaakt als het niet bestaat)
App.MISSIONS = [
  { id: 'basecoke',   label: 'Base coke missie', short: 'Base coke',  icon: 'flask', tone: 'warn',   reward: { item: 'Base', eenheid: 'stuks', amount: 600 } },
  { id: 'terrorbite', label: 'Terrorbite missie', short: 'Terrorbite', icon: 'flame', tone: 'danger', reward: null }
];
App.BASE_ITEM = 'Base';

// Wekelijkse gangpot-bijdrage: te betalen tegen deze weekdag (0 = zondag … 3 = woensdag). De Boss vinkt af wie betaald heeft.
App.GANGPOT_DUE_DAY = 3;

// Agenda: aanmelden per activiteit (op de site of via de knoppen van de Discord-bot).
// Bij 'afwezig' is een reden verplicht: één van App.AGENDA.AFWEZIG (bij 'andere' zelf typen).
// Opgeslagen als tekst: "Werk", "Werk — late shift" of bij andere de getypte tekst.
// ⚠️ Zelfde lijst in de Discord-bot: supabase/functions/discord-agenda/index.ts (REDENEN).
App.AGENDA.RSVP = [
  { id: 'aanwezig',  label: 'Aanwezig',  icon: 'check',   tone: 'lime' },
  { id: 'misschien', label: 'Misschien', icon: 'clock',   tone: 'warn' },
  { id: 'afwezig',   label: 'Afwezig',   icon: 'x',       tone: 'danger' }
];
App.AGENDA.AFWEZIG = [
  { id: 'werk',     label: 'Werk',     icon: 'briefcase', tone: 'violet' },
  { id: 'school',   label: 'School',   icon: 'pencil',    tone: 'sky' },
  { id: 'prive',    label: 'Privé',    icon: 'home',      tone: 'gold' },
  { id: 'ziek',     label: 'Ziek',     icon: 'thermo',    tone: 'danger' },
  { id: 'familie',  label: 'Familie',  icon: 'heart',     tone: 'rose' },
  { id: 'vakantie', label: 'Vakantie', icon: 'sun',       tone: 'cyan' },
  { id: 'andere',   label: 'Andere',   icon: 'dots',      tone: 'muted' }
];

// Mededelingen in de lobby
App.NOTICE = {
  KINDS: [
    { id: 'info',       label: 'Info',       icon: 'megaphone', tone: 'cyan' },
    { id: 'belangrijk', label: 'Belangrijk', icon: 'alert',     tone: 'warn' },
    { id: 'dringend',   label: 'Dringend',   icon: 'flame',     tone: 'danger' }
  ]
};

App.ERR = {
  LOODS_VOL: 'De loods zit vol (25 profielen).',
  ONGELDIGE_NAAM: 'Geef een geldige naam op.',
  NAAM_BESTAAT_AL: 'Die naam bestaat al.',
  ONGELDIGE_CODE: 'Kies een code van minstens 4 tekens.',
  ONJUISTE_CODE: 'Code klopt niet.',
  AL_GECLAIMD: 'Dit profiel is al geclaimd.',
  GEBRUIKER_NIET_GEVONDEN: 'Gebruiker niet gevonden.',
  ONGELDIG_AANTAL: 'Voer een geldig aantal in.',
  ONGELDIGE_PRIJS: 'Voer een geldige prijs in.',
  ONVOLDOENDE_TEGOED: 'Onvoldoende tegoed.',
  NOG_NIET_VERWERKT: 'Die zakjes zijn nog niet verwerkt door de wachtrij.',
  MAX_ONVERWERKT_BEREIKT: 'Je zit aan de limiet van onverwerkte planten — wacht tot er meer verwerkt is.',
  KLANT_BESTAAT_AL: 'Die klant bestaat al.',
  KLANT_NIET_GEVONDEN: 'Klant niet gevonden.',
  ONJUISTE_BOSSCODE: 'Je hebt geen toegang tot het Boss menu.',
  ONGELDIGE_BATCH: 'Voer een geldige snelheid in (groter dan 0).',
  ONGELDIGE_DATUM: 'Kies een geldige periode.',
  EINDE_VOOR_START: 'De einddatum ligt voor de startdatum.',
  DATUM_VERLEDEN: 'Die periode ligt al volledig in het verleden.',
  GEEN_REDEN: 'Kies een reden.',
  TOELICHTING_NODIG: 'Geef bij "Andere" kort een toelichting.',
  AFWEZIG_OVERLAP: 'Je hebt in die periode al een afwezigheid gemeld.',
  AFWEZIGHEID_NIET_GEVONDEN: 'Afwezigheid niet gevonden.',
  GEEN_RECHT: 'Je kan enkel je eigen afwezigheden aanpassen.',
  ONGELDIGE_STATUS: 'Ongeldige beoordeling.',
  REACTIE_NODIG: 'Schrijf een reactie.',
  GEEN_TITEL: 'Geef een titel op.',
  GEEN_TEKST: 'Schrijf een bericht.',
  GEEN_DATUM: 'Kies een datum.',
  ONGELDIG_TYPE: 'Kies een soort.',
  ONGELDIGE_TIJD: 'Geef een geldig uur op (uu:mm).',
  NIET_GEVONDEN: 'Niet (meer) gevonden.',
  ITEM_BESTAAT_AL: 'Dat item staat al in de gangpot.',
  TE_WEINIG_IN_POT: 'Er zit niet genoeg in de gangpot om dat eruit te halen.',
  REDEN_GANGPOT: 'Schrijf erbij wat het is of waarom (minstens 3 tekens) — zo blijft alles na te kijken in de historiek.',
  ONJUISTE_OPSLAGCODE: 'Je hebt geen toegang tot de Opslag loods — vraag de Boss om je aan te vinken.',
  ONJUISTE_GANGPOTCODE: 'Je mag de gangpot niet aanpassen — vraag de Boss om je aan te vinken.',
  GEEN_BOSS: 'Je hebt geen toegang tot het Boss menu.',
  NIET_INGELOGD: 'Je bent niet (meer) ingelogd — log opnieuw in met Discord.',
  EIGENAAR: 'De eigenaar heeft altijd alle rechten: dat kan je niet wijzigen.',
  ONGELDIG_DISCORD_ID: 'Dat is geen geldig Discord-ID (enkel cijfers, 17 à 20 lang).',
  DISCORD_AL_GEBRUIKT: 'Dat Discord-ID is al gekoppeld aan een ander profiel.',
  MISSIE_AL_GEDAAN: 'Deze missie is vandaag al gedaan.',
  ONGELDIGE_MISSIE: 'Onbekende missie.',
  EVENT_VOORBIJ: 'Deze activiteit is al voorbij.',
  REDEN_NODIG: 'Kies een reden waarom je er niet bij bent (bij "Andere": typ ze zelf).',
  GANGPOT_PROFIEL: 'Het gangpot-profiel kan je niet verwijderen.',
  ONGELDIGE_WAARDE: 'Voer overal een geldig getal (0 of meer) in.',
  ONGELDIGE_RANG: 'Kies een geldige rang.',
  ONGELDIGE_VOLGORDE: 'Die volgorde klopt niet — herlaad de pagina.',
  GEEN_TOEGANG: 'Je hebt geen toegang tot deze afdeling.',
  ONJUISTE_HUIDIGE_CODE: 'Je huidige code klopt niet.',
  TE_VEEL_POGINGEN: 'Te veel foute codes na elkaar — probeer het over 15 minuten opnieuw.',
  CODES_VERSCHILLEN: 'De twee nieuwe codes zijn niet hetzelfde.',
  ONGELDIGE_FOTO: 'Kies een geldige afbeelding (jpg, png, webp …).',
  ONGELDIGE_LEVERING: 'Kies of je de mengproducten zelf aanlevert of laat aankopen.',
  AL_OPEN_TICKET: 'Je hebt al een open ticket — wacht tot dat afgerond is.',
  TE_VEEL_KEER: 'Dat is te veel in één ticket (max 100 amfetamine).',
  GEEN_MEDEWERKER: 'Enkel amfi-medewerkers kunnen dit.',
  TICKET_GESLOTEN: 'Dit ticket is gesloten.',
  TICKET_NIET_GEVONDEN: 'Ticket niet gevonden.',
  LEEG_BERICHT: 'Typ eerst een bericht.',
  ONGELDIGE_PRIJZEN: 'Controleer de prijzen: overal een getal van 0 of meer, en elk product een naam.'
};
