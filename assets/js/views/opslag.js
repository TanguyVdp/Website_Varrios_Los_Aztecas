/* Opslag loods: enkel met het vinkje "Opslag loods" (of Boss menu) in de Ledenlijst — app.js toont anders "Geen toegang".
 * Elke dag 2 missies (App.MISSIONS) die elk maar één keer per dag afgevinkt kunnen worden — daarna staan ze vast.
 * Base coke = automatisch +600 base in de gangpot; de voorraad base kan hier ook bijgeteld of verminderd worden (bv. verkocht). */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, M = App.MISSIONS;

  App.opslag = {
    unlocked: () => App.can('opslag')
  };

  // status van vandaag, gedeeld met de lobby
  App.missionsToday = state => {
    const t = U.dkey(new Date());
    return M.map(m => ({ m, done: state.missions.find(x => x.datum === t && x.type === m.id) || null }));
  };
  App.baseItem = state => state.gangpot.items.find(i => i.naam === App.BASE_ITEM) || { naam: App.BASE_ITEM, eenheid: 'stuks', aantal: 0 };

  function missionCard({ m, done }) {
    return `
      <div class="mis ${done ? 'done' : ''}" style="--accent:var(--${m.tone})">
        <span class="mis-check">${done ? I('check', 30) : ''}</span>
        <div class="mis-body">
          <div class="abs-top"><span class="mis-ic">${I(m.icon, 15)}</span><b>${m.label}</b></div>
          ${m.reward ? `<p class="mis-reward">${I('crown', 12)} +${U.num(m.reward.amount)} ${m.reward.item.toLowerCase()} in de gangpot</p>` : '<p class="mis-reward muted">1× per dag</p>'}
          ${done
            ? `<p class="mis-by">${I('lock', 12)} Gedaan door <b class="tcap">${U.esc(done.user_name)}</b> om ${U.clock(done.ts)} — staat vast</p>`
            : `<button class="btn mis-btn" data-done="${m.id}">${I('check', 15)} Ik heb hem gedaan</button>`}
        </div>
      </div>`;
  }

  function weekGrid(state) {
    const N = 14, today = U.dkey(new Date());
    const days = Array.from({ length: N }, (_, i) => U.dkey(U.addDays(new Date(), i - N + 1)));
    const set = new Set(state.missions.map(x => x.datum + '|' + x.type));
    const dow = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
    const doneCount = days.reduce((s, d) => s + M.filter(m => set.has(d + '|' + m.id)).length, 0);
    // reeks: opeenvolgende dagen (tot gisteren, of vandaag als alles al gedaan is) met beide missies
    let streak = 0;
    for (let i = 0; ; i++) {
      const d = U.dkey(U.addDays(new Date(), -i));
      const all = M.every(m => set.has(d + '|' + m.id));
      if (all) streak++; else if (i === 0) continue; else break;
      if (i > 400) break;
    }
    return `
      <section class="card">
        ${C.cardHead('Laatste 14 dagen', 'calendar', `<span class="muted small mono">${doneCount}/${N * M.length}</span>`)}
        <div class="mis-stats">
          <div><b class="mono">${Math.round(doneCount / (N * M.length) * 100)}%</b><span>gedaan</span></div>
          <div><b class="mono">${streak}</b><span>${U.plural(streak, 'dag', 'dagen')} op rij volledig</span></div>
        </div>
        <div class="mis-grid14" style="--n:${N}">
          <span></span>${days.map(d => { const x = U.parseDay(d); return `<span class="mg-day ${d === today ? 'today' : ''}">${dow[x.getDay()]}<b class="mono">${x.getDate()}</b></span>`; }).join('')}
          ${M.map(m => `<span class="mg-label" style="--accent:var(--${m.tone})">${I(m.icon, 12)}${m.short}</span>${days.map(d => {
            const hit = state.missions.find(x => x.datum === d && x.type === m.id);
            return `<span class="mg-cell ${hit ? 'on' : d === today ? 'open' : 'miss'}" style="--accent:var(--${m.tone})" title="${U.dayLabel(d)} · ${hit ? 'gedaan door ' + U.esc(hit.user_name) : 'niet gedaan'}">${hit ? I('check', 12) : ''}</span>`;
          }).join('')}`).join('')}
        </div>
      </section>`;
  }

  function ranking(state) {
    const from = U.dkey(U.addDays(new Date(), -29));
    const per = new Map();
    state.missions.filter(x => x.datum >= from).forEach(x => {
      const r = per.get(x.user_id) || { name: x.user_name, total: 0 };
      r.total++; r[x.type] = (r[x.type] || 0) + 1; per.set(x.user_id, r);
    });
    const rows = [...per.entries()].sort((a, b) => b[1].total - a[1].total);
    const max = rows.length ? rows[0][1].total : 1;
    return `
      <section class="card">
        ${C.cardHead('Wie doet het meest', 'users', '<span class="muted small">laatste 30 dagen</span>')}
        <div class="rank">${rows.map(([id, r], i) => {
          const u = state.users.find(x => x.id === id) || { name: r.name };
          return `
          <div class="rank-row">
            <span class="rank-n mono">${i + 1}</span>${C.avatar(u, 28)}
            <div class="rank-main"><div class="rank-top"><b class="tcap">${U.esc(r.name)}</b><span class="mono">${r.total}</span></div>
              <div class="rank-bar">${M.map(m => `<i style="--accent:var(--${m.tone});width:${((r[m.id] || 0) / max * 100).toFixed(1)}%" title="${m.short}: ${r[m.id] || 0}"></i>`).join('')}</div></div>
          </div>`; }).join('') || C.empty('Nog geen missies gedaan.')}</div>
        <div class="tl-legend flat">${M.map(m => `<span class="tl-leg" style="--accent:var(--${m.tone})"><i></i>${m.short}</span>`).join('')}</div>
      </section>`;
  }

  function baseCard(state) {
    const it = App.baseItem(state);
    const log = state.gangpot.log.filter(e => e.item_naam === App.BASE_ITEM).sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 5);
    return `
      <section class="card base-card">
        ${C.cardHead('Base in de gangpot', 'flask', `<a class="link-more gold" href="#/gangpot">Gangpot ${I('arrowRight', 13)}</a>`)}
        <div class="base-fig"><b class="mono">${U.num(it.aantal)}</b><span>base</span></div>
        <div class="gp-btns">
          <button class="btn ghost" data-base="-1">${I('minus', 14)} Eruit (verkocht ...)</button>
          <button class="btn ghost" data-base="1">${I('plus', 14)} Extra erbij</button>
        </div>
        <div class="feed compact">${log.map(App.gangpotFeedItem).join('') || C.empty('Nog geen wijzigingen.')}</div>
      </section>`;
  }

  function baseModal(dir, ctx) {
    const it = App.baseItem(ctx.state);
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--${dir > 0 ? 'lime' : 'warn'})">${I(dir > 0 ? 'plus' : 'minus', 18)}</span>
        <div><h3>Base ${dir > 0 ? 'erbij' : 'eruit'}</h3><p class="muted small">Nu in de gangpot: <b class="mono">${U.num(it.aantal)}</b> base</p></div></div>
      <form class="stack" id="bm-form" autocomplete="off">
        <label class="field"><span>Hoeveel base</span><input class="input lg mono" id="bm-n" type="number" min="1" step="1" placeholder="0"></label>
        <label class="field"><span>Waarom <em>(verplicht)</em></span><input class="input" id="bm-note" maxlength="120" required minlength="3" placeholder="${dir > 0 ? 'bv. extra gekregen' : 'bv. verkocht aan Ballas'}"></label>
        <div class="err" id="bm-err"></div>
        <button class="btn ${dir > 0 ? 'primary' : 'warn'} block" type="submit">${dir > 0 ? 'Toevoegen' : 'Eruit halen'}</button>
      </form>`, modal => {
      const form = modal.querySelector('#bm-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try {
            const n = Number(modal.querySelector('#bm-n').value);
            if (!(n > 0)) throw new Error('ONGELDIG_AANTAL');
            await App.store.mutateBase(dir * n, modal.querySelector('#bm-note').value, ctx.me.name);
            C.modal.close(); C.toast('Base bijgewerkt');
          } catch (ex) { modal.querySelector('#bm-err').textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  function confirmDone(m, ctx) {
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--${m.tone})">${I(m.icon, 18)}</span><div><h3>${m.label} afvinken?</h3><p class="muted small">${U.dayLabel(U.dkey(new Date()))}</p></div></div>
      <p class="muted">Je bevestigt dat <b class="tcap">${U.esc(ctx.me.name)}</b> vandaag de ${m.label.toLowerCase()} gedaan heeft.${m.reward ? ` Er komt automatisch <b>+${U.num(m.reward.amount)} ${m.reward.item.toLowerCase()}</b> in de gangpot.` : ''}</p>
      <div class="abs-me">${I('lock', 14)} Dit kan daarna niet meer veranderd worden.</div>
      <div class="err" id="cd-err"></div>
      <div class="row-2"><button class="btn ghost" data-modal-close>Annuleren</button><button class="btn warn" id="cd-ok">${I('check', 15)} Ja, gedaan</button></div>`, modal => {
      modal.querySelector('#cd-ok').addEventListener('click', e => C.busy(e.currentTarget, async () => {
        try { await App.store.completeMission(m.id, ctx.me.id); C.modal.close(); C.toast(`${m.label} afgevinkt${m.reward ? ` — +${m.reward.amount} ${m.reward.item.toLowerCase()} in de gangpot` : ''}`); }
        catch (ex) { modal.querySelector('#cd-err').textContent = U.friendlyError(ex); }
      }));
    });
  }

  App.views.opslag = {
    title: () => 'Opslag loods',
    render(ctx) {
      const { state } = ctx;
      const today = App.missionsToday(state);
      const n = today.filter(x => x.done).length;
      const hist = [...state.missions].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 10);
      return `
        <section class="abs-hero op-hero">
          <div class="abs-hero-text">
            <span class="lh-eyebrow warn">${I('box', 13)} Opslag loods</span>
            <h2>Missies van <span class="warn">vandaag</span></h2>
            <p class="muted">${(d => d.charAt(0).toUpperCase() + d.slice(1))(new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${n}/${M.length} gedaan. Elke missie kan maar één keer per dag afgevinkt worden — daarna staat ze vast.</p>
          </div>
        </section>
        <div class="mis-grid">${today.map(missionCard).join('')}</div>
        <div class="grid-2">${weekGrid(state)}${baseCard(state)}</div>
        <div class="grid-2">
          ${ranking(state)}
          <section class="card">
            ${C.cardHead('Laatst gedaan', 'list')}
            <div class="feed">${hist.map(x => { const m = M.find(y => y.id === x.type) || M[0]; return C.feedItem({ tone: 'lime', icon: 'check', ts: x.ts, delta: m.reward ? `+${m.reward.amount}` : '✓', html: `<b>${U.esc(x.user_name)}</b> deed de ${m.label.toLowerCase()}`, sub: U.dayLabel(x.datum) }); }).join('') || C.empty('Nog niets gedaan.')}</div>
          </section>
        </div>`;
    },
    mount(ctx, root) {
      root.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', () => confirmDone(M.find(m => m.id === b.dataset.done), ctx)));
      root.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => baseModal(Number(b.dataset.base), ctx)));
    }
  };
})(window.App);