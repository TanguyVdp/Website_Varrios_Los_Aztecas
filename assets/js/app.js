/* App-shell: router, sessie, sidebar/topbar/tabbar, live her-renderen. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, L = App.L, store = App.store;
  // wie ingelogd is, weet de store (Discord via Supabase; in de demo een gekozen profiel). Je blijft ingelogd tot je uitlogt.
  // oude sleutels van het inloggen met codes opruimen
  ['varrios-v2-session'].forEach(k => U.storage.del(k));
  ['varrios-v2-boss', 'varrios-v2-opslag', 'varrios-v2-gangpot', 'varrios-v2-boss-h', 'varrios-v2-opslag-h', 'varrios-v2-gangpot-h']
    .forEach(k => { try { sessionStorage.removeItem(k); } catch (e) { /* privémodus */ } });

  // vaste pagina's + één pagina per route van elke afdeling (afdelingen in opbouw → view 'soon')
  const PAGES = {
    lobby:   { view: 'lobby',   title: 'Lobby',      sub: 'Varrios Los Aztecas · gangportaal', nav: 'lobby' },
    loods:   { view: 'loods',   title: 'Loods',      sub: 'Gezamenlijk voorraadmanifest', nav: 'loods' },
    klanten: { view: 'klanten', title: 'Klanten',    sub: 'Gedeeld klantenbestand',        nav: 'klanten' },
    klant:   { view: 'klant',   title: 'Klant',      sub: 'Klantdetail',                   nav: 'klanten' },
    boss:    { view: 'boss',    title: 'Boss menu',  sub: 'Beheer & volledig overzicht',   nav: 'boss' }
  };
  App.MODULES.forEach(m => m.routes.forEach(r => {
    PAGES[r.path] = { ...(PAGES[r.path] || { view: m.soon ? 'soon' : r.path, title: m.name, sub: m.tagline, nav: r.path }), module: m.id };
  }));
  PAGES.klant.module = 'wietloods';
  App.moduleById = id => App.MODULES.find(m => m.id === id) || null;

  App.session = {
    // demo: profiel kiezen; echte site: naar Discord (komt daarna terug op dezelfde pagina)
    set(id) { return store.signIn(id); },
    clear() { App.go('lobby'); return store.signOut(); }
  };
  App.go = path => { location.hash = '#/' + path; };

  const route = () => {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return parts.length && PAGES[parts[0]] ? parts : ['lobby'];
  };

  // amfi-link: nieuwe berichten in je tickets (roze) gaan voor, anders voor medewerkers de wachtrij (blauw)
  function amfiBadge(state, me) {
    const unread = App.AMFI.unreadFor(state.tickets, me.id);
    if (unread) return `<span class="sb-count new mono" title="nieuwe berichten in je tickets">+${unread}</span>`;
    const q = me.amfi_staff ? state.tickets.filter(t => t.status === 'wachtrij').length : 0;
    return q ? `<span class="sb-count hot mono" title="tickets in de wachtrij">${q}</span>` : '';
  }

  function sidebar(ctx, page) {
    const { me, mine, state } = ctx;
    const link = (path, label, icon, tone, extra = '') =>
      `<a class="sb-link ${page.nav === path ? 'on' : ''}" href="#/${path}" style="--accent:var(--${tone})">${I(icon, 16)}<span>${label}</span>${extra}</a>`;
    const modules = App.MODULES.map(m => `
      <div class="sb-group">
        <div class="sb-label"><i class="sb-dot" style="--accent:var(--${m.tone})"></i>${m.name}${m.soon ? '<span class="soon">binnenkort</span>' : m.onderhoud ? '<span class="soon">onderhoud</span>' : ''}${m.access && !App.hasAccess(me, m.access) ? `<span class="sb-lock" title="Geen toegang">${I('lock', 11)}</span>` : ''}</div>
        ${m.routes.map(r => link(r.path, r.label, r.icon, m.tone, r.path === 'klanten' ? `<span class="sb-count mono">${state.customers.length}</span>`
          : r.path === 'amfi' ? amfiBadge(state, me) : '')).join('')}
      </div>`).join('');
    return `
      <a class="sb-brand" href="#/lobby"><img src="assets/img/logo.png" alt="Varrios Los Aztecas" class="brand-logo"><div><b>Varrios</b><span>Los Aztecas · gangportaal</span></div></a>
      <div class="sb-group">${link('lobby', 'Lobby', 'home', 'gold')}</div>
      ${modules}
      ${App.can('boss') ? `<div class="sb-group"><div class="sb-label">Beheer</div>${link('boss', 'Boss menu', 'shield', 'violet')}</div>` : ''}
      <div class="sb-spacer"></div>
      <div class="sb-status">${store.mode === 'demo' ? `<span class="status demo">${I('sparkle', 12)} demo-modus</span>` : ''}<span class="status live"><i></i>live gedeeld</span></div>
      <button class="sb-user" data-profile>
        ${C.avatar(me, 34)}
        <div><b>${U.esc(me.name)} ${C.rank(me, true)}</b><span><span class="lime mono">${U.num(mine.momTegoed)}</span> klaar · <span class="mono">${U.num(mine.tegoed)}</span> tegoed</span></div>
        ${I('gear', 15)}
      </button>
      <button class="sb-logout" data-logout>${I('logout', 15)}<span>Uitloggen</span></button>`;
  }

  function topbar(ctx, page, view) {
    const title = view.title ? view.title(ctx) : page.title;
    const mod = page.module ? App.moduleById(page.module) : null;
    return `
      <div class="tb-left">
        <a href="#/lobby" class="tb-logo-link" aria-label="Naar de lobby"><img src="assets/img/logo.png" alt="" class="brand-logo tb-logo"></a>
        <div>
          ${mod ? `<a class="tb-crumb" href="#/lobby" style="--accent:var(--${mod.tone})">Lobby ${I('chevronRight', 11)} <span>${mod.name}</span></a>` : ''}
          <h1>${U.esc(title)}</h1>${mod ? '' : `<p>${page.sub}</p>`}
        </div>
      </div>
      <div class="tb-right">
        ${store.mode === 'demo' ? `<span class="status demo">${I('sparkle', 12)} demo</span>` : ''}
        <span class="status live"><i></i>live</span>
        ${bossBtn()}
        <button class="tb-avatar" data-profile aria-label="Profiel">${C.avatar(ctx.me, 32)}</button>
      </div>`;
  }

  // mobiel: Lobby + de routes van de afdeling waar je zit (standaard Wiet loods) + Boss
  function tabbar(page) {
    const mod = App.moduleById(page.module) || App.moduleById('wietloods');
    const tab = (path, label, icon, tone) => `<a class="tab ${page.nav === path ? 'on' : ''}" href="#/${path}" style="--accent:var(--${tone})">${I(icon, 19)}<span>${label}</span></a>`;
    return tab('lobby', 'Lobby', 'home', 'gold')
      + mod.routes.map(r => tab(r.path, mod.routes.length > 1 ? r.label : mod.name, r.icon, mod.tone)).join('')
      + (App.can('boss') ? tab('boss', 'Boss', 'shield', 'violet') : '');
  }

  // enkel voor wie het Boss menu mag openen
  const bossBtn = () => App.boss.unlocked() ? `<button class="boss-btn on" data-boss title="Boss menu">${I('shield', 15)}<span>Boss menu</span><i></i></button>` : '';

  // eigen profiel: foto, uitloggen
  function profileModal(ctx) {
    const { me, mine } = ctx;
    C.modal.open(`
      <div class="profile-head">
        <button class="avatar-edit" id="pm-photo" title="Profielfoto wijzigen">${C.avatar(me, 60)}<span>${I('pencil', 12)}</span></button>
        <div><h3>${U.esc(me.name)} ${C.rank(me)}</h3><p class="muted small">lid sinds ${U.date(me.created_at)}</p></div>
      </div>
      ${mine ? `<div class="mini-stats">
        <div><span>Klaar</span><b class="mono lime">${U.num(mine.momTegoed)}</b></div>
        <div><span>Tegoed</span><b class="mono">${U.num(mine.tegoed)}</b></div>
        <div><span>Ingelegd</span><b class="mono">${U.num(me.total_ingelegd)}</b></div>
      </div>` : ''}
      <div class="mng-block">
        <span class="eyebrow">Profielfoto</span>
        <div class="row-2">
          <button class="btn ghost" id="pm-photo-pick">${I('user', 14)} ${me.avatar_url ? 'Andere foto kiezen' : 'Foto kiezen'}</button>
          <button class="btn ghost danger-text" id="pm-photo-del" ${me.avatar_url ? '' : 'disabled'}>${I('trash', 14)} Foto verwijderen</button>
        </div>
      </div>
      <div class="mng-block">
        <span class="eyebrow">Rechten</span>
        <div class="perm-chips">${me.owner ? `<span class="rpill" style="--accent:var(--gold)">${I('crown', 11)}Eigenaar — alles</span>`
          : App.ACCESS.filter(a => App.hasAccess(me, a.key)).map(a => `<span class="rpill" style="--accent:var(--${a.tone})">${I(a.icon, 11)}${a.label}${a.hint ? ` (${a.hint})` : ''}</span>`).join('') || '<span class="dim small">Nog geen extra rechten.</span>'}</div>
        <p class="dim small">${store.mode === 'demo' ? 'Demo: je bent ingelogd met een gekozen profiel.' : 'Je bent ingelogd met Discord.'} Rechten geeft de Boss in <b>Boss menu → Ledenlijst</b>.</p>
      </div>
      <div class="stack">
        <button class="btn ghost block" id="pm-logout">${I('logout', 15)} Uitloggen</button>
        ${store.mode === 'demo' ? `<button class="btn ghost block danger-text" id="pm-reset">${I('refresh', 15)} Demo-data resetten</button>` : ''}
      </div>`, modal => {
      const $ = q => modal.querySelector(q);
      const pick = () => { C.modal.close(); C.pickAvatar(me.id); };
      $('#pm-photo').addEventListener('click', pick);
      $('#pm-photo-pick').addEventListener('click', pick);
      $('#pm-photo-del').addEventListener('click', e => C.busy(e.currentTarget, async () => { await store.setAvatar(me.id, null); C.modal.close(); C.toast('Profielfoto verwijderd'); }));
      $('#pm-logout').addEventListener('click', () => { C.modal.close(); App.session.clear(); C.toast('Uitgelogd'); });
      $('#pm-reset')?.addEventListener('click', async () => { await store.resetDemo(); C.modal.close(); App.session.clear(); C.toast('Demo-data gereset'); });
    }, { wide: true });
  }
  App.openProfile = () => profileModal(buildCtx());

  // afdeling zonder toegang (vinkje in Boss menu → Ledenlijst)
  const noAccessView = m => ({
    title: () => m.name,
    render: () => `
      <section class="card boss-lock noaccess" style="--accent:var(--${m.tone})">
        <span class="lock-ic tone">${I('lock', 26)}</span>
        <h2>Geen toegang tot ${m.name}</h2>
        <p class="muted">Je profiel heeft (nog) geen toegang tot deze afdeling. Vraag de Boss om je aan te vinken in <b>Boss menu → Ledenlijst</b>.</p>
        <a class="btn ghost" href="#/lobby">${I('back', 14)} Terug naar de lobby</a>
      </section>`
  });

  // afdeling in onderhoud (App.MODULES → onderhoud: 'uitleg'); wie het Boss menu heeft, kan toch binnen kijken (deze sessie)
  const PEEK = id => 'varrios-v2-peek-' + id;
  const peeking = id => { try { return sessionStorage.getItem(PEEK(id)) === '1'; } catch (e) { return false; } };
  const moduleOnderhoudView = m => ({
    title: () => m.name,
    render: () => `
      <section class="card boss-lock noaccess mod-onderhoud" style="--accent:var(--${m.tone})">
        <span class="lock-ic tone">${I(m.icon, 26)}</span>
        <span class="rpill" style="--accent:var(--warn)">${I('clock', 11)}In onderhoud</span>
        <h2>${m.name} is nog even dicht</h2>
        <p class="muted">${U.esc(m.onderhoud)}</p>
        <p class="dim small">Zodra de ${m.name.toLowerCase()} open gaat, laat de Boss het weten.</p>
        <div class="row-2">
          <a class="btn ghost" href="#/lobby">${I('back', 14)} Terug naar de lobby</a>
          ${App.can('boss') ? `<button class="btn ghost" data-peek="${m.id}">${I('shield', 14)} Toch openen (Boss)</button>` : ''}
        </div>
      </section>`,
    mount: (ctx, root) => root.querySelector('[data-peek]')?.addEventListener('click', e => {
      try { sessionStorage.setItem(PEEK(e.currentTarget.dataset.peek), '1'); } catch (ex) { /* privémodus */ }
      App.rerender();
    })
  });

  function buildCtx() {
    const state = store.state;
    const snap = L.snapshot(state);
    const id = store.auth.userId;
    const me = id ? state.users.find(u => u.id === id) || null : null;
    App.me = me;
    const r = route();
    return { state, snap, me, mine: me ? snap.perUser.get(me.id) : null, params: r.slice(1), page: PAGES[r[0]], module: App.moduleById(PAGES[r[0]].module) };
  }

  let lastRoute = '';
  App.rerender = function () {
    if (!store.state) return;   // database nog aan het laden
    const ctx = buildCtx();
    const r = route();
    const page = PAGES[r[0]];
    // website in onderhoud (Boss menu → Website) → enkel wie het Boss menu mag openen, komt verder
    const onderhoud = !!ctx.state.settings.site_onderhoud && !App.can('boss');
    const authed = !!ctx.me && !onderhoud;
    // niet ingelogd → eerst inloggen; daarna kom je op de lobby (of op de pagina uit je link)
    const blocked = authed && ctx.module && ctx.module.access && !App.hasAccess(ctx.me, ctx.module.access);
    const modOnderhoud = authed && ctx.module && ctx.module.onderhoud && !(App.can('boss') && peeking(ctx.module.id));
    const view = onderhoud ? App.views.onderhoud : !authed ? App.views.login : modOnderhoud ? moduleOnderhoudView(ctx.module)
      : blocked ? noAccessView(ctx.module) : App.views[page.view];
    document.body.classList.toggle('is-auth', !authed);

    const viewEl = document.getElementById('view');
    const routeKey = onderhoud ? 'onderhoud' : authed ? r.join('/') : 'login/' + r[0];
    const isNewPage = routeKey !== lastRoute;
    lastRoute = routeKey;

    if (authed) {
      document.getElementById('sidebar').innerHTML = sidebar(ctx, page);
      document.getElementById('topbar').innerHTML = topbar(ctx, page, view);
      document.getElementById('tabbar').innerHTML = tabbar(page);
      document.querySelectorAll('[data-profile]').forEach(b => b.addEventListener('click', () => profileModal(buildCtx())));
      document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', () => { App.session.clear(); C.toast('Uitgelogd'); }));
      document.title = `${view.title ? view.title(ctx) : page.title} — Varrios`;
    } else {
      document.title = onderhoud ? 'Varrios Los Aztecas — Onderhoud' : 'Varrios Los Aztecas — Inloggen';
    }
    viewEl.classList.toggle('enter', isNewPage);
    viewEl.innerHTML = view.render(ctx);
    document.querySelectorAll('[data-boss]').forEach(b => b.addEventListener('click', () => App.boss.open()));
    if (view.mount) view.mount(ctx, viewEl);
    if (isNewPage) window.scrollTo(0, 0);
  };

  // live: elke wijziging in de store -> opnieuw tekenen (later: Supabase Realtime)
  store.subscribe(() => App.rerender());
  window.addEventListener('hashchange', App.rerender);
  // wachtrij schuift op met de tijd: periodiek hertekenen, maar niet terwijl iemand typt
  setInterval(() => {
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
    if (!typing && !C.modal.isOpen()) App.rerender();
  }, 15000);

  // Ctrl+R / F5 (herladen) → altijd terug naar de lobby; een link openen blijft wel op die pagina
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.type === 'reload' && location.hash !== '#/lobby') history.replaceState(null, '', location.pathname + location.search + '#/lobby');
  } catch (e) { /* oude browser: dan gewoon blijven waar je was */ }

  // de echte database laadt eerst alles in (store.ready); de demo-store is meteen klaar
  const viewEl = document.getElementById('view');
  document.body.classList.add('is-auth');
  viewEl.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-logo" aria-hidden="true"><div class="lh-ring"></div><img src="assets/img/logo-mark.png" alt=""></div><p class="muted">Gangportaal wordt geladen…</p></div></div>`;
  Promise.resolve(store.ready).then(() => App.rerender(), e => {
    console.error(e);
    viewEl.innerHTML = `<div class="auth"><div class="auth-card"><span class="lock-ic" style="margin:0 auto 12px">${I('alert', 26)}</span><h2>Kan de database niet bereiken</h2>
      <p class="muted">${U.esc(U.friendlyError(e))}</p><button class="btn ghost" onclick="location.reload()">${I('refresh', 14)} Opnieuw proberen</button></div></div>`;
  });
})(window.App);