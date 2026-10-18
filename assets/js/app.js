/* App-shell: router, sessie, sidebar/topbar/tabbar, live her-renderen. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, L = App.L, store = App.store;
  const SESSION_KEY = 'varrios-v2-session';
  // een login geldt enkel voor vandaag: na middernacht moet iedereen opnieuw inloggen
  // (bij uitloggen gaan ook de boss-, opslag- en gangpot-code weer op slot)
  const LOCK_KEYS = ['varrios-v2-boss', 'varrios-v2-opslag', 'varrios-v2-gangpot', 'varrios-v2-boss-h', 'varrios-v2-opslag-h', 'varrios-v2-gangpot-h'];
  const today = () => U.dkey(new Date());
  const readSession = () => {
    try { const s = JSON.parse(U.storage.get(SESSION_KEY)); return s && s.id && s.day === today() ? s.id : null; }
    catch (e) { return null; }
  };
  const lockAll = () => LOCK_KEYS.forEach(k => { try { sessionStorage.removeItem(k); } catch (e) { /* privémodus */ } });
  let session = readSession();
  let sessionDay = session ? today() : null;
  if (!session && U.storage.get(SESSION_KEY)) { U.storage.del(SESSION_KEY); lockAll(); }

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
    // na het inloggen blijf je op de afdeling die je in de lobby koos
    set(id) { session = id; sessionDay = today(); U.storage.set(SESSION_KEY, JSON.stringify({ id, day: sessionDay })); App.rerender(); },
    clear() { session = null; sessionDay = null; U.storage.del(SESSION_KEY); lockAll(); App.go('lobby'); App.rerender(); }
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
        <div class="sb-label"><i class="sb-dot" style="--accent:var(--${m.tone})"></i>${m.name}${m.soon ? '<span class="soon">binnenkort</span>' : ''}${m.access && !App.hasAccess(me, m.access) ? `<span class="sb-lock" title="Geen toegang">${I('lock', 11)}</span>` : ''}</div>
        ${m.routes.map(r => link(r.path, r.label, r.icon, m.tone, r.path === 'klanten' ? `<span class="sb-count mono">${state.customers.length}</span>`
          : r.path === 'amfi' ? amfiBadge(state, me) : '')).join('')}
      </div>`).join('');
    return `
      <a class="sb-brand" href="#/lobby"><img src="assets/img/logo.png" alt="Varrios Los Aztecas" class="brand-logo"><div><b>Varrios</b><span>Los Aztecas · gangportaal</span></div></a>
      <div class="sb-group">${link('lobby', 'Lobby', 'home', 'gold')}</div>
      ${modules}
      <div class="sb-group"><div class="sb-label">Beheer</div>${link('boss', 'Boss menu', 'shield', 'violet')}</div>
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
      + tab('boss', 'Boss', 'shield', 'violet');
  }

  const bossBtn = () => `<button class="boss-btn ${App.boss.unlocked() ? 'on' : ''}" data-boss title="Boss menu">${I('shield', 15)}<span>Boss menu</span>${App.boss.unlocked() ? '<i></i>' : ''}</button>`;

  // eigen profiel: foto, code wijzigen, uitloggen
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
      <form class="mng-block" id="pm-pin" autocomplete="off">
        <span class="eyebrow">Code wijzigen</span>
        <div class="row-3">
          <input class="input mono" id="pm-old" type="password" inputmode="numeric" maxlength="12" placeholder="huidige">
          <input class="input mono" id="pm-new" type="password" inputmode="numeric" maxlength="12" placeholder="nieuwe">
          <input class="input mono" id="pm-new2" type="password" inputmode="numeric" maxlength="12" placeholder="herhaal">
        </div>
        <div class="err" id="pm-err"></div>
        <button class="btn violet block" type="submit">${I('lock', 14)} Code wijzigen</button>
        <p class="dim small">Code vergeten? Vraag de Boss om je code te resetten — daarna kies je bij het inloggen een nieuwe.</p>
      </form>
      <div class="stack">
        <button class="btn ghost block" id="pm-logout">${I('logout', 15)} Uitloggen</button>
        ${store.mode === 'demo' ? `<button class="btn ghost block danger-text" id="pm-reset">${I('refresh', 15)} Demo-data resetten</button>` : ''}
      </div>`, modal => {
      const $ = q => modal.querySelector(q);
      const pick = () => { C.modal.close(); C.pickAvatar(me.id); };
      $('#pm-photo').addEventListener('click', pick);
      $('#pm-photo-pick').addEventListener('click', pick);
      $('#pm-photo-del').addEventListener('click', e => C.busy(e.currentTarget, async () => { await store.setAvatar(me.id, null); C.modal.close(); C.toast('Profielfoto verwijderd'); }));
      $('#pm-pin').addEventListener('submit', e => {
        e.preventDefault();
        C.busy($('#pm-pin button[type=submit]'), async () => {
          $('#pm-err').textContent = '';
          try {
            if ($('#pm-new').value !== $('#pm-new2').value) throw new Error('CODES_VERSCHILLEN');
            await store.changePin(me.id, $('#pm-old').value, $('#pm-new').value);
            C.modal.close(); C.toast('Code gewijzigd');
          } catch (ex) { $('#pm-err').textContent = U.friendlyError(ex); }
        });
      });
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

  function buildCtx() {
    const state = store.state;
    const snap = L.snapshot(state);
    let me = session ? state.users.find(u => u.id === session) || null : null;
    if (session && !me) { session = null; U.storage.del(SESSION_KEY); }
    const r = route();
    return { state, snap, me, mine: me ? snap.perUser.get(me.id) : null, params: r.slice(1), page: PAGES[r[0]], module: App.moduleById(PAGES[r[0]].module) };
  }

  let lastRoute = '';
  App.rerender = function () {
    if (!store.state) return;   // database nog aan het laden
    const ctx = buildCtx();
    const r = route();
    const page = PAGES[r[0]];
    // website in onderhoud (Boss menu → Website) → enkel wie de bosscode ingaf, komt verder
    const onderhoud = App.preview.blocked(ctx.state);
    if (!ctx.state.settings.site_onderhoud && App.preview.ok()) App.preview.set(false);
    const authed = !!ctx.me && !onderhoud;
    // niet ingelogd → altijd eerst "Wie ben jij?"; daarna kom je op de lobby (of op de pagina uit je link)
    const blocked = authed && ctx.module && ctx.module.access && !App.hasAccess(ctx.me, ctx.module.access);
    const view = onderhoud ? App.views.onderhoud : !authed ? App.views.login : blocked ? noAccessView(ctx.module) : App.views[page.view];
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
  // nieuwe dag → uitloggen (ook na slaapstand: check bij terugkeren naar het tabblad)
  const expired = () => {
    if (!session || sessionDay === today()) return false;
    C.modal.close(); App.session.clear(); C.toast('Nieuwe dag — log opnieuw in');
    return true;
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) expired(); });
  window.addEventListener('focus', expired);
  setInterval(() => {
    if (expired()) return;
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