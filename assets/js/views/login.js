/* Profielkeuze + inloggen / profiel claimen / nieuw profiel. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, R = App.RULES, L = App.L;

  function pinModal({ title, hint, button, withName, onSubmit }) {
    C.modal.open(`
      <h3>${title}</h3>
      <p class="muted">${hint}</p>
      <form class="stack" id="pin-form" autocomplete="off">
        ${withName ? `<label class="field"><span>Naam</span><input class="input" id="pf-name" maxlength="24" placeholder="bv. siebe"></label>` : ''}
        <label class="field"><span>Code</span><input class="input mono pin-input" id="pf-pin" type="password" inputmode="numeric" minlength="4" maxlength="12" placeholder="••••"></label>
        <div class="err" id="pf-err"></div>
        <button class="btn primary block" type="submit">${button}</button>
      </form>`, modal => {
      const form = modal.querySelector('#pin-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        const err = modal.querySelector('#pf-err');
        err.textContent = '';
        C.busy(btn, async () => {
          try {
            await onSubmit(modal.querySelector('#pf-pin').value.trim(), withName ? modal.querySelector('#pf-name').value : null);
          } catch (ex) { err.textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  // de afdeling (of pagina) die in de lobby gekozen werd
  function target({ module: m, page }) {
    const tone = m.tone, icon = m.icon;
    return `
      <div class="auth-target" style="--accent:var(--${tone});--accent-soft:var(--${tone}-soft)">
        <span class="dept-ic">${I(icon, 20)}</span>
        <div><span>Je gaat naar</span><b>${m ? m.name : page.title}</b></div>
        ${m && m.soon ? `<span class="dept-badge soon">${I('sparkle', 11)} In opbouw</span>` : ''}
      </div>`;
  }

  App.views.login = {
    render(ctx) {
      const users = [...ctx.state.users].sort((a, b) => a.sort_order - b.sort_order);
      const tiles = users.map(u => `
        <button class="profile-tile ${u.pin ? '' : 'free'}" data-user="${u.id}">
          ${C.avatar(u, 48)}
          <span class="pt-name">${U.esc(u.name)}</span>${C.rank(u, true)}
          <span class="pt-state"><i></i>${u.pin ? (L.isGangpot(u) ? 'gedeeld' : 'actief') : 'nog vrij'}</span>
        </button>`).join('');
      const add = users.length < R.MAX_USERS ? `
        <button class="profile-tile add" data-add>
          <span class="avatar add-av" style="--s:48px">${I('plus', 20)}</span>
          <span class="pt-name">Nieuw</span><span class="pt-state">${users.length}/${R.MAX_USERS}</span>
        </button>` : '';
      return `
        <div class="auth">
          <div class="auth-card">
            <div class="auth-logo ${ctx.module ? 'sm' : ''}" aria-hidden="true"><div class="lh-ring"></div><img src="assets/img/logo-mark.png" alt=""></div>
            ${ctx.module ? target(ctx) : `<span class="lh-eyebrow">${I('crown', 13)} Gangportaal · familia primero</span>`}
            <h2>Wie ben jij?</h2>
            <p class="muted">Kies je profiel en meld je aan met je persoonlijke code. Eén profiel geldt voor alle afdelingen — daarna kom je in de lobby.</p>
            <div class="profile-grid">${tiles}${add}</div>
            ${App.store.mode === 'demo' ? `<div class="demo-note">${I('sparkle', 14)}<span>${App.CONFIG.demoData
              ? `Demo-modus met nepdata — de code van elk actief profiel is <b class="mono">${App.CONFIG.demoPin}</b>.`
              : `Lege testomgeving — maak je profiel aan met <b>+ Nieuw</b> en kies zelf een code. Bosscode: <b class="mono">${App.CONFIG.demoBossCode}</b>.`}</span></div>` : ''}
          </div>
        </div>`;
    },
    mount(ctx, root) {
      root.querySelectorAll('[data-user]').forEach(tile => tile.addEventListener('click', () => {
        const u = ctx.state.users.find(x => x.id === tile.dataset.user);
        if (u.pin) {
          pinModal({ title: `Inloggen als ${U.esc(u.name)}`, hint: 'Voer je persoonlijke code in.', button: 'Inloggen',
            onSubmit: async pin => { await App.store.login(u.id, pin); C.modal.close(); App.session.set(u.id); C.toast(`Welkom terug, ${U.esc(u.name)}`); } });
        } else {
          pinModal({ title: `Profiel ${U.esc(u.name)} claimen`, hint: 'Dit profiel is nog vrij. Kies een code (min. 4 tekens) — die heb je voortaan nodig om in te loggen.', button: 'Claimen & inloggen',
            onSubmit: async pin => { await App.store.claimProfile(u.id, pin); C.modal.close(); App.session.set(u.id); C.toast('Profiel geclaimd'); } });
        }
      }));
      const add = root.querySelector('[data-add]');
      if (add) add.addEventListener('click', () => pinModal({
        title: 'Nieuw profiel', hint: `Maak je eigen profiel aan (max ${R.MAX_USERS} in totaal).`, button: 'Aanmaken', withName: true,
        onSubmit: async (pin, name) => { const u = await App.store.createProfile(name, pin); C.modal.close(); App.session.set(u.id); C.toast('Profiel aangemaakt'); }
      }));
    }
  };
})(window.App);
