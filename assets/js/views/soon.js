/* Pagina voor een afdeling die nog in opbouw is: wat ze wordt en wat ze zal kunnen. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, L = App.L, R = App.RULES;

  // extra uitleg per afdeling: wat er vandaag al bestaat
  const NOW = {
    gangpot: ({ snap, state }) => {
      const gp = state.users.find(L.isGangpot);
      if (!gp) return '';
      return `
        <section class="card soon-now" style="--accent:var(--gold)">
          ${C.avatar(gp, 48)}
          <div>
            <b>Vandaag al actief via de Wiet loods</b>
            <p class="muted small">Het profiel <b>gangpot</b> krijgt automatisch 1 op ${R.GANGPOT_DEEL} van elke inleg. Nu in de pot:</p>
          </div>
          <div class="soon-now-fig"><b class="mono">${U.num(snap.perUser.get(gp.id).tegoed)}</b><span>zakjes tegoed</span></div>
        </section>`;
    }
  };

  App.views.soon = {
    title: ctx => ctx.module.name,
    render(ctx) {
      const m = ctx.module;
      return `
        <section class="soon-hero" style="--accent:var(--${m.tone});--accent-soft:var(--${m.tone}-soft)">
          <span class="dept-bg">${I(m.icon, 260)}</span>
          <span class="soon-ic">${I(m.icon, 30)}</span>
          <span class="dept-badge soon">${I('sparkle', 11)} In opbouw</span>
          <h2>${m.name}</h2>
          <p class="soon-tag">${m.tagline}</p>
          <p class="muted">${m.desc}</p>
          <a class="btn ghost" href="#/lobby">${I('back', 15)} Terug naar de lobby</a>
        </section>
        ${NOW[m.id] ? NOW[m.id](ctx) : ''}
        <section class="card">
          ${C.cardHead('Wat deze afdeling zal kunnen', 'sparkle')}
          <div class="plan-grid" style="--accent:var(--${m.tone});--accent-soft:var(--${m.tone}-soft)">
            ${(m.plans || []).map((p, i) => `<div class="plan"><b class="mono">${String(i + 1).padStart(2, '0')}</b><span>${p}</span></div>`).join('')}
          </div>
          <p class="muted small soon-note">Deze afdeling deelt straks dezelfde login, profielen en Boss menu als de Wiet loods.</p>
        </section>`;
    }
  };
})(window.App);