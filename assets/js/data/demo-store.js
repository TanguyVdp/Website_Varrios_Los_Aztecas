/* ============================================================
 * Demo-store — nepdata in de browser (localStorage).
 * Heeft BEWUST dezelfde vorm als de toekomstige supabase-store:
 * elke actie hier = één RPC-functie in de database (zie CLAUDE.md).
 * Views praten enkel met App.store, nooit rechtstreeks met data.
 * ============================================================ */
(function (App) {
  if (App.CONFIG.mode !== 'demo') return;
  const R = App.RULES, L = App.L, U = App.U;
  const KEY = App.CONFIG.demoData ? 'varrios-v2-demo-state' : 'varrios-v2-leeg-state';
  const AUTH_KEY = KEY + '-auth';   // wie er in de demo "ingelogd" is
  const subs = new Set();
  let state = null;

  const E = code => new Error(code);
  const iso = ms => new Date(ms).toISOString();
  const gangpotOf = st => st.users.find(L.isGangpot);

  function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

  // ---------- mutaties (spiegelen fn_register_inleg / fn_register_ophalen / ...) ----------
  function applyInleg(st, user, amount, ts) {
    const gp = gangpotOf(st);
    const split = L.splitInleg(user, amount, !!gp);
    const add = (u, amt, t, note) => {
      if (amt <= 0) return;
      const before = L.zakjesVoor(u);
      u.total_ingelegd += amt;
      const after = L.zakjesVoor(u);
      st.log.push({ id: U.uid(), type: 'inleg', user_id: u.id, user_name: u.name, amount: amt,
        cumulative_after: u.total_ingelegd, zakjes_after: after, zakjes_delta: after - before, note: note || null, ts: t });
    };
    add(user, split.self, ts);
    if (gp && split.gangpot > 0) add(gp, split.gangpot, iso(new Date(ts).getTime() + 1), `afroming van ${user.name}`);
    return split;
  }
  function applyOphalen(st, user, amount, ts) {
    user.opgehaald += amount;
    st.log.push({ id: U.uid(), type: 'ophalen', user_id: user.id, user_name: user.name, amount,
      tegoed_after: L.zakjesVoor(user) - user.opgehaald, ts });
  }
  function applySwap(st, k, amount, by, ts) {
    const before = L.zakjesVoorKlant(k.total_geleverd);
    k.total_geleverd += amount;
    const after = L.zakjesVoorKlant(k.total_geleverd);
    st.customerLog.push({ id: U.uid(), customer_id: k.id, kind: 'swap', by_user_id: by.id, by_user_name: by.name, amount,
      cumulative_after: k.total_geleverd, zakjes_after: after, zakjes_delta: after - before, ts });
    k.last_activity = ts;
  }
  function applyVerkoop(st, k, amount, price, by, ts) {
    k.total_verkocht = (k.total_verkocht || 0) + amount;
    const total = Math.round(amount * price * 100) / 100;
    k.total_omzet = Math.round(((k.total_omzet || 0) + total) * 100) / 100;
    st.customerLog.push({ id: U.uid(), customer_id: k.id, kind: 'levering', by_user_id: by.id, by_user_name: by.name, amount,
      price_per_unit: price, total_price: total, cumulative_after: k.total_verkocht, ts });
    k.last_activity = ts;
  }

  // ---------- afwezigheden (demo) ----------
  function seedAbsences(users) {
    const by = n => users.find(u => u.name === n);
    const day = n => U.dkey(U.addDays(new Date(), n));
    return [
      ['siebe', -9, -7, 'andere', 'Pc kapot, nieuwe besteld'],
      ['ivar', -2, 3, 'vakantie', 'Op reis naar Spanje'],
      ['matis', 0, 0, 'ziek', null],
      ['kenzo', 2, 4, 'werk', 'Examens'],
      ['dario', 6, 12, 'vakantie', null],
      ['yusuf', 9, 10, 'familie', 'Trouwfeest van mijn neef'],
      ['bob', 15, 16, 'werk', 'Late shiften']
    ].filter(([n]) => by(n)).map(([n, a, b, reden, toelichting]) => ({
      id: U.uid(), user_id: by(n).id, user_name: n, van: day(a), tot: day(b), reden, toelichting,
      created_at: iso(U.addDays(new Date(), Math.min(a, 0) - 2).getTime()),
      status: REVIEW[n] ? 'goedgekeurd' : 'aangevraagd', reactie: REVIEW[n] || null,
      beoordeeld_door: REVIEW[n] ? 'Boss' : null, beoordeeld_at: REVIEW[n] ? iso(Date.now() - 86400000) : null
    }));
  }
  const REVIEW = { siebe: 'Oké, laat weten als hij er is.', ivar: 'Geniet ervan, hermano!', matis: 'Beterschap!', yusuf: 'Proficiat aan je neef.' };

  // ---------- boss-data (demo): mededelingen, agenda, gangpot ----------
  function seedBoss(st) {
    const day = n => U.dkey(U.addDays(new Date(), n));
    const ago = h => iso(Date.now() - h * 3600000);
    st.notices = [
      { id: U.uid(), titel: 'Vergadering morgen is verplicht', tekst: 'Iedereen om 20u in het clubhuis. Kan je niet? Meld het via Afwezigheid.', soort: 'belangrijk', door: 'Boss', created_at: ago(3) },
      { id: U.uid(), titel: 'Welkom op het nieuwe portaal', tekst: 'Alles van de familia staat nu op één plek: loodsen, gangpot, agenda en afwezigheden.', soort: 'info', door: 'Boss', created_at: ago(30) }
    ];
    st.events = [
      ['Familievergadering', 'vergadering', -3, '20:00', 'Clubhuis Grove Street', 'Terugblik op de week.'],
      ['Wekelijkse familievergadering', 'vergadering', 1, '20:00', 'Clubhuis Grove Street', 'Verplicht voor iedereen. Agenda: nieuwe afdelingen + verdeling gangpot.'],
      ['Levering ophalen', 'actie', 3, '22:30', 'Haven — Elysian Island', 'Met 4 man, 2 wagens. Wapens uit de gangpot meenemen.'],
      ['Verjaardag Ivar', 'feest', 6, '21:00', 'Villa Vinewood Hills', null],
      ['Deal met de Vagos', 'deal', 12, '19:00', 'Parking El Burro Heights', 'Enkel Boss + 2 man.'],
      ['Training schieten', 'andere', 9, '18:00', 'Schietbaan Pillbox Hill', null]
    ].map(([titel, type, d, tijd, plaats, info]) => ({ id: U.uid(), titel, type, datum: day(d), tijd, plaats, info, door: 'Boss', created_at: ago(48) }));
    const items = [['Cash', '€', 245000], ['Zwart geld', '€', 82500], ['Base', 'stuks', 4200], ['Pistolen', 'stuks', 12], ['Munitie', 'dozen', 40], ['Lockpicks', 'stuks', 25], ['Kevlar vesten', 'stuks', 8]]
      .map(([naam, eenheid, aantal], i) => ({ id: U.uid(), naam, eenheid, aantal, sort_order: i }));
    st.gangpot = { items, log: [] };
    const glog = (it, delta, note, h) => st.gangpot.log.push({ id: U.uid(), item_id: it.id, item_naam: it.naam, eenheid: it.eenheid, delta, aantal_after: it.aantal, note, door: 'Boss', ts: ago(h) });
    const it = n => items.find(i => i.naam === n);
    glog(it('Cash'), 50000, 'Opbrengst deal Ballas', 20);
    glog(it('Pistolen'), -2, 'Meegegeven aan Kenzo en Dario', 8);
    glog(it('Zwart geld'), 12500, 'Witwassen via garage', 5);
    glog(it('Munitie'), 10, 'Bijgekocht', 2);
    st.gangpot.log.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  }

  // ---------- opslag loods: missies (demo) ----------
  function seedMissions(st) {
    const r = rng(11);
    const leden = st.users.filter(u => u.pin && !L.isGangpot(u));
    st.settings = st.settings || { opslag_code: App.CONFIG.demoOpslagCode, gangpot_code: App.CONFIG.demoGangpotCode };
    st.missions = [];
    for (let d = 20; d >= 0; d--) {
      App.MISSIONS.forEach((m, mi) => {
        if (d === 0 && mi === 1) return;          // vandaag: terrorbite nog open
        if (d > 0 && r() < 0.18) return;          // af en toe een dag gemist
        const u = leden[Math.floor(r() * leden.length)];
        const t = U.addDays(new Date(), -d); t.setHours(d === 0 ? Math.max(0, new Date().getHours() - 2) : 14 + Math.floor(r() * 8), Math.floor(r() * 60));
        st.missions.push({ id: U.uid(), datum: U.dkey(t), type: m.id, user_id: u.id, user_name: u.name, ts: iso(t.getTime()) });
      });
    }
  }
  function seedRsvps(st) {
    const r = rng(5);
    const leden = st.users.filter(u => u.pin && !L.isGangpot(u));
    const redenen = ['Moet werken', 'Ben op reis', 'Familiefeest', 'Examen de dag erna'];
    st.rsvps = [];
    (st.events || []).forEach(e => leden.forEach(u => {
      const x = r();
      if (x < 0.25) return;
      const status = x < 0.7 ? 'aanwezig' : x < 0.85 ? 'misschien' : 'afwezig';
      st.rsvps.push({ id: U.uid(), event_id: e.id, user_id: u.id, user_name: u.name, status,
        reden: status === 'afwezig' ? redenen[Math.floor(r() * redenen.length)] : null, ts: iso(Date.now() - Math.floor(r() * 40) * 3600000) });
    }));
  }
  // ---------- amfi loods: tickets (demo) ----------
  const AM = App.AMFI;
  const msg = (from, u, text, ts) => ({ id: U.uid(), from, user_id: u ? u.id : null, user_name: u ? u.name : AM.BOT, text, ts });
  function newTicket(st, u, keer, levering, opmerking, ts) {
    const t = { id: U.uid(), nr: ++st.ticketSeq, user_id: u.id, user_name: u.name, keer, levering, opmerking: opmerking || null,
      quote: AM.quote(st.settings.amfi, keer, levering), status: 'wachtrij', medewerker_id: null, medewerker_naam: null,
      created_at: ts, updated_at: ts, messages: [] };
    st.tickets.push(t);
    t.messages.push(msg('bot', null, AM.intro(t, AM.position(st.tickets, t)), ts));
    if (opmerking) t.messages.push(msg('user', u, opmerking, ts));
    return t;
  }
  function seedAmfi(st) {
    st.settings.amfi = JSON.parse(JSON.stringify(AM.DEFAULT));
    st.ticketSeq = 0; st.tickets = [];
    const by = n => st.users.find(u => u.name === n);
    ['kenzo', 'matis'].forEach(n => { const u = by(n); if (u) { u.amfi_staff = true; u.access = { ...(u.access || {}), amfi: true }; } });
    const ago = m => iso(Date.now() - m * 60000);
    const mk = (n, keer, lev, m, opm) => by(n) ? newTicket(st, by(n), keer, lev, opm, ago(m)) : null;
    const t1 = mk('ivar', 3, 'wij', 60 * 26);
    if (t1) { Object.assign(t1, { status: 'klaar', medewerker_id: by('kenzo').id, medewerker_naam: 'kenzo', updated_at: ago(60 * 20) });
      t1.messages.push(msg('bot', null, 'kenzo helpt je nu verder.', ago(60 * 25)), msg('staff', by('kenzo'), 'Yo, betaal je aan mij of via de pot?', ago(60 * 25 - 2)),
        msg('user', by('ivar'), 'Ik geef het je cash bij de loods.', ago(60 * 25 - 5)), msg('bot', null, 'Ticket afgerond door kenzo. Bedankt!', ago(60 * 20))); }
    const t2 = mk('dario', 2, 'zelf', 50, 'Ik heb de jodium al, de rest haal ik vanavond.');
    if (t2) { Object.assign(t2, { status: 'bezig', medewerker_id: by('matis').id, medewerker_naam: 'matis', updated_at: ago(20) });
      t2.messages.push(msg('bot', null, 'matis helpt je nu verder.', ago(25)), msg('staff', by('matis'), 'Top. Laat iets weten als je alles hebt, dan spreken we af aan de loods.', ago(20))); }
    const t3 = mk('bob', 5, 'zelf', 18);
    if (t3) { Object.assign(t3, { status: 'bezig', medewerker_id: by('kenzo').id, medewerker_naam: 'kenzo', updated_at: ago(4) });
      t3.messages.push(msg('bot', null, 'kenzo helpt je nu verder.', ago(9)), msg('staff', by('kenzo'), 'Yo Bob, heb je de pseudoefedrine al kunnen kopen?', ago(4))); }
    mk('yusuf', 1, 'wij', 7, 'Liefst vandaag nog als dat lukt 🙏');
  }

  // ---------- wekelijkse gangpot-bijdrage (demo) ----------
  // een betaalweek wordt aangeduid met de datum van de vervaldag (woensdag) van die week
  // (eigen kopie van App.gangpotDue — gangpot.js wordt pas na de store geladen)
  const dueOf = d => U.dkey(U.addDays(U.startOfWeek(d), (App.GANGPOT_DUE_DAY + 6) % 7));
  function seedPayments(st) {
    const r = rng(3);
    st.gangpotPayments = [];
    const leden = st.users.filter(u => u.pin && !L.isGangpot(u));
    for (let w = 5; w >= 0; w--) {
      const due = dueOf(U.addDays(new Date(), -7 * w));
      leden.forEach(u => {
        if (r() < (w === 0 ? 0.45 : 0.85)) st.gangpotPayments.push({ id: U.uid(), week: due, user_id: u.id, user_name: u.name, paid_at: iso(U.parseDay(due).getTime() - Math.floor(r() * 2) * 86400000 + 15 * 3600000), door: 'Boss' });
      });
    }
  }

  // zorgt dat het gangpot-item bestaat en boekt er iets op (gedeeld door missies en de opslag loods)
  function gangpotBook(st, naam, eenheid, delta, note, door) {
    let it = st.gangpot.items.find(i => i.naam.toLowerCase() === naam.toLowerCase());
    if (!it) { it = { id: U.uid(), naam, eenheid, aantal: 0, sort_order: st.gangpot.items.length }; st.gangpot.items.push(it); }
    if (it.aantal + delta < 0) throw E('TE_WEINIG_IN_POT');
    it.aantal += delta;
    st.gangpot.log.push({ id: U.uid(), item_id: it.id, item_naam: it.naam, eenheid: it.eenheid, delta, aantal_after: it.aantal, note, door, ts: iso(Date.now()) });
    return it;
  }

  // ---------- startdata ----------
  // lege testomgeving: enkel het gangpot-profiel (nog te claimen) en de standaardinstellingen
  function emptyState() {
    const now = iso(Date.now());
    return {
      users: [{ id: U.uid(), name: 'gangpot', pin: null, total_ingelegd: 0, opgehaald: 0, legacy_zakjes: 0, sort_order: 99,
        avatar_url: null, discord_id: null, rank: null, access: { wiet: true, opslag: true, amfi: true }, created_at: now }],
      log: [], customers: [], customerLog: [], baseline: { ...R.BASELINE_DEFAULT, set_at: now },
      absences: [], notices: [], events: [], rsvps: [], missions: [], tickets: [], ticketSeq: 0, gangpotPayments: [],
      gangpot: { items: [{ id: U.uid(), naam: App.BASE_ITEM, eenheid: 'stuks', aantal: 0, sort_order: 0 }], log: [] },
      settings: { opslag_code: App.CONFIG.demoOpslagCode, gangpot_code: App.CONFIG.demoGangpotCode, amfi: JSON.parse(JSON.stringify(AM.DEFAULT)) }
    };
  }

  function seed() {
    if (!App.CONFIG.demoData) return emptyState();
    const r = rng(7);
    const now = Date.now();
    const names = ['siebe', 'ivar', 'bob', 'matis', 'dario', 'kenzo', 'yusuf', 'lars'];
    const users = names.map((name, i) => ({
      id: U.uid(), name, pin: true, owner: i === 0, total_ingelegd: 0, opgehaald: 0,
      legacy_zakjes: 0, sort_order: i, avatar_url: null, discord_id: null, created_at: iso(now - 86400000 * (20 - i))
    }));
    ['oprichter', 'kolonel', 'generaal', 'adviseur', 'kapitein', 'veteraan', 'broeder', null].forEach((r, i) => { users[i].rank = r; });
    users.forEach((u, i) => { u.access = { wiet: true, opslag: i < 6, amfi: i < 6, boss: i < 2, gangpot: i < 3 }; });
    users.push({ id: U.uid(), name: 'gangpot', pin: null, total_ingelegd: 0, opgehaald: 0, legacy_zakjes: 0,
      sort_order: 99, avatar_url: null, discord_id: null, created_at: iso(now - 86400000 * 30) });
    const st = { users, log: [], customers: [], customerLog: [], baseline: { ...R.BASELINE_DEFAULT, set_at: iso(now) } };

    // inleg verspreid over de laatste ~9 uur, zodat er een deel klaar is en een deel nog in de wachtrij zit
    const N = 18;
    for (let i = 0; i < N; i++) {
      const minsAgo = Math.max(4, Math.round(540 - i * (540 / N) - r() * 12));
      const u = users[Math.floor(r() * names.length)];
      const amt = Math.round((120 + r() * 480) / 10) * 10;
      applyInleg(st, u, amt, iso(now - minsAgo * 60000));
    }
    // een paar leden hebben al opgehaald
    const snap = L.snapshot(st);
    users.slice(0, 6).forEach((u, i) => {
      const amt = Math.floor(snap.perUser.get(u.id).momTegoed * (0.35 + r() * 0.4));
      if (amt > 0) applyOphalen(st, u, amt, iso(now - (12 + i * 21) * 60000));
    });

    const klanten = [
      { name: 'Marco "Slim" de Vries', groep: 'Ballas', phone: '555-0142' },
      { name: 'Tyrone Jackson', groep: 'Families', phone: '555-0198' },
      { name: 'Esteban Ruiz', groep: 'Vagos', phone: null },
      { name: 'Nina Kowalski', groep: null, phone: '555-0110' },
      { name: 'Big Mike', groep: 'Lost MC', phone: '555-0177' },
      { name: 'Jaylen Price', groep: 'Families', phone: null },
      { name: 'Ricky Moreno', groep: 'Vagos', phone: '555-0163' }
    ];
    klanten.forEach((k, i) => {
      const c = { id: U.uid(), name: k.name, phone: k.phone, groep: k.groep, total_geleverd: 0, total_verkocht: 0, total_omzet: 0,
        created_by: names[i % names.length], created_at: iso(now - 86400000 * (10 - i)), last_activity: null };
      st.customers.push(c);
      const n = 1 + Math.floor(r() * 4);
      for (let j = 0; j < n; j++) {
        const by = users[Math.floor(r() * names.length)];
        const ts = iso(now - Math.round((n - j) * (60 + r() * 600)) * 60000);
        if (r() < 0.6) applySwap(st, c, Math.round((20 + r() * 120) / 4) * 4, by, ts);
        else applyVerkoop(st, c, 5 + Math.floor(r() * 40), [80, 95, 110, 125][Math.floor(r() * 4)], by, ts);
      }
    });

    st.absences = seedAbsences(users);
    seedBoss(st);
    seedMissions(st);
    seedRsvps(st);
    seedAmfi(st);
    seedPayments(st);
    st.log.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    st.customerLog.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    return st;
  }

  function persist() { U.storage.set(KEY, JSON.stringify(state)); }
  function commit() { persist(); subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  function load() {
    try {
      const raw = U.storage.get(KEY);
      if (raw) {
        state = JSON.parse(raw);
        // oudere demo-data had nog geen afwezigheden
        if (!state.absences) state.absences = seedAbsences(state.users);
        state.absences.forEach(a => { if (!a.status) Object.assign(a, { status: 'goedgekeurd', reactie: null, beoordeeld_door: null, beoordeeld_at: null }); });
        if (!state.notices || !state.events || !state.gangpot) seedBoss(state);
        if (!state.gangpot.items.some(i => i.naam === App.BASE_ITEM)) state.gangpot.items.push({ id: U.uid(), naam: App.BASE_ITEM, eenheid: 'stuks', aantal: 4200, sort_order: 2 });
        if (!state.missions || !state.settings) seedMissions(state);
        if (!state.rsvps) seedRsvps(state);
        if (!state.gangpotPayments) { if (App.CONFIG.demoData) seedPayments(state); else state.gangpotPayments = []; }
        state.users.forEach(u => {
          if (u.rank === undefined) u.rank = null;
          if (u.rank && App.RANK_MIGRATE[u.rank]) u.rank = App.RANK_MIGRATE[u.rank];
          if (u.rank && !App.RANKS.some(r => r.id === u.rank)) u.rank = null;
          if (!u.access) u.access = { wiet: true, opslag: true };
          if (u.access.amfi === undefined) u.access.amfi = !!u.amfi_staff || L.isGangpot(u);   // amfi-toegang is nieuw: enkel medewerkers
        });
        // geen codes meer: wie kan inloggen = elk profiel behalve de gangpot; het eerste profiel is de eigenaar
        state.users.forEach(u => { if (!L.isGangpot(u)) u.pin = true; });
        if (!state.users.some(u => u.owner)) {
          const first = state.users.filter(u => !L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order)[0];
          if (first) { first.owner = true; first.access = { ...first.access, boss: true }; }
        }
        // nieuw amfi-model (winkels + vaste prijs per poeder): oude demo-tickets opnieuw aanmaken
        if (!state.tickets || !state.settings.amfi || !state.settings.amfi.winkels) seedAmfi(state);
        if (state.settings.amfi.prijs_wij_per_keer === 10000) state.settings.amfi.prijs_wij_per_keer = 7000;   // oude standaardprijs
        persist();
        return;
      }
    } catch (e) { /* kapotte data -> opnieuw seeden */ }
    state = seed();
    persist();
  }
  const latency = () => U.wait(140 + Math.random() * 160);
  const userById = id => { const u = state.users.find(x => x.id === id); if (!u) throw E('GEBRUIKER_NIET_GEVONDEN'); return u; };
  const klantById = id => { const k = state.customers.find(x => x.id === id); if (!k) throw E('KLANT_NIET_GEVONDEN'); return k; };
  const posInt = n => { n = Number(n); if (!Number.isInteger(n) || n <= 0) throw E('ONGELDIG_AANTAL'); return n; };

  load();

  App.store = {
    mode: 'demo',
    get state() { return state; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    // ---- inloggen: in de demo kies je gewoon een profiel (de echte site gebruikt Discord) ----
    get auth() {
      const id = U.storage.get(AUTH_KEY);
      const ok = id && state.users.some(u => u.id === id && !L.isGangpot(u));
      return { status: ok ? 'member' : 'anon', userId: ok ? id : null, discordId: null, discordName: null, error: null };
    },
    async signIn(userId) { await latency(); userById(userId); U.storage.set(AUTH_KEY, userId); commit(); },
    async signOut() { U.storage.del(AUTH_KEY); commit(); },
    // demo: nieuw profiel maken en meteen inloggen; het eerste profiel wordt de eigenaar (zoals Bob)
    async createProfile(name) {
      await latency();
      name = String(name || '').trim();
      if (state.users.length >= R.MAX_USERS) throw E('LOODS_VOL');
      if (!name) throw E('ONGELDIGE_NAAM');
      if (state.users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw E('NAAM_BESTAAT_AL');
      const first = !state.users.some(u => !L.isGangpot(u));
      const u = { id: U.uid(), name, pin: true, total_ingelegd: 0, opgehaald: 0, legacy_zakjes: 0, rank: null, owner: first,
        access: { ...App.ACCESS_DEFAULT, boss: first },
        sort_order: Math.max(0, ...state.users.filter(x => !L.isGangpot(x)).map(x => x.sort_order)) + 1,
        avatar_url: null, discord_id: null, created_at: iso(Date.now()) };
      state.users.push(u); U.storage.set(AUTH_KEY, u.id); commit(); return u;
    },
    // profielfoto (zoals fn_set_avatar; in de echte versie: upload naar Supabase Storage → publieke URL)
    async setAvatar(userId, dataUrl) {
      await latency();
      const u = userById(userId);
      if (dataUrl && (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > 250000)) throw E('ONGELDIGE_FOTO');
      u.avatar_url = dataUrl || null; commit();
    },

    // ---- loods ----
    async registerInleg(userId, amount) {
      await latency();
      amount = posInt(amount);
      const u = userById(userId);
      const p = L.snapshot(state).perUser.get(u.id);
      if (!p.gangpot && p.momInleg + amount > R.MAX_MOMENTEEL_INLEG) throw E('MAX_ONVERWERKT_BEREIKT');
      const split = applyInleg(state, u, amount, iso(Date.now()));
      commit(); return split;
    },
    async registerOphalen(userId, amount) {
      await latency();
      amount = posInt(amount);
      const u = userById(userId);
      const p = L.snapshot(state).perUser.get(u.id);
      if (amount > p.tegoed) throw E('ONVOLDOENDE_TEGOED');
      if (amount > p.momTegoed) throw E('NOG_NIET_VERWERKT');
      applyOphalen(state, u, amount, iso(Date.now()));
      commit();
    },

    // ---- klanten ----
    async createKlant({ name, phone, groep }, byUser) {
      await latency();
      name = String(name || '').trim();
      if (!name) throw E('ONGELDIGE_NAAM');
      if (state.customers.some(c => c.name.toLowerCase() === name.toLowerCase())) throw E('KLANT_BESTAAT_AL');
      const k = { id: U.uid(), name, phone: (phone || '').trim() || null, groep: (groep || '').trim() || null,
        total_geleverd: 0, total_verkocht: 0, total_omzet: 0, created_by: byUser.name, created_at: iso(Date.now()), last_activity: null };
      state.customers.push(k); commit(); return k;
    },
    async registerSwap(customerId, amount, byUser) {
      await latency();
      applySwap(state, klantById(customerId), posInt(amount), byUser, iso(Date.now()));
      commit();
    },
    async registerVerkoop(customerId, amount, price, byUser) {
      await latency();
      price = Number(price);
      if (!(price > 0)) throw E('ONGELDIGE_PRIJS');
      applyVerkoop(state, klantById(customerId), posInt(amount), price, byUser, iso(Date.now()));
      commit();
    },

    // ---- boss ----
    async setSiteOnderhoud(on) {
      await latency();
      state.settings.site_onderhoud = !!on; commit();
    },
    async setBaseline(patch, byName) {
      await latency();
      const b = state.baseline;
      if (patch.batch_size !== undefined || patch.batch_minutes !== undefined) {
        const bs = Number(patch.batch_size ?? b.batch_size), bm = Number(patch.batch_minutes ?? b.batch_minutes);
        if (!(bs > 0) || !(bm > 0)) throw E('ONGELDIGE_BATCH');
      }
      if (patch.paused === true && !b.paused) patch.paused_at = iso(Date.now());
      if (patch.paused === false && b.paused) {
        // pauzeduur bij de offset optellen, zodat de wachtrij verdergaat waar hij stond (zoals fix-pause-offset.sql)
        patch.offset_minutes = (b.offset_minutes || 0) + Math.round((Date.now() - new Date(b.paused_at).getTime()) / 60000);
        patch.paused_at = null;
      }
      Object.assign(b, patch, { set_by: byName, set_at: iso(Date.now()) });
      commit();
    },

    // ---- afwezigheid (later: tabel absences + fn_add_absence / fn_delete_absence) ----
    async addAfwezigheid(userId, { van, tot, reden, toelichting }) {
      await latency();
      const u = userById(userId);
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(van || '') || !re.test(tot || '')) throw E('ONGELDIGE_DATUM');
      if (tot < van) throw E('EINDE_VOOR_START');
      if (tot < U.dkey(new Date())) throw E('DATUM_VERLEDEN');
      if (!App.ABSENCE.REASONS.some(r => r.id === reden)) throw E('GEEN_REDEN');
      toelichting = String(toelichting || '').trim().slice(0, App.ABSENCE.MAX_NOTE);
      if (reden === 'andere' && !toelichting) throw E('TOELICHTING_NODIG');
      if (state.absences.some(a => a.user_id === u.id && a.status !== 'afgekeurd' && a.van <= tot && a.tot >= van)) throw E('AFWEZIG_OVERLAP');
      const a = { id: U.uid(), user_id: u.id, user_name: u.name, van, tot, reden, toelichting: toelichting || null, created_at: iso(Date.now()),
        status: 'aangevraagd', reactie: null, beoordeeld_door: null, beoordeeld_at: null };
      state.absences.push(a);
      commit();
      return a;
    },
    async deleteAfwezigheid(id, userId) {
      await latency();
      const i = state.absences.findIndex(a => a.id === id);
      if (i < 0) throw E('AFWEZIGHEID_NIET_GEVONDEN');
      if (state.absences[i].user_id !== userId) throw E('GEEN_RECHT');
      state.absences.splice(i, 1);
      commit();
    },

    // boss: elke afwezigheid schrappen (ook die van anderen)
    async bossDeleteAfwezigheid(id) {
      await latency();
      const i = state.absences.findIndex(a => a.id === id);
      if (i < 0) throw E('AFWEZIGHEID_NIET_GEVONDEN');
      state.absences.splice(i, 1);
      commit();
    },

    // ---- boss (later: allemaal SECURITY DEFINER-functies die de bosscode controleren) ----
    // afwezigheid beoordelen: status 'goedgekeurd' | 'afgekeurd' | null (= enkel reageren)
    async reviewAfwezigheid(id, { status, reactie }, door) {
      await latency();
      const a = state.absences.find(x => x.id === id);
      if (!a) throw E('AFWEZIGHEID_NIET_GEVONDEN');
      if (status && !App.ABSENCE.STATUS[status]) throw E('ONGELDIGE_STATUS');
      reactie = String(reactie || '').trim().slice(0, 200);
      if (!status && !reactie) throw E('REACTIE_NODIG');
      if (status) a.status = status;
      if (reactie) a.reactie = reactie;
      Object.assign(a, { beoordeeld_door: door, beoordeeld_at: iso(Date.now()) });
      commit();
    },
    async addMededeling({ titel, tekst, soort, tag }, door) {
      await latency();
      titel = String(titel || '').trim().slice(0, 80); tekst = String(tekst || '').trim().slice(0, 1500);
      if (!titel) throw E('GEEN_TITEL');
      if (!tekst) throw E('GEEN_TEKST');
      if (!App.NOTICE.KINDS.some(k => k.id === soort)) throw E('ONGELDIG_TYPE');
      state.notices.unshift({ id: U.uid(), titel, tekst, soort, tag: !!tag, door, created_at: iso(Date.now()) });
      commit();
    },
    async deleteMededeling(id) {
      await latency();
      const i = state.notices.findIndex(n => n.id === id);
      if (i < 0) throw E('NIET_GEVONDEN');
      state.notices.splice(i, 1); commit();
    },
    async addEvent({ titel, type, datum, tijd, plaats, info }, door) {
      await latency();
      titel = String(titel || '').trim().slice(0, 80);
      if (!titel) throw E('GEEN_TITEL');
      if (!App.AGENDA.TYPES.some(t => t.id === type)) throw E('ONGELDIG_TYPE');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datum || '')) throw E('GEEN_DATUM');
      if (tijd && !/^\d{2}:\d{2}$/.test(tijd)) throw E('ONGELDIGE_TIJD');
      const ev = { id: U.uid(), titel, type, datum, tijd: tijd || null, plaats: String(plaats || '').trim().slice(0, 80) || null,
        info: String(info || '').trim().slice(0, 300) || null, door, created_at: iso(Date.now()) };
      state.events.push(ev); commit(); return ev;
    },
    async deleteEvent(id) {
      await latency();
      const i = state.events.findIndex(e => e.id === id);
      if (i < 0) throw E('NIET_GEVONDEN');
      state.events.splice(i, 1); commit();
    },
    async addGangpotItem({ naam, eenheid, aantal }, door) {
      await latency();
      naam = String(naam || '').trim().slice(0, 40); eenheid = String(eenheid || '').trim().slice(0, 12) || 'stuks';
      if (!naam) throw E('ONGELDIGE_NAAM');
      if (state.gangpot.items.some(i => i.naam.toLowerCase() === naam.toLowerCase())) throw E('ITEM_BESTAAT_AL');
      aantal = Number(aantal || 0);
      if (!Number.isFinite(aantal) || aantal < 0) throw E('ONGELDIG_AANTAL');
      const it = { id: U.uid(), naam, eenheid, aantal, sort_order: state.gangpot.items.length };
      state.gangpot.items.push(it);
      state.gangpot.log.push({ id: U.uid(), item_id: it.id, item_naam: naam, eenheid, delta: aantal, aantal_after: aantal, note: 'Nieuw item', door, ts: iso(Date.now()) });
      commit();
    },
    // delta > 0 = erbij, < 0 = eruit
    async mutateGangpot(itemId, delta, note, door) {
      await latency();
      const it = state.gangpot.items.find(i => i.id === itemId);
      if (!it) throw E('NIET_GEVONDEN');
      delta = Number(delta);
      if (!Number.isFinite(delta) || delta === 0) throw E('ONGELDIG_AANTAL');
      if (it.aantal + delta < 0) throw E('TE_WEINIG_IN_POT');
      it.aantal += delta;
      state.gangpot.log.push({ id: U.uid(), item_id: it.id, item_naam: it.naam, eenheid: it.eenheid, delta, aantal_after: it.aantal,
        note: String(note || '').trim().slice(0, 120) || null, door, ts: iso(Date.now()) });
      commit();
    },
    async deleteGangpotItem(itemId) {
      await latency();
      const i = state.gangpot.items.findIndex(x => x.id === itemId);
      if (i < 0) throw E('NIET_GEVONDEN');
      state.gangpot.items.splice(i, 1); commit();
    },

    // ---- opslag loods (fn_complete_mission doet ook de +600 base) ----
    async completeMission(type, userId) {
      await latency();
      const m = App.MISSIONS.find(x => x.id === type);
      if (!m) throw E('ONGELDIGE_MISSIE');
      const u = userById(userId);
      const datum = U.dkey(new Date());
      if (state.missions.some(x => x.datum === datum && x.type === type)) throw E('MISSIE_AL_GEDAAN');
      state.missions.push({ id: U.uid(), datum, type, user_id: u.id, user_name: u.name, ts: iso(Date.now()) });
      if (m.reward) gangpotBook(state, m.reward.item, m.reward.eenheid, m.reward.amount, `${m.label} — ${u.name}`, u.name);
      commit();
    },
    // base erbij/eruit vanuit de opslag loods (bv. verkocht)
    async mutateBase(delta, note, door) {
      await latency();
      delta = Number(delta);
      if (!Number.isFinite(delta) || delta === 0) throw E('ONGELDIG_AANTAL');
      gangpotBook(state, App.BASE_ITEM, 'stuks', delta, String(note || '').trim().slice(0, 120) || null, door);
      commit();
    },
    // boss: bijdrage van een lid voor een week (week = datum van de vervaldag) aan/uit vinken
    async bossSetGangpotPaid(userId, week, paid, door) {
      await latency();
      const u = userById(userId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week || '')) throw E('ONGELDIGE_DATUM');
      state.gangpotPayments = state.gangpotPayments.filter(p => !(p.user_id === u.id && p.week === week));
      if (paid) state.gangpotPayments.push({ id: U.uid(), week, user_id: u.id, user_name: u.name, paid_at: iso(Date.now()), door });
      commit();
    },

    // ---- amfi loods: tickets (later: tabellen amfi_tickets + amfi_messages, RPC's per actie) ----
    // actor = { userId, name, boss } — boss = Boss menu ontgrendeld (mag alles wat een medewerker mag)
    async createAmfiTicket(userId, { keer, levering, opmerking }) {
      await latency();
      const u = userById(userId);
      if (!App.hasAccess(u, 'amfi')) throw E('GEEN_TOEGANG');
      keer = posInt(keer);
      if (keer > AM.MAX_KEER) throw E('TE_VEEL_KEER');
      if (!AM.LEVERING[levering]) throw E('ONGELDIGE_LEVERING');
      if (state.tickets.some(t => t.user_id === u.id && AM.OPEN(t.status))) throw E('AL_OPEN_TICKET');
      const t = newTicket(state, u, keer, levering, String(opmerking || '').trim().slice(0, 300), iso(Date.now()));
      commit(); return t;
    },
    async ticketMessage(ticketId, actor, text) {
      await latency();
      const t = state.tickets.find(x => x.id === ticketId);
      if (!t) throw E('TICKET_NIET_GEVONDEN');
      if (!AM.OPEN(t.status)) throw E('TICKET_GESLOTEN');
      const u = actor.userId ? userById(actor.userId) : null;
      const owner = u && u.id === t.user_id, staff = actor.boss || (u && u.amfi_staff);
      if (!owner && !staff) throw E('GEEN_MEDEWERKER');
      text = String(text || '').trim().slice(0, 500);
      if (!text) throw E('LEEG_BERICHT');
      t.messages.push({ ...msg(owner ? 'user' : 'staff', u, text, iso(Date.now())), user_name: owner ? u.name : actor.name });
      t.updated_at = iso(Date.now());
      commit();
    },
    async claimTicket(ticketId, actor) {
      await latency();
      const t = state.tickets.find(x => x.id === ticketId);
      if (!t) throw E('TICKET_NIET_GEVONDEN');
      const u = actor.userId ? userById(actor.userId) : null;
      if (!actor.boss && !(u && u.amfi_staff)) throw E('GEEN_MEDEWERKER');
      if (!AM.OPEN(t.status)) throw E('TICKET_GESLOTEN');
      Object.assign(t, { status: 'bezig', medewerker_id: u ? u.id : null, medewerker_naam: actor.name, updated_at: iso(Date.now()) });
      t.messages.push(msg('bot', null, `${actor.name} helpt je nu verder.`, iso(Date.now())));
      commit();
    },
    // status: 'klaar' | 'wachtrij' (terugzetten) door medewerker/boss — 'geannuleerd' ook door de eigenaar zolang het in de wachtrij staat
    async setTicketStatus(ticketId, status, actor) {
      await latency();
      const t = state.tickets.find(x => x.id === ticketId);
      if (!t) throw E('TICKET_NIET_GEVONDEN');
      if (!AM.STATUS[status]) throw E('ONGELDIGE_STATUS');
      const u = actor.userId ? userById(actor.userId) : null;
      const owner = u && u.id === t.user_id, staff = actor.boss || (u && u.amfi_staff);
      if (!(staff || (owner && status === 'geannuleerd' && t.status === 'wachtrij'))) throw E('GEEN_MEDEWERKER');
      if (!AM.OPEN(t.status)) throw E('TICKET_GESLOTEN');
      const now = iso(Date.now());
      if (status === 'wachtrij') Object.assign(t, { medewerker_id: null, medewerker_naam: null });
      t.status = status; t.updated_at = now;
      const txt = { klaar: `Ticket afgerond door ${actor.name}. Bedankt!`, geannuleerd: `Ticket geannuleerd door ${owner ? t.user_name : actor.name}.`,
        wachtrij: 'Je ticket staat terug in de wachtrij — een andere medewerker neemt het over.', bezig: `${actor.name} helpt je nu verder.` }[status];
      t.messages.push(msg('bot', null, txt, now));
      commit();
    },
    // "gelezen" per persoon per ticket (voor de +1 in de lobby en de sidebar)
    async markTicketRead(ticketId, userId) {
      const t = state.tickets.find(x => x.id === ticketId);
      if (!t) return;
      t.read = t.read || {};
      t.read[userId] = iso(Date.now());
      commit();
    },
    async bossSetAmfiStaff(userId, on) {
      await latency();
      const u = userById(userId);
      u.amfi_staff = !!on;
      if (on) u.access = { ...(u.access || {}), amfi: true };
      commit();
    },
    // prijs leeg = geen prijs (bv. zelf te plukken); zwart = met zwart geld te betalen
    async bossSetAmfiSettings({ input_per_keer, output_waarde, prijs_wij_per_keer, winkels }) {
      await latency();
      const nums = [input_per_keer, output_waarde, prijs_wij_per_keer].map(Number);
      if (nums.some(n => !Number.isFinite(n) || n < 0)) throw E('ONGELDIGE_PRIJZEN');
      const ws = (winkels || []).map(w => ({ naam: String(w.naam || '').trim().slice(0, 40), info: String(w.info || '').trim().slice(0, 120) || null,
        producten: (w.producten || []).map(p => ({ naam: String(p.naam || '').trim().slice(0, 40), aantal_per_keer: Number(p.aantal_per_keer),
          prijs: p.prijs === '' || p.prijs == null ? null : Number(p.prijs), zwart: !!p.zwart })) }));
      const bad = ws.some(w => !w.naam || w.producten.some(p => !p.naam || !Number.isFinite(p.aantal_per_keer) || p.aantal_per_keer < 0 || (p.prijs != null && (!Number.isFinite(p.prijs) || p.prijs < 0))));
      if (bad) throw E('ONGELDIGE_PRIJZEN');
      const s = state.settings.amfi;
      state.settings.amfi = { ...s, input_per_keer: nums[0], output_waarde: nums[1], prijs_wij_per_keer: nums[2], winkels: ws };
      commit();
    },

    // ---- agenda: aanmelden (later: tabel event_rsvps + fn_set_rsvp) ----
    async setRsvp(eventId, userId, status, reden) {
      await latency();
      const e = state.events.find(x => x.id === eventId);
      if (!e) throw E('NIET_GEVONDEN');
      if (e.datum < U.dkey(new Date())) throw E('EVENT_VOORBIJ');
      if (!App.AGENDA.RSVP.some(s => s.id === status)) throw E('ONGELDIGE_STATUS');
      reden = String(reden || '').trim().slice(0, 140);
      if (status === 'afwezig' && !reden) throw E('REDEN_NODIG');
      const u = userById(userId);
      const ex = state.rsvps.find(x => x.event_id === eventId && x.user_id === userId);
      const row = { event_id: eventId, user_id: u.id, user_name: u.name, status, reden: status === 'afwezig' ? reden : (reden || null), ts: iso(Date.now()) };
      if (ex) Object.assign(ex, row); else state.rsvps.push({ id: U.uid(), ...row });
      commit();
    },

    // ---- boss: leden & klanten (spiegelt fn_boss_set_user_data, fn_boss_reset_pin, fn_delete_profile, ...) ----
    async bossSetUserData(userId, { total_ingelegd, opgehaald, legacy_zakjes }, door) {
      await latency();
      const u = userById(userId);
      const vals = [total_ingelegd, opgehaald, legacy_zakjes].map(Number);
      if (vals.some(v => !Number.isInteger(v) || v < 0)) throw E('ONGELDIGE_WAARDE');
      const [ti, op, lg] = vals;
      const note = `ingelegd ${u.total_ingelegd}→${ti}, opgehaald ${u.opgehaald}→${op}, legacy ${u.legacy_zakjes || 0}→${lg}${door ? ` (door ${door})` : ''}`;
      Object.assign(u, { total_ingelegd: ti, opgehaald: op, legacy_zakjes: lg });
      state.log.push({ id: U.uid(), type: 'correctie', user_id: u.id, user_name: u.name, amount: 0, note, ts: iso(Date.now()) });
      commit();
    },
    async bossDeleteProfile(userId) {
      await latency();
      const u = userById(userId);
      if (L.isGangpot(u)) throw E('GANGPOT_PROFIEL');
      if (u.owner) throw E('EIGENAAR');
      state.users = state.users.filter(x => x.id !== userId);   // logboek blijft (met naam)
      commit();
    },
    async bossSetDiscord(userId, discordId) {
      await latency();
      const u = userById(userId);
      const id = String(discordId || '').trim() || null;
      if (id && !/^\d{15,22}$/.test(id)) throw E('ONGELDIG_DISCORD_ID');
      if (id && state.users.some(x => x.discord_id === id && x.id !== u.id)) throw E('DISCORD_AL_GEBRUIKT');
      u.discord_id = id; commit();
    },
    // profiel aanmaken zonder code → "nog vrij", het lid kiest zelf zijn code bij de eerste login
    async bossCreateProfile({ name, rank, access, amfi_staff }) {
      await latency();
      name = String(name || '').trim();
      if (state.users.length >= R.MAX_USERS) throw E('LOODS_VOL');
      if (!name) throw E('ONGELDIGE_NAAM');
      if (state.users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw E('NAAM_BESTAAT_AL');
      if (rank && !App.RANKS.some(r => r.id === rank)) throw E('ONGELDIGE_RANG');
      const u = { id: U.uid(), name, pin: null, total_ingelegd: 0, opgehaald: 0, legacy_zakjes: 0, rank: rank || null,
        access: { wiet: !!(access && access.wiet), opslag: !!(access && access.opslag), amfi: !!((access && access.amfi) || amfi_staff) }, amfi_staff: !!amfi_staff,
        sort_order: Math.max(0, ...state.users.filter(x => !L.isGangpot(x)).map(x => x.sort_order)) + 1,
        avatar_url: null, discord_id: null, created_at: iso(Date.now()) };
      state.users.push(u); commit(); return u;
    },
    // toegang aan/uit: 'wiet' | 'opslag' | 'amfi' | 'amfi_staff' (= amfi-medewerker, geeft ook amfi-toegang) | 'gangpot' | 'boss'
    async bossSetAccess(userId, key, on) {
      await latency();
      const u = userById(userId);
      if (!App.ACCESS.some(a => a.key === key)) throw E('GEEN_TOEGANG');
      if (u.owner) throw E('EIGENAAR');
      if (key === 'amfi_staff') { u.amfi_staff = !!on; if (on) u.access = { ...(u.access || {}), amfi: true }; }
      else {
        u.access = { ...(u.access || {}), [key]: !!on };
        if (key === 'amfi' && !on) u.amfi_staff = false;   // geen toegang = ook geen medewerker meer
      }
      commit();
    },
    async bossSetRank(userId, rank) {
      await latency();
      const u = userById(userId);
      if (rank && !App.RANKS.some(r => r.id === rank)) throw E('ONGELDIGE_RANG');
      u.rank = rank || null; commit();
    },
    // volledige volgorde van de profielen (zoals fn_boss_set_order): bepaalt ook de volgorde bij "Wie ben jij?"
    async bossSetOrder(ids) {
      await latency();
      if (!Array.isArray(ids) || ids.length !== state.users.length || !state.users.every(u => ids.includes(u.id))) throw E('ONGELDIGE_VOLGORDE');
      ids.forEach((id, i) => { userById(id).sort_order = i; });
      commit();
    },
    async bossMoveUser(userId, dir) {
      await latency();
      const list = state.users.filter(u => !L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);
      const i = list.findIndex(u => u.id === userId), j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((u, k) => { u.sort_order = k; });
      commit();
    },
    async bossSetKlant(customerId, { name, groep, phone, total_geleverd, total_verkocht, total_omzet }, door) {
      await latency();
      const k = klantById(customerId);
      name = String(name || '').trim();
      if (!name) throw E('ONGELDIGE_NAAM');
      if (state.customers.some(c => c.id !== k.id && c.name.toLowerCase() === name.toLowerCase())) throw E('KLANT_BESTAAT_AL');
      const g = Number(total_geleverd), v = Number(total_verkocht), o = Number(total_omzet);
      if (![g, v].every(x => Number.isInteger(x) && x >= 0) || !(o >= 0)) throw E('ONGELDIGE_WAARDE');
      Object.assign(k, { name, groep: String(groep || '').trim() || null, phone: String(phone || '').trim() || null,
        total_geleverd: g, total_verkocht: v, total_omzet: Math.round(o * 100) / 100 });
      state.customerLog.push({ id: U.uid(), customer_id: k.id, kind: 'correctie', by_user_id: null, by_user_name: door, amount: 0, note: 'gegevens aangepast door Boss', ts: iso(Date.now()) });
      commit();
    },
    async bossDeleteKlant(customerId) {
      await latency();
      klantById(customerId);
      state.customers = state.customers.filter(c => c.id !== customerId);   // geschiedenis blijft
      commit();
    },

    // ---- alleen demo ----
    async resetDemo() { state = seed(); U.storage.del(AUTH_KEY); commit(); }
  };
})(window.App);
