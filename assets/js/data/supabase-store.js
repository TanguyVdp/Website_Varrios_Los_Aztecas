/* ============================================================
 * Supabase-store — de echte gedeelde database.
 * Zelfde methodes als de demo-store (views merken geen verschil). Elke actie = één RPC
 * (zie supabase/update-v2-portaal.sql en de oude update-*.sql), daarna wordt de betrokken
 * data opnieuw opgehaald. Wijzigingen van anderen komen binnen via Supabase Realtime.
 * Enkel actief als App.CONFIG.mode === 'supabase'.
 * ============================================================ */
(function (App) {
  if (App.CONFIG.mode !== 'supabase') return;
  const R = App.RULES, L = App.L, AM = App.AMFI;
  const sb = window.supabase.createClient(App.CONFIG.supabase.url, App.CONFIG.supabase.anonKey);
  const subs = new Set();
  const E = code => new Error(code);

  // geheime sleutels (24u) die de database teruggeeft na een juiste boss-/opslag-/gangpot-code (zie update-v2-beveiliging.sql)
  const HASH = { boss: 'varrios-v2-boss-h', opslag: 'varrios-v2-opslag-h', gangpot: 'varrios-v2-gangpot-h' };
  const ss = {
    get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* privémodus */ } }
  };
  const bossHash = () => ss.get(HASH.boss);
  const needBoss = () => { const h = bossHash(); if (!h) throw E('ONJUISTE_BOSSCODE'); return h; };
  const gangpotHash = () => (App.boss.unlocked() && bossHash()) || ss.get(HASH.gangpot);
  const opslagHash = () => (App.opslag.unlocked() && ss.get(HASH.opslag)) || (App.boss.unlocked() && bossHash()) || ss.get(HASH.opslag);

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // fout van Postgres ("ONJUISTE_BOSSCODE" uit raise exception) → zelfde codes als de demo-store
  function errCode(error) {
    const m = String((error && error.message) || '');
    const k = m.match(/[A-Z][A-Z_]{3,}/);
    if (k && App.ERR[k[0]]) return k[0];
    console.error(error);
    if (/schema cache|does not exist/i.test(m)) return 'De database is nog niet bijgewerkt voor deze versie (supabase/update-v2-portaal.sql).';
    return /fetch|network/i.test(m) ? 'Geen verbinding met de database — probeer opnieuw.' : m || 'Er ging iets mis. Probeer opnieuw.';
  }
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw E(errCode(error));
    return data;
  }

  // ---------- lezen ----------
  // PostgREST geeft max 1000 rijen per keer → per blok ophalen
  async function all(table, order, asc = true) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('*').order(order, { ascending: asc }).range(from, from + 999);
      if (error) throw E(errCode(error));
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  const mapUser = u => ({
    id: u.id, name: u.name, pin: u.claimed ? true : null,
    total_ingelegd: u.total_ingelegd || 0, opgehaald: u.opgehaald || 0, legacy_zakjes: u.legacy_zakjes || 0,
    sort_order: u.sort_order == null ? 999 : u.sort_order, avatar_url: u.avatar_url, discord_id: u.discord_id, created_at: u.created_at,
    rank: u.rank || null, amfi_staff: !!u.amfi_staff,
    access: { wiet: u.access_wiet !== false, opslag: !!u.access_opslag, amfi: !!u.access_amfi }
  });

  // ruwe tabellen; state wordt daaruit opgebouwd
  const raw = {};
  const LOADERS = {
    users:     async () => (await all('users_public', 'sort_order')).map(mapUser),
    log:       () => all('loods_log', 'ts'),
    customers: () => all('customers', 'name'),
    customerLog: () => all('customer_log', 'ts'),
    baseline:  async () => { const { data, error } = await sb.from('loods_baseline').select('*').eq('id', true).maybeSingle(); if (error) throw E(errCode(error)); return data; },
    settings:  async () => { const { data, error } = await sb.from('portal_settings').select('*').eq('id', true).maybeSingle(); if (error) throw E(errCode(error)); return data; },
    absences:  () => all('absences', 'created_at'),
    notices:   () => all('notices', 'created_at', false),
    events:    () => all('events', 'datum'),
    rsvps:     () => all('event_rsvps', 'ts'),
    gpItems:   () => all('gangpot_items', 'sort_order'),
    gpLog:     () => all('gangpot_log', 'ts'),
    payments:  () => all('gangpot_payments', 'paid_at'),
    missions:  () => all('missions', 'ts'),
    tickets:   () => all('amfi_tickets', 'created_at'),
    messages:  () => all('amfi_messages', 'ts')
  };
  // Realtime-tabel → loader
  const TABLES = {
    loods_log: ['log', 'users'], customers: ['customers'], customer_log: ['customerLog', 'customers'], loods_baseline: ['baseline'],
    portal_settings: ['settings'], absences: ['absences'], notices: ['notices'], events: ['events', 'rsvps'], event_rsvps: ['rsvps'],
    gangpot_items: ['gpItems'], gangpot_log: ['gpLog'], gangpot_payments: ['payments'], missions: ['missions'],
    amfi_tickets: ['tickets'], amfi_messages: ['messages']
  };

  let state = null;
  function build() {
    const ps = raw.settings || {};
    const lastAct = new Map();
    (raw.customerLog || []).forEach(l => { if (l.customer_id) lastAct.set(l.customer_id, l.ts); });
    const msgs = new Map();
    (raw.messages || []).forEach(m => {
      if (!msgs.has(m.ticket_id)) msgs.set(m.ticket_id, []);
      msgs.get(m.ticket_id).push({ id: m.id, from: m.sender, user_id: m.user_id, user_name: m.user_name, text: m.text, ts: m.ts });
    });
    state = {
      users: raw.users || [],
      log: raw.log || [],
      customers: (raw.customers || []).map(c => ({ ...c, total_omzet: Number(c.total_omzet || 0), last_activity: lastAct.get(c.id) || null })),
      customerLog: (raw.customerLog || []).map(l => ({ ...l, price_per_unit: l.price_per_unit == null ? null : Number(l.price_per_unit), total_price: l.total_price == null ? null : Number(l.total_price) })),
      baseline: { ...R.BASELINE_DEFAULT, ...(raw.baseline || {}) },
      absences: raw.absences || [],
      notices: raw.notices || [],
      events: raw.events || [],
      rsvps: raw.rsvps || [],
      gangpot: {
        items: (raw.gpItems || []).map(i => ({ ...i, aantal: Number(i.aantal) })),
        log: (raw.gpLog || []).map(l => ({ ...l, delta: Number(l.delta), aantal_after: Number(l.aantal_after) }))
      },
      gangpotPayments: raw.payments || [],
      missions: raw.missions || [],
      tickets: (raw.tickets || []).map(t => ({ ...t, read: t.read || {}, messages: msgs.get(t.id) || [] })),
      settings: {
        // geen echte codes: enkel een versie, zodat een gewijzigde code iedereen terug op slot zet
        opslag_code: 'v' + (ps.opslag_v || 1),
        gangpot_code: 'v' + (ps.gangpot_v || 1),
        amfi: ps.amfi && ps.amfi.winkels ? ps.amfi : JSON.parse(JSON.stringify(AM.DEFAULT)),
        site_onderhoud: ps.site_onderhoud !== false
      }
    };
  }

  // niet hertekenen terwijl iemand iets aan het typen is of een venster openstaat — dan wachten we even
  let pendingNotify = null;
  function busyTyping() {
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value;
    return typing || (App.C && App.C.modal.isOpen());
  }
  function notify(force) {
    if (!force && busyTyping()) {
      if (!pendingNotify) pendingNotify = setInterval(() => { if (!busyTyping()) { clearInterval(pendingNotify); pendingNotify = null; notify(true); } }, 700);
      return;
    }
    subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }

  async function refresh(keys, force) {
    const changed = (await Promise.all(keys.map(async k => {
      const data = await LOADERS[k]();
      const same = JSON.stringify(data) === JSON.stringify(raw[k]);
      raw[k] = data;
      return !same;
    }))).some(Boolean);
    if (changed || force) { build(); notify(force); }
  }
  // na een eigen actie: meteen ophalen en hertekenen (ook als er een venster open is)
  const after = keys => refresh(keys, true).catch(e => console.error(e));

  // Realtime: kleine wachttijd zodat een reeks wijzigingen één keer herladen wordt
  const queued = new Set();
  let qTimer = null;
  function queue(keys) {
    keys.forEach(k => queued.add(k));
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { const ks = [...queued]; queued.clear(); refresh(ks).catch(e => console.error(e)); }, 300);
  }

  const ready = (async () => {
    await Promise.all(Object.keys(LOADERS).map(async k => { raw[k] = await LOADERS[k](); }));
    build();
    const ch = sb.channel('varrios-v2');
    Object.entries(TABLES).forEach(([table, keys]) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => queue(keys)));
    ch.subscribe();
    // de users-tabel zelf is niet leesbaar (pincodes) → geen Realtime; daarom geregeld de profielen opnieuw ophalen
    setInterval(() => { if (!document.hidden) queue(['users']); }, 20000);
    // vangnet als Realtime even wegviel (slaapstand, wifi)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) queue(Object.keys(LOADERS)); });
  })();

  const userById = id => { const u = state.users.find(x => x.id === id); if (!u) throw E('GEBRUIKER_NIET_GEVONDEN'); return u; };
  const posInt = n => { n = Number(n); if (!Number.isInteger(n) || n <= 0) throw E('ONGELDIG_AANTAL'); return n; };
  const pin4 = pin => { if (!pin || String(pin).length < 4) throw E('ONGELDIGE_CODE'); return String(pin); };
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  App.store = {
    mode: 'supabase',
    ready,
    get state() { return state; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    // ---- profielen ----
    async login(userId, pin) {
      const u = userById(userId);
      if (!u.pin) throw E('GEBRUIKER_NIET_GEVONDEN');
      const ok = await rpc('fn_verify_login', { p_user_id: userId, p_pin_hash: await sha256(pin) });
      if (!ok) throw E('ONJUISTE_CODE');
      return u;
    },
    async claimProfile(userId, pin) {
      await rpc('fn_claim_profile', { p_user_id: userId, p_pin_hash: await sha256(pin4(pin)) });
      await after(['users']);
      return userById(userId);
    },
    async createProfile(name, pin) {
      const u = await rpc('fn_create_profile', { p_name: String(name || '').trim(), p_pin_hash: await sha256(pin4(pin)) });
      await after(['users']);
      return userById(u.id);
    },
    async changePin(userId, oldPin, newPin) {
      const ok = await rpc('fn_change_pin', { p_user_id: userId, p_old_pin_hash: await sha256(oldPin), p_new_pin_hash: await sha256(pin4(newPin)) });
      if (!ok) throw E('ONJUISTE_HUIDIGE_CODE');
    },
    // profielfoto: upload naar Storage-bucket 'avatars' (zoals de oude app), daarna de publieke URL opslaan
    async setAvatar(userId, dataUrl) {
      let url = null;
      if (dataUrl) {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw E('ONGELDIGE_FOTO');
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${userId}.jpg`;
        const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) throw E(errCode(error));
        url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
      }
      await rpc('fn_set_avatar', { p_user_id: userId, p_avatar_url: url });
      await after(['users']);
    },

    // ---- loods ----
    async registerInleg(userId, amount) {
      amount = posInt(amount);
      const u = userById(userId);
      const p = L.snapshot(state).perUser.get(u.id);
      if (!p.gangpot && p.momInleg + amount > R.MAX_MOMENTEEL_INLEG) throw E('MAX_ONVERWERKT_BEREIKT');
      const split = L.splitInleg(u, amount, state.users.some(L.isGangpot));
      await rpc('fn_register_inleg', { p_user_id: userId, p_amount: amount, p_huidig_momenteel_inleg: p.momInleg });
      await after(['users', 'log']);
      return split;
    },
    async registerOphalen(userId, amount) {
      amount = posInt(amount);
      const p = L.snapshot(state).perUser.get(userById(userId).id);
      if (amount > p.tegoed) throw E('ONVOLDOENDE_TEGOED');
      if (amount > p.momTegoed) throw E('NOG_NIET_VERWERKT');
      await rpc('fn_register_ophalen', { p_user_id: userId, p_amount: amount, p_max_tegoed: p.momTegoed });
      await after(['users', 'log']);
    },

    // ---- klanten ----
    async createKlant({ name, phone, groep }, byUser) {
      const k = await rpc('fn_create_klant', { p_name: String(name || '').trim(), p_phone: phone || null, p_groep: groep || null, p_created_by: byUser.name });
      await after(['customers']);
      return state.customers.find(c => c.id === k.id) || k;
    },
    async registerSwap(customerId, amount, byUser) {
      await rpc('fn_register_levering', { p_customer_id: customerId, p_amount: posInt(amount), p_by_user_id: byUser.id, p_by_user_name: byUser.name });
      await after(['customers', 'customerLog']);
    },
    async registerVerkoop(customerId, amount, price, byUser) {
      price = Number(price);
      if (!(price > 0)) throw E('ONGELDIGE_PRIJS');
      await rpc('fn_register_levering_verkoop', { p_customer_id: customerId, p_amount: posInt(amount), p_price_per_unit: price, p_by_user_id: byUser.id, p_by_user_name: byUser.name });
      await after(['customers', 'customerLog']);
    },

    // ---- boss ----
    // de code wordt één keer gecontroleerd (met limiet op foute pogingen); daarna werken we met een sleutel van 24u
    async verifyBoss(code) {
      const token = await rpc('fn_boss_login', { p_pin_hash: await sha256(String(code || '')) });
      if (!token) throw E('ONJUISTE_BOSSCODE');
      ss.set(HASH.boss, token);
      return true;
    },
    async setBaseline(patch, byName) {
      const b = state.baseline;
      if (patch.paused !== undefined) await rpc('fn_set_maintenance', { p_paused: !!patch.paused, p_boss_pin_hash: needBoss() });
      if (['batch_size', 'batch_minutes', 'offset_minutes', 'zakjes_correctie'].some(k => patch[k] !== undefined)) {
        const bs = Number(patch.batch_size ?? b.batch_size), bm = Number(patch.batch_minutes ?? b.batch_minutes);
        if (!(bs > 0) || !(bm > 0)) throw E('ONGELDIGE_BATCH');
        await rpc('fn_set_loods_baseline', {
          p_offset_minutes: Math.round(Number(patch.offset_minutes ?? b.offset_minutes) || 0), p_batch_size: bs, p_batch_minutes: bm,
          p_zakjes_correctie: Math.round(Number(patch.zakjes_correctie ?? b.zakjes_correctie) || 0), p_boss_pin_hash: needBoss(), p_set_by: byName
        });
      }
      await after(['baseline']);
    },
    async setSiteOnderhoud(on) {
      await rpc('fn_set_site_onderhoud', { p_on: !!on, p_boss_pin_hash: needBoss() });
      await after(['settings']);
    },

    // ---- afwezigheid ----
    async addAfwezigheid(userId, { van, tot, reden, toelichting }) {
      if (!DAY.test(van || '') || !DAY.test(tot || '')) throw E('ONGELDIGE_DATUM');
      const id = await rpc('fn_add_absence', { p_user_id: userId, p_van: van, p_tot: tot, p_reden: reden || null, p_toelichting: toelichting || null });
      await after(['absences']);
      return state.absences.find(a => a.id === id);
    },
    async deleteAfwezigheid(id, userId) {
      await rpc('fn_delete_absence', { p_id: id, p_user_id: userId });
      await after(['absences']);
    },
    async bossDeleteAfwezigheid(id) {
      await rpc('fn_boss_delete_absence', { p_id: id, p_boss_pin_hash: needBoss() });
      await after(['absences']);
    },
    async reviewAfwezigheid(id, { status, reactie }, door) {
      await rpc('fn_review_absence', { p_id: id, p_status: status || null, p_reactie: reactie || null, p_door: door, p_boss_pin_hash: needBoss() });
      await after(['absences']);
    },
    async addMededeling({ titel, tekst, soort }, door) {
      await rpc('fn_add_notice', { p_titel: titel || '', p_tekst: tekst || '', p_soort: soort || null, p_door: door, p_boss_pin_hash: needBoss() });
      await after(['notices']);
    },
    async deleteMededeling(id) {
      await rpc('fn_delete_notice', { p_id: id, p_boss_pin_hash: needBoss() });
      await after(['notices']);
    },
    async addEvent({ titel, type, datum, tijd, plaats, info }, door) {
      if (!DAY.test(datum || '')) throw E('GEEN_DATUM');
      const id = await rpc('fn_add_event', { p_titel: titel || '', p_type: type || null, p_datum: datum, p_tijd: tijd || null,
        p_plaats: plaats || null, p_info: info || null, p_door: door, p_boss_pin_hash: needBoss() });
      await after(['events']);
      return state.events.find(e => e.id === id);
    },
    async deleteEvent(id) {
      await rpc('fn_delete_event', { p_id: id, p_boss_pin_hash: needBoss() });
      await after(['events', 'rsvps']);
    },

    // ---- gangpot (gangpot-code of bosscode) ----
    async addGangpotItem({ naam, eenheid, aantal }, door) {
      aantal = Number(aantal || 0);
      if (!Number.isFinite(aantal) || aantal < 0) throw E('ONGELDIG_AANTAL');
      await rpc('fn_gangpot_add_item', { p_naam: naam || '', p_eenheid: eenheid || '', p_aantal: aantal, p_door: door, p_code_hash: gangpotHash() });
      await after(['gpItems', 'gpLog']);
    },
    async mutateGangpot(itemId, delta, note, door) {
      delta = Number(delta);
      if (!Number.isFinite(delta) || delta === 0) throw E('ONGELDIG_AANTAL');
      await rpc('fn_gangpot_mutate', { p_item_id: itemId, p_delta: delta, p_note: note || null, p_door: door, p_code_hash: gangpotHash() });
      await after(['gpItems', 'gpLog']);
    },
    async deleteGangpotItem(itemId) {
      await rpc('fn_gangpot_delete_item', { p_item_id: itemId, p_code_hash: gangpotHash() });
      await after(['gpItems']);
    },
    async verifyGangpot(code) {
      const r = await rpc('fn_gangpot_login', { p_pin_hash: await sha256(String(code || '')) });
      if (!r) throw E('ONJUISTE_GANGPOTCODE');
      ss.set(HASH.gangpot, r.token);
      if (state.settings.gangpot_code !== 'v' + r.v) await after(['settings']);
      return true;
    },
    async setGangpotCode(code) {
      code = String(code || '').trim();
      if (!/^\d{4}$/.test(code)) throw E('ONGELDIGE_CODE');
      await rpc('fn_set_gangpot_code', { p_new_pin_hash: await sha256(code), p_boss_pin_hash: needBoss() });
      await after(['settings']);
    },
    async bossSetGangpotPaid(userId, week, paid, door) {
      if (!DAY.test(week || '')) throw E('ONGELDIGE_DATUM');
      await rpc('fn_boss_set_gangpot_paid', { p_user_id: userId, p_week: week, p_paid: !!paid, p_door: door, p_boss_pin_hash: needBoss() });
      await after(['payments']);
    },

    // ---- opslag loods (opslag-code of bosscode) ----
    async verifyOpslag(code) {
      const r = await rpc('fn_opslag_login', { p_pin_hash: await sha256(String(code || '')) });
      if (!r) throw E('ONJUISTE_OPSLAGCODE');
      ss.set(HASH.opslag, r.token);
      if (state.settings.opslag_code !== 'v' + r.v) await after(['settings']);
      return true;
    },
    async setOpslagCode(code) {
      code = String(code || '').trim();
      if (!/^\d{4}$/.test(code)) throw E('ONGELDIGE_CODE');
      await rpc('fn_set_opslag_code', { p_new_pin_hash: await sha256(code), p_boss_pin_hash: needBoss() });
      await after(['settings']);
    },
    async completeMission(type, userId) {
      await rpc('fn_complete_mission', { p_type: type, p_user_id: userId, p_code_hash: opslagHash() });
      await after(['missions', 'gpItems', 'gpLog']);
    },
    async mutateBase(delta, note, door) {
      delta = Number(delta);
      if (!Number.isFinite(delta) || delta === 0) throw E('ONGELDIG_AANTAL');
      await rpc('fn_mutate_base', { p_delta: delta, p_note: note || null, p_door: door, p_code_hash: opslagHash() });
      await after(['gpItems', 'gpLog']);
    },

    // ---- amfi loods ----
    // actor = { userId, name, boss } — boss = Boss menu ontgrendeld
    async createAmfiTicket(userId, { keer, levering, opmerking }) {
      const u = userById(userId);
      if (!App.hasAccess(u, 'amfi')) throw E('GEEN_TOEGANG');
      keer = posInt(keer);
      if (keer > AM.MAX_KEER) throw E('TE_VEEL_KEER');
      if (!AM.LEVERING[levering]) throw E('ONGELDIGE_LEVERING');
      const quote = AM.quote(state.settings.amfi, keer, levering);
      // de database vult ticketnummer en plaats in de wachtrij in
      const intro = AM.intro({ nr: '{nr}', user_name: u.name, quote }, '{pos}');
      const id = await rpc('fn_amfi_create_ticket', { p_user_id: userId, p_keer: keer, p_levering: levering, p_opmerking: opmerking || null, p_quote: quote, p_intro: intro });
      await after(['tickets', 'messages', 'settings']);
      return state.tickets.find(t => t.id === id);
    },
    async ticketMessage(ticketId, actor, text) {
      await rpc('fn_amfi_message', { p_ticket_id: ticketId, p_user_id: actor.userId || null, p_name: actor.name, p_text: text || '', p_boss_pin_hash: actor.boss ? bossHash() : null });
      await after(['tickets', 'messages']);
    },
    async claimTicket(ticketId, actor) {
      await rpc('fn_amfi_claim', { p_ticket_id: ticketId, p_user_id: actor.userId || null, p_name: actor.name, p_boss_pin_hash: actor.boss ? bossHash() : null });
      await after(['tickets', 'messages']);
    },
    async setTicketStatus(ticketId, status, actor) {
      await rpc('fn_amfi_set_status', { p_ticket_id: ticketId, p_status: status, p_user_id: actor.userId || null, p_name: actor.name, p_boss_pin_hash: actor.boss ? bossHash() : null });
      await after(['tickets', 'messages']);
    },
    // meteen lokaal als gelezen markeren (anders vraagt elke hertekening het opnieuw)
    async markTicketRead(ticketId, userId) {
      const t = state.tickets.find(x => x.id === ticketId);
      if (!t) return;
      t.read = { ...(t.read || {}), [userId]: new Date().toISOString() };
      notify();
      try { await rpc('fn_amfi_mark_read', { p_ticket_id: ticketId, p_user_id: userId }); } catch (e) { console.error(e); }
    },
    async bossSetAmfiStaff(userId, on) {
      await rpc('fn_boss_set_access', { p_user_id: userId, p_key: 'amfi_staff', p_on: !!on, p_boss_pin_hash: needBoss() });
      await after(['users']);
    },
    async bossSetAmfiSettings({ input_per_keer, output_waarde, prijs_wij_per_keer, winkels }) {
      const nums = [input_per_keer, output_waarde, prijs_wij_per_keer].map(Number);
      if (nums.some(n => !Number.isFinite(n) || n < 0)) throw E('ONGELDIGE_PRIJZEN');
      const ws = (winkels || []).map(w => ({ naam: String(w.naam || '').trim().slice(0, 40), info: String(w.info || '').trim().slice(0, 120) || null,
        producten: (w.producten || []).map(p => ({ naam: String(p.naam || '').trim().slice(0, 40), aantal_per_keer: Number(p.aantal_per_keer),
          prijs: p.prijs === '' || p.prijs == null ? null : Number(p.prijs), zwart: !!p.zwart })) }));
      const bad = ws.some(w => !w.naam || w.producten.some(p => !p.naam || !Number.isFinite(p.aantal_per_keer) || p.aantal_per_keer < 0 || (p.prijs != null && (!Number.isFinite(p.prijs) || p.prijs < 0))));
      if (bad) throw E('ONGELDIGE_PRIJZEN');
      const settings = { ...state.settings.amfi, input_per_keer: nums[0], output_waarde: nums[1], prijs_wij_per_keer: nums[2], winkels: ws };
      await rpc('fn_boss_set_amfi_settings', { p_settings: settings, p_boss_pin_hash: needBoss() });
      await after(['settings']);
    },

    // ---- agenda ----
    async setRsvp(eventId, userId, status, reden) {
      if (status === 'afwezig' && !String(reden || '').trim()) throw E('REDEN_NODIG');
      await rpc('fn_set_rsvp', { p_event_id: eventId, p_user_id: userId, p_status: status, p_reden: reden || null });
      await after(['rsvps']);
    },

    // ---- boss: leden & klanten ----
    async bossSetUserData(userId, { total_ingelegd, opgehaald, legacy_zakjes }, door) {
      const vals = [total_ingelegd, opgehaald, legacy_zakjes].map(Number);
      if (vals.some(v => !Number.isInteger(v) || v < 0)) throw E('ONGELDIGE_WAARDE');
      await rpc('fn_boss_set_user_data', { p_user_id: userId, p_total_ingelegd: vals[0], p_opgehaald: vals[1], p_legacy_zakjes: vals[2], p_boss_pin_hash: needBoss(), p_set_by: door });
      await after(['users', 'log']);
    },
    async bossResetPin(userId) {
      await rpc('fn_boss_reset_pin', { p_user_id: userId, p_boss_pin_hash: needBoss() });
      await after(['users']);
    },
    async bossDeleteProfile(userId) {
      if (L.isGangpot(userById(userId))) throw E('GANGPOT_PROFIEL');
      await rpc('fn_delete_profile', { p_user_id: userId, p_boss_pin_hash: needBoss() });
      await after(['users', 'absences', 'rsvps', 'payments', 'tickets']);
    },
    async bossSetDiscord(userId, discordId) {
      await rpc('fn_boss_set_discord_id', { p_user_id: userId, p_discord_id: String(discordId || '').trim() || null, p_boss_pin_hash: needBoss() });
      await after(['users']);
    },
    async bossCreateProfile({ name, rank, access, amfi_staff }) {
      const a = access || {};
      const id = await rpc('fn_boss_create_profile', { p_name: String(name || '').trim(), p_rank: rank || null, p_access_wiet: !!a.wiet,
        p_access_opslag: !!a.opslag, p_access_amfi: !!a.amfi, p_amfi_staff: !!amfi_staff, p_boss_pin_hash: needBoss() });
      await after(['users']);
      return userById(id);
    },
    async bossSetAccess(userId, key, on) {
      await rpc('fn_boss_set_access', { p_user_id: userId, p_key: key, p_on: !!on, p_boss_pin_hash: needBoss() });
      await after(['users']);
    },
    async bossSetRank(userId, rank) {
      if (rank && !App.RANKS.some(r => r.id === rank)) throw E('ONGELDIGE_RANG');
      await rpc('fn_boss_set_rank', { p_user_id: userId, p_rank: rank || null, p_boss_pin_hash: needBoss() });
      await after(['users']);
    },
    async bossSetOrder(ids) {
      if (!Array.isArray(ids) || ids.length !== state.users.length || !state.users.every(u => ids.includes(u.id))) throw E('ONGELDIGE_VOLGORDE');
      await rpc('fn_boss_set_order', { p_order: ids, p_boss_pin_hash: needBoss() });
      await after(['users']);
    },
    async bossMoveUser(userId, dir) {
      const list = state.users.filter(u => !L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);
      const i = list.findIndex(u => u.id === userId), j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await this.bossSetOrder([...list, ...state.users.filter(L.isGangpot)].map(u => u.id));
    },
    async bossSetKlant(customerId, { name, groep, phone, total_geleverd, total_verkocht, total_omzet }, door) {
      const g = Number(total_geleverd), v = Number(total_verkocht), o = Number(total_omzet);
      if (![g, v].every(x => Number.isInteger(x) && x >= 0) || !(o >= 0)) throw E('ONGELDIGE_WAARDE');
      await rpc('fn_boss_set_klant_data', { p_customer_id: customerId, p_name: String(name || '').trim(), p_groep: groep || null, p_phone: phone || null,
        p_total_geleverd: g, p_total_verkocht: v, p_total_omzet: Math.round(o * 100) / 100, p_boss_pin_hash: needBoss(), p_set_by: door });
      await after(['customers', 'customerLog']);
    },
    async bossDeleteKlant(customerId) {
      await rpc('fn_boss_delete_klant', { p_customer_id: customerId, p_boss_pin_hash: needBoss() });
      await after(['customers', 'customerLog']);
    }
  };
})(window.App);
