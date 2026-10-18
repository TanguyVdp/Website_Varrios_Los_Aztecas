/* Gangpot: wat er in de kas van de familia zit. Bekijken mag iedereen; aanpassen kan enkel met de gangpot-code
 * (of via het Boss menu). De zakjes van het gangpot-profiel in de Wiet loods komen er automatisch bij. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, L = App.L;

  // net als de opslag loods onthoudt de sessie de ingegeven code: wijzigt de Boss ze, dan is het meteen weer dicht
  const KEY = 'varrios-v2-gangpot';
  App.gangpot = {
    unlocked: () => { try { return sessionStorage.getItem(KEY) === App.store.state.settings.gangpot_code; } catch (e) { return false; } },
    canEdit: () => App.gangpot.unlocked() || App.boss.unlocked(),
    lock: silent => { try { sessionStorage.removeItem(KEY); } catch (e) { /* */ } if (!silent) C.toast('Gangpot vergrendeld'); App.rerender(); },
    open() {
      if (App.gangpot.canEdit()) return;
      C.codeModal({
        title: 'Gangpot aanpassen', icon: 'vault', tone: 'gold',
        sub: `Bekijken mag iedereen — aanpassen vraagt de gangpot-code.${App.store.mode === 'demo' ? ` <span class="dim">(demo: ${U.esc(App.store.state.settings.gangpot_code)})</span>` : ''}`,
        verify: code => App.store.verifyGangpot(code),
        onOk: () => { try { sessionStorage.setItem(KEY, App.store.state.settings.gangpot_code); } catch (e) { /* */ } C.toast('Gangpot ontgrendeld — je kan nu aanpassen'); App.rerender(); }
      });
    }
  };

  // ---------- wekelijkse bijdrage ----------
  // vervaldag (woensdag) van de week (ma–zo) waarin `d` valt, als 'YYYY-MM-DD'
  App.gangpotDue = d => U.dkey(U.addDays(U.startOfWeek(d), (App.GANGPOT_DUE_DAY + 6) % 7));
  App.gangpotPaid = (state, userId, week) => (state.gangpotPayments || []).find(p => p.user_id === userId && p.week === week) || null;
  App.gangpotMembers = state => state.users.filter(u => !App.L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);
  // status voor deze week: betaald / open (vervaldag nog niet voorbij) / laat
  App.gangpotStatus = (state, userId, week = App.gangpotDue(new Date())) => {
    const p = App.gangpotPaid(state, userId, week);
    if (p) return { key: 'betaald', label: 'Betaald', tone: 'lime', icon: 'check', paid: p };
    return U.dkey(new Date()) > week ? { key: 'laat', label: 'Te laat', tone: 'danger', icon: 'alert' } : { key: 'open', label: 'Nog te betalen', tone: 'warn', icon: 'clock' };
  };
  const dueLabel = week => U.parseDay(week).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  App.gangpotDueLabel = dueLabel;

  function bijdrageCard(state) {
    const week = App.gangpotDue(new Date());
    const leden = App.gangpotMembers(state);
    const betaald = leden.filter(u => App.gangpotPaid(state, u.id, week)).length;
    const weeks = Array.from({ length: 6 }, (_, i) => App.gangpotDue(U.addDays(new Date(), -7 * (5 - i))));
    const short = w => { const d = U.parseDay(w); return `${d.getDate()}/${d.getMonth() + 1}`; };
    return `
      <section class="card">
        ${C.cardHead('Bijdrage deze week', 'users', `<span class="muted small">te betalen tegen <b>${dueLabel(week)}</b> · <b class="mono ${betaald === leden.length ? 'lime' : 'gold'}">${betaald}/${leden.length}</b> betaald</span>`)}
        <div class="pay-progress"><span style="width:${leden.length ? (betaald / leden.length * 100).toFixed(1) : 0}%"></span></div>
        <div class="pay-list">
          <div class="pay-row pay-head"><span>Lid</span><span>Deze week</span><span class="pay-weeks">${weeks.map(w => `<i title="week van ${short(w)}">${short(w)}</i>`).join('')}</span></div>
          ${leden.map(u => { const st = App.gangpotStatus(state, u.id, week); return `
          <div class="pay-row">
            <span class="pay-who">${C.avatar(u, 28)}<b class="tcap">${U.esc(u.name)}</b>${C.rank(u, true)}</span>
            <span><span class="rpill" style="--accent:var(--${st.tone})">${I(st.icon, 11)}${st.label}</span>${st.paid ? `<em class="pay-when">${U.date(st.paid.paid_at)}</em>` : ''}</span>
            <span class="pay-weeks">${weeks.map(w => { const p = App.gangpotPaid(state, u.id, w); const cur = w === week;
              return `<i class="pw ${p ? 'ok' : cur && U.dkey(new Date()) <= w ? 'open' : 'miss'}" title="week van ${short(w)}: ${p ? 'betaald' : cur && U.dkey(new Date()) <= w ? 'nog te betalen' : 'niet betaald'}">${p ? I('check', 11) : ''}</i>`; }).join('')}</span>
          </div>`; }).join('') || C.empty('Nog geen leden.', 'users')}
        </div>
        <p class="dim small pay-note">De Boss vinkt af wie betaald heeft (Boss menu → Gangpot bijhouden).</p>
      </section>`;
  }
  App.gangpotBijdrageCard = bijdrageCard;

  App.gangpotCash = state => state.gangpot.items.filter(i => i.eenheid === '€').reduce((s, i) => s + i.aantal, 0);

  App.views.gangpot = {
    title: () => 'Gangpot',
    render({ state, snap }) {
      const items = [...state.gangpot.items].sort((a, b) => a.sort_order - b.sort_order);
      const log = [...state.gangpot.log].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 20);
      const gp = state.users.find(L.isGangpot);
      const edit = App.gangpot.canEdit();
      return `
        <section class="abs-hero gp-hero">
          <div class="gp-hero-logo"><img src="assets/img/logo-mark.png" alt=""></div>
          <div class="abs-hero-text">
            <span class="lh-eyebrow">${I('crown', 13)} Gangpot</span>
            <h2>De kas van de <span class="gold-text">familia</span></h2>
            <p class="muted">Wat er in de gangpot zit. Iedereen kan meekijken — aanpassen kan enkel met de gangpot-code.</p>
          </div>
          <div class="gp-total">
            <span>Cash totaal</span>
            <b class="mono gold-text">€ ${U.num(App.gangpotCash(state))}</b>
            ${edit
              ? `<div class="gp-edit-on"><span class="rpill" style="--accent:var(--lime)">${I('pencil', 11)}Bewerken aan</span>${App.gangpot.unlocked() ? `<button class="btn ghost sm" data-gp-lock>${I('lock', 13)} Vergrendelen</button>` : ''}</div>`
              : `<button class="btn ghost" data-aanpassen>${I('lock', 14)} Aanpassen (code)</button>`}
          </div>
        </section>
        <section class="card">
          ${C.cardHead('Inhoud', 'vault', edit ? `<button class="btn gold sm" data-gp-new>${I('plus', 13)} Item toevoegen</button>` : `<span class="muted small">${items.length + (gp ? 1 : 0)} items</span>`)}
          ${edit ? App.gangpotEditGrid(items) : ''}
          <div class="gp-grid ${edit ? 'gp-auto-row' : ''}">
            ${edit ? '' : items.map(it => `<div class="gp-item"><div class="gp-top"><span>${U.esc(it.naam)}</span></div><b class="mono">${App.boss.fmtItem(it)}</b></div>`).join('')}
            ${gp ? `<div class="gp-item auto"><div class="gp-top"><span>Zakjes wiet</span><span class="rpill" style="--accent:var(--lime)">${I('leaf', 11)}automatisch</span></div><b class="mono">${U.num(snap.perUser.get(gp.id).tegoed)} <small>zakjes</small></b><span class="gp-sub">1 op ${App.RULES.GANGPOT_DEEL} van elke inleg in de Wiet loods</span></div>` : ''}
          </div>
        </section>
        ${bijdrageCard(state)}
        <section class="card">
          ${C.cardHead('Historiek', 'list', `<span class="muted small">${state.gangpot.log.length} wijzigingen</span>`)}
          <div class="feed">${log.map(App.gangpotFeedItem).join('') || C.empty('Nog geen wijzigingen.')}</div>
        </section>`;
    },
    mount(ctx, root) {
      root.querySelector('[data-aanpassen]')?.addEventListener('click', () => App.gangpot.open());
      root.querySelector('[data-gp-lock]')?.addEventListener('click', () => App.gangpot.lock());
      if (App.gangpot.canEdit()) App.bindGangpotEdit(root, ctx);
    }
  };
})(window.App);