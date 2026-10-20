/* Inloggen. Echte site: met Discord (je profiel wordt gevonden via het Discord-ID dat de Boss invulde in de Ledenlijst).
 * Demo: een profiel kiezen (of een nieuw maken — het eerste wordt de eigenaar). */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, R = App.RULES, L = App.L;

  const DISCORD_SVG = '<svg class="discord-logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';
  App.discordLogo = DISCORD_SVG;

  // de afdeling (of pagina) uit je link
  function target({ module: m, page }) {
    if (!m) return '';
    return `
      <div class="auth-target" style="--accent:var(--${m.tone});--accent-soft:var(--${m.tone}-soft)">
        <span class="dept-ic">${I(m.icon, 20)}</span>
        <div><span>Je gaat naar</span><b>${m ? m.name : page.title}</b></div>
        ${m.soon ? `<span class="dept-badge soon">${I('sparkle', 11)} In opbouw</span>` : ''}
      </div>`;
  }
  const head = ctx => `
    <div class="auth-logo ${ctx.module ? 'sm' : ''}" aria-hidden="true"><div class="lh-ring"></div><img src="assets/img/logo-mark.png" alt=""></div>
    ${ctx.module ? target(ctx) : `<span class="lh-eyebrow">${I('crown', 13)} Gangportaal · familia primero</span>`}`;

  App.discordButton = (label = 'Inloggen met Discord') => `<button class="btn discord-btn-lg" data-discord-login>${DISCORD_SVG}<span>${label}</span></button>`;
  App.bindDiscordLogin = root => root.querySelectorAll('[data-discord-login]').forEach(b => b.addEventListener('click', () => C.busy(b, async () => {
    try { await App.store.signIn(); } catch (ex) { C.toast(U.friendlyError(ex)); }
  })));

  // echte site: niet ingelogd / Discord niet gekoppeld
  function discordView(ctx) {
    const a = App.store.auth;
    if (a.status === 'anon') return `
      <div class="auth"><div class="auth-card">
        ${head(ctx)}
        <h2>Welkom bij de familia</h2>
        <p class="muted">Log in met je Discord-account. Eén keer inloggen volstaat: je blijft ingelogd op dit toestel tot je zelf uitlogt.</p>
        ${a.error ? `<div class="err center">Inloggen lukte niet: ${U.esc(a.error)}</div>` : ''}
        ${App.discordButton()}
        <p class="dim small">Nog geen toegang? De Boss koppelt je Discord aan je profiel.</p>
      </div></div>`;
    return `
      <div class="auth"><div class="auth-card">
        ${head(ctx)}
        <h2>Nog niet gekoppeld</h2>
        <p class="muted">Je bent ingelogd met Discord${a.discordName ? ` als <b>${U.esc(a.discordName)}</b>` : ''}, maar je account hoort nog bij geen enkel profiel.
          Stuur dit ID naar de Boss — die vult het in bij jouw profiel in <b>Boss menu → Ledenlijst</b>.</p>
        <div class="discord-id-box">
          <span class="dim small">Jouw Discord-ID</span>
          <b class="mono" id="my-discord-id">${U.esc(a.discordId || '—')}</b>
          <button class="btn ghost sm" data-copy-id>${I('check', 13)} Kopiëren</button>
        </div>
        <div class="row-2">
          <button class="btn ghost" onclick="location.reload()">${I('refresh', 14)} Opnieuw proberen</button>
          <button class="btn ghost" data-signout>${I('logout', 14)} Ander account</button>
        </div>
      </div></div>`;
  }

  // demo: profiel kiezen
  function demoView(ctx) {
    const users = [...ctx.state.users].filter(u => !L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);
    const tiles = users.map(u => `
      <button class="profile-tile" data-user="${u.id}">
        ${C.avatar(u, 48)}
        <span class="pt-name">${U.esc(u.name)}</span>${C.rank(u, true)}
        <span class="pt-state"><i></i>${u.owner ? 'eigenaar' : App.hasAccess(u, 'boss') ? 'boss' : 'lid'}</span>
      </button>`).join('');
    const add = ctx.state.users.length < R.MAX_USERS ? `
      <button class="profile-tile add" data-add>
        <span class="avatar add-av" style="--s:48px">${I('plus', 20)}</span>
        <span class="pt-name">Nieuw</span><span class="pt-state">${ctx.state.users.length}/${R.MAX_USERS}</span>
      </button>` : '';
    return `
      <div class="auth"><div class="auth-card">
        ${head(ctx)}
        <h2>Wie ben jij?</h2>
        <p class="muted">Demo: kies een profiel om in te loggen. Op de echte site log je in met Discord.</p>
        <div class="profile-grid">${tiles}${add}</div>
        <div class="demo-note">${I('sparkle', 14)}<span>${users.length ? 'Demo-modus — het eerste profiel is de eigenaar (alle rechten).' : 'Lege testomgeving — maak je profiel aan met <b>+ Nieuw</b>: het eerste profiel wordt de eigenaar.'}</span></div>
      </div></div>`;
  }

  App.views.login = {
    render: ctx => App.store.mode === 'demo' ? demoView(ctx) : discordView(ctx),
    mount(ctx, root) {
      App.bindDiscordLogin(root);
      root.querySelector('[data-signout]')?.addEventListener('click', () => App.store.signOut());
      root.querySelector('[data-copy-id]')?.addEventListener('click', async e => {
        const id = App.store.auth.discordId || '';
        try { await navigator.clipboard.writeText(id); C.toast('Discord-ID gekopieerd'); }
        catch (ex) { const r = document.createRange(); r.selectNodeContents(root.querySelector('#my-discord-id')); getSelection().removeAllRanges(); getSelection().addRange(r); e.currentTarget.textContent = 'Geselecteerd — Ctrl+C'; }
      });
      root.querySelectorAll('[data-user]').forEach(tile => tile.addEventListener('click', () => C.busy(tile, async () => {
        const u = ctx.state.users.find(x => x.id === tile.dataset.user);
        await App.session.set(u.id); C.toast(`Welkom terug, ${U.esc(u.name)}`);
      })));
      root.querySelector('[data-add]')?.addEventListener('click', () => C.modal.open(`
        <h3>Nieuw profiel</h3>
        <p class="muted">Demo: maak een profiel aan (max ${R.MAX_USERS} in totaal).</p>
        <form class="stack" id="np-form" autocomplete="off">
          <label class="field"><span>Naam</span><input class="input" id="np-name" maxlength="24" placeholder="bv. siebe"></label>
          <div class="err" id="np-err"></div>
          <button class="btn primary block" type="submit">Aanmaken</button>
        </form>`, modal => {
        const form = modal.querySelector('#np-form');
        form.addEventListener('submit', e => {
          e.preventDefault();
          C.busy(form.querySelector('button[type=submit]'), async () => {
            try { await App.store.createProfile(modal.querySelector('#np-name').value); C.modal.close(); C.toast('Profiel aangemaakt'); }
            catch (ex) { modal.querySelector('#np-err').textContent = U.friendlyError(ex); }
          });
        });
      }));
    }
  };
})(window.App);
