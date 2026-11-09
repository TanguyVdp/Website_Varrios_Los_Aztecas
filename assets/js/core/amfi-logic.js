/* ============================================================
 * Amfi loods — pure rekenlogica (geen DOM, geen opslag).
 * Vaste ruil per ticket (altijd exact), in twee niveaus volgens rang (App.AMFI.NIVEAUS): de klant levert amfetamine +
 * coke bladeren + lidocaïne + wit geld aan en krijgt mythische terug; de loods houdt de rest van de mythische + het
 * wit geld. Daarna een cooldown per klant.
 * Alles staat in App.AMFI.DEFAULT (ruil, ruil_groot) en is aanpasbaar door de Boss (Boss menu → Amfi loods);
 * de database (_amfi_ruil in supabase/update-v2-amfi-ruil.sql) gebruikt dezelfde standaardwaarden.
 * De winkels met prijzen dienen voor de inkoopregistratie: enkel winkels met `inkoop: true` zijn toegelaten.
 * ============================================================ */
(function (App) {
  const A = {};
  const r2 = n => Math.round(n * 100) / 100;

  A.BOT = 'Varrios bot';
  A.DEFAULT = {
    ruil: {
      amfetamine: 50,          // exact zoveel per ticket (niet meer, niet minder)
      coke_bladeren: 150,      // brengt de klant mee
      lidocaine: 100,          // brengt de klant mee
      wit_geld: 50000,         // money — gaat naar de loods
      zwart_geld: 0,           // black_money (0 = niet vragen)
      mythisch_klant: 47,      // krijgt de klant terug
      mythisch_loods: 3,       // houdt de loods
      cooldown_uur: 48         // na het afronden van je ticket (geldt voor beide niveaus)
    },
    ruil_groot: {              // zelfde velden, vanaf Veteraan
      amfetamine: 75, coke_bladeren: 225, lidocaine: 150, wit_geld: 75000, zwart_geld: 0, mythisch_klant: 72, mythisch_loods: 3
    },
    winkels: [
      { naam: 'Groothandel', info: null, inkoop: true, producten: [
        { naam: 'Energy drink', prijs: 5,  zwart: false },
        { naam: 'Zout',         prijs: 5,  zwart: false },
        { naam: 'Bloem',        prijs: 5,  zwart: false },
        { naam: 'IJsblokjes',   prijs: 5,  zwart: false }] },
      { naam: 'Apotheek', info: null, inkoop: true, producten: [
        { naam: 'Lactose',      prijs: 30, zwart: false },
        { naam: 'Baking soda',  prijs: 25, zwart: false },
        { naam: 'Mannitol',     prijs: 80, zwart: false }] },
      { naam: 'Standaard winkel', info: null, inkoop: true, producten: [
        { naam: 'Wasbenzine',   prijs: 45, zwart: false },
        { naam: 'Koffiefilters', prijs: 10, zwart: false }] },
      { naam: 'Lidocaïne-locatie', info: 'Postcode 9141 — de NPC aan de achterkant verkoopt het', inkoop: false, producten: [
        { naam: 'Lidocaïne',    prijs: 2500, zwart: true }] },
      { naam: 'Cayo eiland', info: null, inkoop: false, producten: [
        { naam: 'Coke bladeren', prijs: null, zwart: false }] }
    ]
  };
  // de twee ruilen: wie minstens minRank is (App.RANKS staat van hoog naar laag) mag ze kiezen
  A.NIVEAUS = [
    { key: 'ruil',       label: 'Vanaf Broeder',  minRank: 'broeder' },
    { key: 'ruil_groot', label: 'Vanaf Veteraan', minRank: 'veteraan' }
  ];
  const rankOk = (rank, min) => {
    const i = App.RANKS.findIndex(r => r.id === rank);
    return i >= 0 && i <= App.RANKS.findIndex(r => r.id === min);
  };
  // welke ruilen iemand mag kiezen (eigenaar en gangpot: allebei) — de database controleert dit ook
  A.niveausVoor = u => A.NIVEAUS.filter(n => !!u && (u.owner || App.L.isGangpot(u) || rankOk(u.rank, n.minRank)));

  // winkels die standaard toegelaten zijn voor de inkoop (voor instellingen van vóór het vinkje)
  const INKOOP_STD = ['groothandel', 'apotheek', 'standaard winkel'];

  // instellingen aanvullen met de standaardwaarden (oudere instellingen hebben nog geen ruil / inkoop-vinkje)
  A.settings = s => {
    s = s || {};
    return {
      ...s,
      ruil: { ...A.DEFAULT.ruil, ...(s.ruil || {}) },
      ruil_groot: { ...A.DEFAULT.ruil_groot, ...(s.ruil_groot || {}) },
      winkels: (s.winkels || A.DEFAULT.winkels).map(w => ({ ...w,
        inkoop: w.inkoop === undefined ? INKOOP_STD.includes(String(w.naam || '').trim().toLowerCase()) : !!w.inkoop }))
    };
  };

  // instellingen uit het Boss menu controleren en opkuisen (gooit 'ONGELDIGE_RUIL' / 'ONGELDIGE_PRIJZEN')
  A.cleanSettings = ({ ruil, ruil_groot, winkels }) => {
    const clean = (key, src) => Object.fromEntries(Object.keys(A.DEFAULT[key]).map(k => {
      const v = Number(src && src[k]);
      if (!Number.isInteger(v) || v < 0) throw new Error('ONGELDIGE_RUIL');
      return [k, v];
    }));
    const r = clean('ruil', ruil), g = clean('ruil_groot', ruil_groot);
    // het aantal amfetamine bepaalt welke ruil een ticket is, dus dat moet verschillen
    if (r.amfetamine <= 0 || g.amfetamine <= 0 || r.amfetamine === g.amfetamine) throw new Error('ONGELDIGE_RUIL');
    const ws = (winkels || []).map(w => ({ naam: String(w.naam || '').trim().slice(0, 40), info: String(w.info || '').trim().slice(0, 120) || null, inkoop: !!w.inkoop,
      producten: (w.producten || []).map(p => ({ naam: String(p.naam || '').trim().slice(0, 40), prijs: p.prijs === '' || p.prijs == null ? null : Number(p.prijs), zwart: !!p.zwart })) }));
    if (ws.some(w => !w.naam || w.producten.some(p => !p.naam || (p.prijs != null && (!Number.isFinite(p.prijs) || p.prijs < 0))))) throw new Error('ONGELDIGE_PRIJZEN');
    return { ruil: r, ruil_groot: g, winkels: ws };
  };

  // producten die als inkoop geregistreerd mogen worden: uit toegelaten winkels en met een prijs
  A.inkoopProducten = s => A.settings(s).winkels.filter(w => w.inkoop)
    .flatMap(w => (w.producten || []).filter(p => p.naam && p.prijs != null && p.prijs !== '')
      .map(p => ({ winkel: w.naam, naam: p.naam, prijs: Number(p.prijs), zwart: !!p.zwart })));
  A.findInkoopProduct = (s, naam) => A.inkoopProducten(s)
    .find(p => p.naam.trim().toLowerCase() === String(naam || '').trim().toLowerCase()) || null;

  A.LEVERING = {
    ruil: { label: 'Ruil',            short: 'ruil',      icon: 'swap', tone: 'sky' },
    // oud model (tickets van vóór de ruil blijven leesbaar)
    zelf: { label: 'Zelf aanleveren', short: 'zelf',      icon: 'box',  tone: 'sky' },
    wij:  { label: 'Wij kopen aan',   short: 'wij kopen', icon: 'euro', tone: 'gold' }
  };
  A.STATUS = {
    wachtrij:    { label: 'In wachtrij',  tone: 'sky',   icon: 'clock' },
    bezig:       { label: 'In behandeling', tone: 'warn', icon: 'message' },
    klaar:       { label: 'Afgerond',     tone: 'lime',  icon: 'check' },
    geannuleerd: { label: 'Geannuleerd',  tone: 'muted', icon: 'x' }
  };
  A.OPEN = s => s === 'wachtrij' || s === 'bezig';

  // offerte voor een ticket — bij het aanmaken bevroren in het ticket (in supabase-modus maakt de database ze)
  A.quote = (s, niveau = 'ruil') => {
    const st = A.settings(s), r = st[niveau] || st.ruil;
    return { type: 'ruil', keer: r.amfetamine, levering: 'ruil', ...r, cooldown_uur: st.ruil.cooldown_uur };
  };
  A.isRuil = t => !!(t && t.quote && t.quote.type === 'ruil');
  // korte samenvatting: wat er binnenkomt en wat de klant terugkrijgt (oude tickets: X amfetamine → X poeders)
  A.summary = t => A.isRuil(t)
    ? { in: t.quote.amfetamine, out: t.quote.mythisch_klant, label: 'mythische' }
    : { in: t.quote.input, out: t.quote.output, label: A.plural(t.quote.output, t.quote.output_label || 'mythische poeder') };

  // cooldown na het afronden van je laatste ticket: het moment waarop je weer een ticket mag maken, of null
  A.cooldownUntil = (tickets, userId, s, now = Date.now()) => {
    const last = tickets.filter(t => t.user_id === userId && t.status === 'klaar' && t.afgerond_at)
      .reduce((m, t) => Math.max(m, new Date(t.afgerond_at).getTime()), 0);
    if (!last) return null;
    const until = last + A.settings(s).ruil.cooldown_uur * 3600000;
    return until > now ? new Date(until) : null;
  };

  // plaats in de wachtrij (1 = eerstvolgende), 0 als het ticket niet (meer) in de wachtrij staat
  A.position = (tickets, t) => {
    const q = tickets.filter(x => x.status === 'wachtrij').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return q.findIndex(x => x.id === t.id) + 1;
  };

  // nieuwe berichten voor iemand: alles van anderen (ook de bot) na het laatste moment dat hij het ticket bekeek
  A.unread = (t, userId) => {
    const since = new Date((t.read && t.read[userId]) || t.created_at);
    return t.messages.filter(m => m.user_id !== userId && new Date(m.ts) > since).length;
  };
  // relevante tickets: je eigen + de tickets die jij als medewerker behandelt (enkel open tickets)
  A.mine = (tickets, userId) => tickets.filter(t => A.OPEN(t.status) && (t.user_id === userId || t.medewerker_id === userId));
  A.unreadFor = (tickets, userId) => A.mine(tickets, userId).reduce((n, t) => n + A.unread(t, userId), 0);

  // ---------- boss-overzicht ----------
  // inkoop: open = nog niet uitbetaald (telt mee in kosten en voorraad); na "uitbetaald" begint alles opnieuw vanaf 0
  A.open = inkoop => (inkoop || []).filter(i => !i.uitbetaald_at);
  A.paid = inkoop => (inkoop || []).filter(i => i.uitbetaald_at);
  // per medewerker: geholpen (afgeronde tickets), wat de ruil opbracht en wat hij/zij voor de loods kocht
  A.overzicht = (tickets, inkoop) => {
    const per = new Map();
    const row = (id, naam) => {
      const k = id || 'naam:' + naam;
      if (!per.has(k)) per.set(k, { user_id: id || null, naam, geholpen: 0, wit_geld: 0, zwart_geld: 0, mythisch_loods: 0, amfetamine: 0, kost: 0, kost_zwart: 0 });
      return per.get(k);
    };
    const tot = { geholpen: 0, wit_geld: 0, zwart_geld: 0, mythisch_loods: 0, mythisch_klant: 0, amfetamine: 0, kost: 0, kost_zwart: 0 };
    tickets.filter(t => t.status === 'klaar').forEach(t => {
      const r = row(t.afgerond_door_id || t.medewerker_id, t.afgerond_door_naam || t.medewerker_naam || 'onbekend');
      r.geholpen++; tot.geholpen++;
      ['wit_geld', 'zwart_geld', 'mythisch_loods', 'amfetamine'].forEach(k => { const v = Number(t[k] || 0); r[k] += v; tot[k] += v; });
      tot.mythisch_klant += Number(t.mythisch_klant || 0);
    });
    A.open(inkoop).forEach(i => {
      const r = row(i.user_id, i.user_name), v = Number(i.totaal || 0);
      if (i.zwart) { r.kost_zwart = r2(r.kost_zwart + v); tot.kost_zwart = r2(tot.kost_zwart + v); }
      else { r.kost = r2(r.kost + v); tot.kost = r2(tot.kost + v); }
    });
    return { rows: [...per.values()].sort((a, b) => b.geholpen - a.geholpen || (b.kost + b.kost_zwart) - (a.kost + a.kost_zwart)), tot };
  };
  // voorraad die in de loods gelegd is: totaal per product
  A.voorraad = inkoop => {
    const m = new Map();
    A.open(inkoop).forEach(i => {
      const k = i.product.toLowerCase();
      const r = m.get(k) || { product: i.product, winkel: i.winkel, aantal: 0, totaal: 0 };
      r.aantal += Number(i.aantal || 0); r.totaal = r2(r.totaal + Number(i.totaal || 0));
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => a.winkel.localeCompare(b.winkel) || a.product.localeCompare(b.product));
  };

  const num = n => Number(n || 0).toLocaleString('nl-BE');
  const eur = n => '€ ' + Number(n || 0).toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  A.eur = eur;
  A.plural = (n, label) => n === 1 ? label : label.replace(/poeder$/, 'poeders');

  // eerste bericht van de bot in een nieuw ticket
  A.intro = (t, pos) => {
    const q = t.quote;
    return [
      `Hey ${t.user_name}! Ticket #${String(t.nr).padStart(3, '0')} staat in de wachtrij — je bent nummer ${pos}.`,
      '', 'Breng dit mee naar de loods:',
      `• ${num(q.amfetamine)} amfetamine`,
      ...(q.coke_bladeren ? [`• ${num(q.coke_bladeren)} coke bladeren`] : []),   // oude tickets hebben dit niet
      ...(q.lidocaine ? [`• ${num(q.lidocaine)} lidocaïne`] : []),
      `• ${eur(q.wit_geld)} wit geld`,
      ...(q.zwart_geld ? [`• ${eur(q.zwart_geld)} zwart geld`] : []),
      '', `Je krijgt ${num(q.mythisch_klant)} mythische terug.`,
      '', 'Een medewerker neemt zo snel mogelijk contact met je op in dit ticket.'
    ].join('\n');
  };

  App.AMFI = A;
})(window.App);
