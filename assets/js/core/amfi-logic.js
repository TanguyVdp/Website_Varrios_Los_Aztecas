/* ============================================================
 * Amfi loods — pure rekenlogica (geen DOM, geen opslag).
 * 1 keer = 1 amfetamine + de ingrediënten  →  1 mythische poeder (waarde € 20.000).
 * - "zelf":  het lid koopt alle ingrediënten zelf → krijgt de boodschappenlijst (× aantal), per winkel.
 * - "wij":   wij kopen alles aan → het lid betaalt een vaste prijs per poeder (standaard € 7.000).
 * Alles hieronder is aanpasbaar door de Boss (Boss menu → Amfi loods); dit zijn enkel de startwaarden.
 * ============================================================ */
(function (App) {
  const A = {};
  const r2 = n => Math.round(n * 100) / 100;

  A.BOT = 'Varrios bot';
  A.MAX_KEER = 100;                     // max amfetamine per ticket (ook in fn_amfi_create_ticket + App.ERR.TE_VEEL_KEER)
  A.DEFAULT = {
    input_label: 'amfetamine',          // wat het lid binnenbrengt
    input_per_keer: 1,
    output_label: 'mythische poeder',   // wat eruit komt (1 per keer)
    output_waarde: 20000,               // waarde van 1 poeder (enkel ter info)
    prijs_wij_per_keer: 7000,           // wat wij vragen per poeder als wij de ingrediënten aankopen
    winkels: [
      { naam: 'Groothandel', info: null, producten: [
        { naam: 'Energy drink', aantal_per_keer: 3, prijs: 5,  zwart: false },
        { naam: 'Zout',         aantal_per_keer: 5, prijs: 5,  zwart: false },
        { naam: 'Bloem',        aantal_per_keer: 5, prijs: 5,  zwart: false },
        { naam: 'IJsblokjes',   aantal_per_keer: 5, prijs: 5,  zwart: false }] },
      { naam: 'Apotheek', info: null, producten: [
        { naam: 'Lactose',      aantal_per_keer: 5, prijs: 30, zwart: false },
        { naam: 'Baking soda',  aantal_per_keer: 5, prijs: 25, zwart: false },
        { naam: 'Mannitol',     aantal_per_keer: 3, prijs: 80, zwart: false }] },
      { naam: 'Standaard winkel', info: null, producten: [
        { naam: 'Wasbenzine',   aantal_per_keer: 6, prijs: 45, zwart: false },
        { naam: 'Koffiefilters', aantal_per_keer: 5, prijs: 10, zwart: false }] },
      { naam: 'Lidocaïne-locatie', info: 'Postcode 9141 — de NPC aan de achterkant verkoopt het', producten: [
        { naam: 'Lidocaïne',    aantal_per_keer: 2, prijs: 2500, zwart: true }] },
      { naam: 'Cayo eiland', info: null, producten: [
        { naam: 'Coke bladeren', aantal_per_keer: 3, prijs: null, zwart: false }] }
    ]
  };
  A.LEVERING = {
    zelf: { label: 'Zelf aanleveren', short: 'zelf', icon: 'box',  tone: 'sky' },
    wij:  { label: 'Wij kopen aan',   short: 'wij kopen', icon: 'euro', tone: 'gold' }
  };
  A.STATUS = {
    wachtrij:    { label: 'In wachtrij',  tone: 'sky',   icon: 'clock' },
    bezig:       { label: 'In behandeling', tone: 'warn', icon: 'message' },
    klaar:       { label: 'Afgerond',     tone: 'lime',  icon: 'check' },
    geannuleerd: { label: 'Geannuleerd',  tone: 'muted', icon: 'x' }
  };
  A.OPEN = s => s === 'wachtrij' || s === 'bezig';

  // offerte voor een ticket — bij het aanmaken bevroren in het ticket, zodat latere prijswijzigingen niets veranderen
  A.quote = (s, keer, levering) => {
    keer = Number(keer) || 0;
    let wit = 0, zwart = 0;
    const winkels = s.winkels.map(w => ({ naam: w.naam, info: w.info || null, items: w.producten.map(p => {
      const aantal = p.aantal_per_keer * keer;
      const totaal = p.prijs == null ? null : r2(aantal * p.prijs);
      if (totaal != null) { if (p.zwart) zwart += totaal; else wit += totaal; }
      return { naam: p.naam, aantal, prijs: p.prijs, zwart: !!p.zwart, totaal };
    }) })).filter(w => w.items.length);
    return {
      keer, levering,
      input: keer * s.input_per_keer, input_label: s.input_label,
      output: keer, output_label: s.output_label, output_waarde: r2(keer * s.output_waarde),
      winkels, kost_wit: r2(wit), kost_zwart: r2(zwart),
      prijs_per_keer: s.prijs_wij_per_keer,
      te_betalen: levering === 'wij' ? r2(keer * s.prijs_wij_per_keer) : 0
    };
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

  const num = n => Number(n || 0).toLocaleString('nl-BE');
  const eur = n => '€ ' + Number(n || 0).toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  A.eur = eur;
  A.plural = (n, label) => n === 1 ? label : label.replace(/poeder$/, 'poeders');

  // eerste bericht van de bot in een nieuw ticket
  A.intro = (t, pos) => {
    const q = t.quote, L = [];
    L.push(`Hey ${t.user_name}! Ticket #${String(t.nr).padStart(3, '0')} staat in de wachtrij — je bent nummer ${pos}.`);
    L.push(`Bestelling: ${num(q.input)} ${q.input_label} → ${num(q.output)} ${A.plural(q.output, q.output_label)} (waarde ${eur(q.output_waarde)}).`);
    if (q.levering === 'zelf') {
      L.push('', `Jij levert alles zelf aan. Breng ${num(q.input)} ${q.input_label} mee en koop dit:`);
      q.winkels.forEach(w => {
        L.push('', `${w.naam}${w.info ? ` (${w.info})` : ''}:`);
        w.items.forEach(p => L.push(`• ${num(p.aantal)}× ${p.naam}${p.prijs != null ? ` — ${eur(p.prijs)}${p.zwart ? ' zwart' : ''} p.s.` : ''}`));
      });
      L.push('', `Geschatte kost: ${eur(q.kost_wit)}${q.kost_zwart ? ` + ${eur(q.kost_zwart)} zwart geld` : ''}.`);
    } else {
      L.push('', `Wij kopen alle ingrediënten voor jou aan. Breng ${num(q.input)} ${q.input_label} mee.`);
      L.push(`Te betalen: ${num(q.output)} × ${eur(q.prijs_per_keer)} = ${eur(q.te_betalen)}`);
    }
    L.push('', 'Een medewerker neemt zo snel mogelijk contact met je op in dit ticket.');
    return L.join('\n');
  };

  App.AMFI = A;
})(window.App);