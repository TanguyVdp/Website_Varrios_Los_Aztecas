/* Lobby: startpagina van het gangportaal na het inloggen — merk, kerncijfers en alle afdelingen. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, L = App.L, R = App.RULES;

  // live cijfers per afdeling (enkel voor afdelingen waar al data voor bestaat)
  const STATS = {
    wietloods: ({ snap, mine, state }) => [
      { v: U.num(snap.totals.zakjesKlaar), l: 'zakjes klaar' },
      ...(mine ? [{ v: U.num(mine.momTegoed), l: 'jij kan ophalen' }] : []),
      { v: U.num(state.customers.length), l: U.plural(state.customers.length, 'klant', 'klanten') }
    ],
    amfiloods: ({ state }) => [
      { v: U.num(state.tickets.filter(t => t.status === 'wachtrij').length), l: 'in de wachtrij' },
      { v: U.num(state.tickets.filter(t => t.status === 'bezig').length), l: 'in behandeling' }
    ],
    opslag: ({ state }) => {
      const n = App.missionsToday(state).filter(x => x.done).length;
      return [
        { v: `${n}/${App.MISSIONS.length}`, l: 'missies vandaag' },
        { v: U.num(App.baseItem(state).aantal), l: 'base in de pot' }
      ];
    },
    afwezigheid: ({ state }) => {
      const i = App.absInfo(state);
      return [
        { v: U.num(i.now.length), l: 'nu afwezig' },
        { v: U.num(i.week.length), l: 'komende 7 dagen' }
      ];
    },
    gangpot: ({ snap, state }) => {
      const gp = state.users.find(L.isGangpot);
      return [
        { v: '€ ' + U.num(App.gangpotCash(state)), l: 'cash' },
        ...(gp ? [{ v: U.num(snap.perUser.get(gp.id).tegoed), l: 'zakjes wiet' }] : [])
      ];
    },
    agenda: ({ state }) => {
      const today = U.dkey(new Date()), in7 = U.dkey(U.addDays(new Date(), 7));
      const komend = state.events.filter(e => e.datum >= today).sort((a, b) => (a.datum + (a.tijd || '')).localeCompare(b.datum + (b.tijd || '')));
      return [
        { v: U.num(komend.filter(e => e.datum <= in7).length), l: 'deze week' },
        ...(komend[0] ? [{ v: U.dayLabel(komend[0].datum).replace('.', ''), l: U.esc(komend[0].titel) }] : [])
      ];
    }
  };

  // mededeling van de Boss (gedeeld met boss.js; admin = verwijderknop)
  App.noticeCard = (n, admin) => {
    const k = App.NOTICE.KINDS.find(x => x.id === n.soort) || App.NOTICE.KINDS[0];
    return `
      <article class="notice" style="--accent:var(--${k.tone})">
        <span class="notice-ic">${I(k.icon, 18)}</span>
        <div class="notice-body">
          <div class="notice-top"><b>${U.esc(n.titel)}</b><span class="rpill" style="--accent:var(--${k.tone})">${k.label}</span></div>
          <p>${U.esc(n.tekst)}</p>
          <span class="notice-meta">${I('shield', 11)} ${U.esc(n.door || 'Boss')} · ${U.ago(n.created_at)}</span>
        </div>
        ${admin ? `<button class="abs-del" data-nt-del="${n.id}" title="Verwijderen" aria-label="Verwijderen">${I('trash', 14)}</button>` : ''}
      </article>`;
  };

  function mededelingen({ state }) {
    if (!state.notices.length) return '';
    return `
      <section class="lobby-section">
        <div class="ls-head"><div><span class="eyebrow">Van de Boss</span><h3>Mededelingen</h3></div><span class="muted small">${state.notices.length} ${U.plural(state.notices.length, 'bericht', 'berichten')}</span></div>
        <div class="notice-grid">${state.notices.slice(0, 4).map(n => App.noticeCard(n)).join('')}</div>
      </section>`;
  }

  // klein persoonlijk overzicht: tegoed in de wiet loods + je open ticket(s) met +N bij nieuwe berichten
  function meChips({ me, mine, state }) {
    if (!me || !mine) return '';
    const AM = App.AMFI;
    const chips = App.hasAccess(me, 'wiet') ? [`
      <a class="me-chip" href="#/loods" style="--accent:var(--lime)">
        <span class="me-ic">${I('leaf', 13)}</span>
        <span><b class="mono">${U.num(mine.tegoed)}</b> zakjes tegoed<span class="me-dim"> · <b class="mono">${U.num(mine.momTegoed)}</b> klaar om op te halen</span></span>
      </a>`] : [];
    if (!App.L.isGangpot(me)) {
      const st = App.gangpotStatus(state, me.id);
      if (st.key !== 'betaald') chips.push(`
      <a class="me-chip" href="#/gangpot" style="--accent:var(--${st.key === 'laat' ? 'danger' : 'gold'})">
        <span class="me-ic">${I('crown', 13)}</span>
        <span>Gangpot-bijdrage<span class="me-dim"> · ${st.key === 'laat' ? 'te laat — nog niet betaald' : `nog te betalen tegen ${App.gangpotDueLabel(App.gangpotDue(new Date())).split(' ')[0]}`}</span></span>
      </a>`);
    }
    const own = state.tickets.find(t => t.user_id === me.id && AM.OPEN(t.status));
    if (own) {
      const n = AM.unread(own, me.id), pos = AM.position(state.tickets, own);
      chips.push(`
      <a class="me-chip ${n ? 'has-new' : ''}" href="#/amfi/${own.id}" style="--accent:var(--sky)">
        ${n ? `<i class="me-badge">+${n}</i>` : ''}
        <span class="me-ic">${I('message', 13)}</span>
        <span>Ticket #${String(own.nr).padStart(3, '0')}<span class="me-dim"> · ${n ? `${n === 1 ? 'nieuw bericht' : n + ' nieuwe berichten'}` : own.status === 'wachtrij' ? `plaats ${pos} in de wachtrij` : `in behandeling bij <span class="tcap">${U.esc(own.medewerker_naam)}</span>`}</span></span>
      </a>`);
    }
    if (me.amfi_staff) {
      const handled = state.tickets.filter(t => AM.OPEN(t.status) && t.medewerker_id === me.id);
      const n = handled.reduce((s, t) => s + AM.unread(t, me.id), 0);
      if (n) chips.push(`
      <a class="me-chip has-new" href="#/amfi" style="--accent:var(--sky)">
        <i class="me-badge">+${n}</i><span class="me-ic">${I('flask', 13)}</span>
        <span>Amfi<span class="me-dim"> · ${n === 1 ? 'nieuw bericht' : n + ' nieuwe berichten'} in je tickets</span></span>
      </a>`);
    }
    return `<div class="lh-me">${chips.join('')}</div>`;
  }

  // eerstvolgende activiteit uit de agenda + of jij al geantwoord hebt (aanwezig / misschien / afwezig)
  function nextEventStat({ state, me }) {
    const today = U.dkey(new Date());
    const e = [...(state.events || [])].filter(x => x.datum >= today)
      .sort((a, b) => a.datum.localeCompare(b.datum) || (a.tijd || '').localeCompare(b.tijd || ''))[0];
    if (!e) return `
      <a class="lh-stat ag-sum" href="#/agenda" style="--accent:var(--cyan)">
        <span class="lh-stat-ic">${I('calendar', 15)}</span>
        <div><span class="lh-stat-label">Volgende activiteit</span><span class="ag-sum-title dim">Niets gepland</span><span class="lh-stat-sub">bekijk de agenda</span></div>
      </a>`;
    const t = App.AGENDA.TYPES.find(x => x.id === e.type) || App.AGENDA.TYPES[App.AGENDA.TYPES.length - 1];
    const mine = me && (state.rsvps || []).find(r => r.event_id === e.id && r.user_id === me.id);
    const rs = mine && App.AGENDA.RSVP.find(x => x.id === mine.status);
    const dag = e.datum === today ? 'Vandaag' : e.datum === U.dkey(U.addDays(new Date(), 1)) ? 'Morgen' : U.dayLabel(e.datum);
    return `
      <a class="lh-stat ag-sum" href="#/agenda/${e.id}" style="--accent:var(--${t.tone})" title="Open in de agenda">
        <span class="lh-stat-ic">${I(t.icon, 15)}</span>
        <div>
          <span class="lh-stat-label">Volgende activiteit</span>
          <span class="ag-sum-title">${U.esc(e.titel)}</span>
          <span class="lh-stat-sub">${dag}${e.tijd ? ` · ${e.tijd}` : ''}${e.plaats ? ` · ${U.esc(e.plaats)}` : ''}</span>
          ${rs ? `<span class="ag-sum-rs" style="--accent:var(--${rs.tone})">${I(rs.icon, 11)} Jij: ${rs.label.toLowerCase()}</span>`
               : `<span class="ag-sum-rs open" style="--accent:var(--warn)">${I('alert', 11)} Nog niet gereageerd</span>`}
        </div>
      </a>`;
  }

  function hero(ctx) {
    const { me, snap, state } = ctx;
    const gp = state.users.find(L.isGangpot);
    const leden = state.users.filter(u => u.pin && !L.isGangpot(u)).length;
    const q = snap.queueInfo;
    const now = new Date();
    const d = now.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    const datum = d.charAt(0).toUpperCase() + d.slice(1);
    const stat = (tone, icon, label, value, sub) => `
      <div class="lh-stat" style="--accent:var(--${tone})">
        <span class="lh-stat-ic">${I(icon, 15)}</span>
        <div><span class="lh-stat-label">${label}</span><b class="mono">${value}</b><span class="lh-stat-sub">${sub}</span></div>
      </div>`;
    return `
      <section class="lobby-hero">
        <div class="lh-main">
          <span class="lh-eyebrow">${I('crown', 13)} Varrios Los Aztecas · gangportaal</span>
          ${me ? `
          <h2>Welkom terug,<br><span class="gold-text">${U.esc(me.name)}</span></h2>
          <p class="lh-lead">Alles van de familia op één plek. Kies hieronder een afdeling om verder te gaan.</p>` : `
          <h2>Bienvenido,<br><span class="gold-text">familia</span></h2>
          <p class="lh-lead">Alles van Varrios Los Aztecas op één plek. Kies hieronder een afdeling — daarna meld je je aan met je eigen profiel.</p>`}
          <div class="lh-meta">
            <span>${I('calendar', 13)} ${datum}</span>
            <span class="mono">${I('clock', 13)} ${U.clock(now)}</span>
            <span class="lh-live"><i></i>live gedeeld</span>
          </div>
          ${meChips(ctx)}
        </div>
        <div class="lh-logo" aria-hidden="true">
          <div class="lh-ring"></div>
          <img src="assets/img/logo-mark.png" alt="">
        </div>
        <div class="lh-stats">
          ${nextEventStat(ctx)}
          ${stat('gold', 'users', 'Familia', `${leden}<small>/${R.MAX_USERS}</small>`, 'actieve leden')}
          ${stat('gold', 'crown', 'Gangpot', '€ ' + U.num(App.gangpotCash(state)), 'cash in de pot')}
          <div class="lh-stat mis-sum" style="--accent:var(--warn)">
            <span class="lh-stat-ic">${I('box', 15)}</span>
            <div>
              <span class="lh-stat-label">Missies vandaag</span>
              <div class="mis-lines">${App.missionsToday(state).map(({ m, done }) => `
                <span class="mis-line ${done ? 'done' : ''}" style="--accent:var(--${m.tone})" title="${done ? `${m.label} — gedaan door ${U.esc(done.user_name)} om ${U.clock(done.ts)}` : `${m.label} — nog te doen`}">
                  <i>${done ? I('check', 10) : ''}</i>${m.short}${done ? `<em>${U.esc(done.user_name)}</em>` : ''}
                </span>`).join('')}</div>
            </div>
          </div>
        </div>
      </section>`;
  }

  function deptCard(m, ctx) {
    const stats = STATS[m.id] ? STATS[m.id](ctx) : [];
    return `
      <a class="dept ${m.soon ? 'is-soon' : 'is-live'}" href="#/${m.routes[0].path}" style="--accent:var(--${m.tone});--accent-soft:var(--${m.tone}-soft)">
        <span class="dept-bg">${I(m.icon, 150)}</span>
        <div class="dept-top">
          <span class="dept-ic">${I(m.icon, 22)}</span>
          <span class="dept-badges">${m.access && ctx.me && !App.hasAccess(ctx.me, m.access) ? `<span class="dept-badge noacc">${I('lock', 11)} Geen toegang</span>` : m.locked ? `<span class="dept-badge soon" title="Enkel met code">${I('lock', 11)} Code</span>` : ''}${m.soon ? `<span class="dept-badge soon">${I('sparkle', 11)} In opbouw</span>` : `<span class="dept-badge live"><i></i>Actief</span>`}</span>
        </div>
        <div class="dept-body">
          <h4>${m.name}</h4>
          <p class="dept-tag">${m.tagline}</p>
          <p class="dept-desc">${m.desc}</p>
        </div>
        ${stats.length ? `<div class="dept-stats">${stats.map(s => `<div><b class="mono">${s.v}</b><span>${s.l}</span></div>`).join('')}</div>` : ''}
        ${m.soon && m.plans && !stats.length ? `<div class="dept-plans">${m.plans.slice(0, 3).map(p => `<span>${p}</span>`).join('')}</div>` : ''}
        <div class="dept-foot"><span>${!ctx.me ? 'Kies & meld je aan' : m.soon ? 'Bekijk de plannen' : 'Open ' + m.name}</span><span class="dept-go">${I('arrowRight', 16)}</span></div>
      </a>`;
  }

  App.views.lobby = {
    title: () => 'Lobby',
    render(ctx) {
      const live = App.MODULES.filter(m => !m.soon).length;
      return `
        ${hero(ctx)}
        ${mededelingen(ctx)}
        <section class="lobby-section">
          <div class="ls-head">
            <div><span class="eyebrow">Kies je bestemming</span><h3>Afdelingen</h3></div>
            <span class="muted small">${live} actief · ${App.MODULES.length - live} in opbouw</span>
          </div>
          <div class="dept-grid">${App.MODULES.map(m => deptCard(m, ctx)).join('')}</div>
        </section>
        <footer class="lobby-foot"><img src="assets/img/logo-mark.png" alt=""><span>Varrios Los Aztecas · familia primero</span></footer>`;
    }
  };
})(window.App);