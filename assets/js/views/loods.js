/* Loods-dashboard: persoonlijk tegoed, wachtrij, inleggen/ophalen, overzicht, logboek. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, R = App.RULES, L = App.L;
  // UI-toestand die renders overleeft (niet in de database)
  const ui = { action: 'inleg', queue: 'active', feed: 'all', feedLimit: 12 };

  // ---------- blokken ----------
  function hero({ me, mine }) {
    const inVerwerking = Math.max(0, mine.tegoed - mine.momTegoed);
    const cap = mine.gangpot
      ? `<div class="cap"><div class="cap-row"><span>Onverwerkt in de loods</span><b class="mono">${U.num(mine.momInleg)}</b></div>
         <p class="muted small">Gangpot heeft geen limiet op onverwerkte voorraad.</p></div>`
      : `<div class="cap"><div class="cap-row"><span>Onverwerkt in de loods</span><b class="mono ${mine.level}">${U.num(mine.momInleg)}<span class="dim"> / ${U.num(R.MAX_MOMENTEEL_INLEG)}</span></b></div>
         ${C.meter(mine.ratio, mine.level)}
         <p class="muted small">${mine.ruimte <= 0 ? `<span class="danger">Limiet bereikt</span> — wacht tot de wachtrij meer verwerkt.` : `Nog ruimte voor <b class="mono lime">${U.num(mine.ruimte)}</b> planten. Groeit vanzelf aan naarmate de wachtrij verwerkt.`}</p></div>`;
    return `
      <section class="card hero">
        <div class="hero-main">
          <div class="hero-hello">${C.avatar(me, 40)}<div><div class="eyebrow">Welkom terug</div><div class="hero-name">${U.esc(me.name)}</div></div></div>
          <div class="hero-figure">
            <div class="big mono">${U.num(mine.momTegoed)}</div>
            <div class="big-label">${U.plural(mine.momTegoed, 'zakje', 'zakjes')} klaar om op te halen</div>
          </div>
          <div class="hero-stats">
            <div><span>Totaal tegoed</span><b class="mono">${U.num(mine.tegoed)}</b></div>
            <div><span>Nog in verwerking</span><b class="mono">${U.num(inVerwerking)}</b></div>
            <div><span>Ooit ingelegd</span><b class="mono">${U.num(me.total_ingelegd)}</b></div>
          </div>
          <div class="hero-actions">
            <button class="btn primary" data-jump="inleg">${I('sprout')} Inleggen</button>
            <button class="btn ghost" data-jump="ophalen">${I('arrowDown')} Ophalen</button>
          </div>
        </div>
        <div class="hero-side">${cap}</div>
      </section>`;
  }

  function queueStatus({ snap }) {
    const q = snap.queueInfo, b = snap.baseline;
    const pct = q.totalZakjes ? (q.totalZakjes - q.pendingZakjes) / q.totalZakjes : 1;
    const R0 = 46, CIRC = 2 * Math.PI * R0;
    const status = b.paused ? C.pill('gepauzeerd', 'warn') : q.pendingZakjes ? C.pill('bezig', 'lime') : C.pill('leeg', 'muted');
    const p = q.processing;
    return `
      <section class="card queue-status">
        ${C.cardHead('Wachtrij', 'clock', status)}
        <div class="qs-body">
          <div class="ring">
            <svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="${R0}" class="ring-bg"/>
              <circle cx="55" cy="55" r="${R0}" class="ring-fg ${b.paused ? 'paused' : ''}" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - pct)).toFixed(1)}"/></svg>
            <div class="ring-center"><b class="mono">${U.num(q.pendingZakjes)}</b><span>in wachtrij</span></div>
          </div>
          <ul class="qs-facts">
            <li><span>Klaar over</span><b class="mono">${q.finishAt ? U.duration(q.finishAt - snap.now) : '—'}</b></li>
            <li><span>Klaar rond</span><b class="mono">${q.finishAt ? U.date(q.finishAt) + ' ' + U.clock(q.finishAt) : '—'}</b></li>
            <li><span>Nu bezig</span><b>${p ? C.dot(p.userName) + U.esc(p.userName) : '—'}</b></li>
            <li><span>Tempo</span><b class="mono">${b.batch_size} / ${b.batch_minutes} min</b></li>
          </ul>
        </div>
        ${b.paused ? `<div class="banner warn">${I('pause', 14)}<span>Gepauzeerd sinds ${U.clock(b.paused_at)} voor onderhoud — tijden lopen niet mee.</span></div>` : ''}
      </section>`;
  }

  function kpis({ snap }) {
    const t = snap.totals;
    const pct = t.toegekend ? Math.round(t.opgehaald / t.toegekend * 100) : 0;
    return `
      <section class="kpi-row">
        ${C.kpi({ label: 'Planten in loods', value: U.num(t.plantenInLoods), icon: 'sprout', sub: 'nog niet verwerkt' })}
        ${C.kpi({ label: 'Zakjes klaar', value: U.num(t.zakjesKlaar), icon: 'box', tone: 'lime', sub: 'verwerkt, niet opgehaald' })}
        ${C.kpi({ label: 'Toegekend', value: U.num(t.toegekend), icon: 'check', sub: 'zakjes in totaal' })}
        ${C.kpi({ label: 'Opgehaald', value: U.num(t.opgehaald), icon: 'arrowDown', sub: `${pct}% van toegekend` })}
        ${C.kpi({ label: 'Nog tegoed', value: U.num(t.nogTegoed), icon: 'inbox', tone: 'violet', sub: 'over alle profielen' })}
      </section>`;
  }

  function previewInleg(me, mine, amount, hasGangpot) {
    if (!amount) return `<span class="muted">Vul een aantal in om te zien wat je krijgt.</span>`;
    const split = L.splitInleg(me, amount, hasGangpot);
    const plus = L.zakjesForTotal(me.legacy_zakjes || 0, me.total_ingelegd + split.self) - mine.zakjes;
    const over = !mine.gangpot && amount > mine.ruimte;
    return `
      <div class="pv-row"><span>Voor jou</span><b class="mono">${U.num(split.self)} planten → <span class="lime">+${U.num(plus)} ${U.plural(plus, 'zakje', 'zakjes')}</span></b></div>
      ${split.gangpot ? `<div class="pv-row"><span>Naar gangpot (1/${R.GANGPOT_DEEL})</span><b class="mono">${U.num(split.gangpot)} planten</b></div>` : ''}
      ${over ? `<div class="pv-row danger">${I('alert', 13)}<span>Meer dan je ruimte (${U.num(mine.ruimte)})</span></div>` : ''}`;
  }
  function previewOphalen(mine, amount) {
    if (!amount) return `<span class="muted">Je kan nu max <b class="mono lime">${U.num(mine.momTegoed)}</b> ophalen.</span>`;
    if (amount > mine.momTegoed) return `<div class="pv-row danger">${I('alert', 13)}<span>${amount > mine.tegoed ? 'Meer dan je totale tegoed.' : `Slechts ${U.num(mine.momTegoed)} zijn al verwerkt.`}</span></div>`;
    return `
      <div class="pv-row"><span>Na ophalen klaar</span><b class="mono">${U.num(mine.momTegoed - amount)}</b></div>
      <div class="pv-row"><span>Totaal tegoed daarna</span><b class="mono">${U.num(mine.tegoed - amount)}</b></div>`;
  }

  function actionPanel({ me, mine }) {
    const isIn = ui.action === 'inleg';
    const disabled = isIn ? (!mine.gangpot && mine.ruimte <= 0) : mine.momTegoed <= 0;
    const quick = isIn
      ? [100, 250, 500, 1000].map(v => `<button type="button" class="chip" data-quick="${v}">${U.num(v)}</button>`).join('')
      : [10, 25, 50].map(v => `<button type="button" class="chip" data-quick="${v}">${v}</button>`).join('') + `<button type="button" class="chip" data-quick="${mine.momTegoed}">Alles · ${U.num(mine.momTegoed)}</button>`;
    return `
      <section class="card action" id="action-panel">
        ${C.seg('action', [{ value: 'inleg', label: 'Inleggen', icon: 'sprout' }, { value: 'ophalen', label: 'Ophalen', icon: 'arrowDown' }], ui.action)}
        <p class="muted small action-hint">${isIn
          ? `Elke <b>${R.RATIO_IN}</b> planten = <b>${R.RATIO_OUT}</b> zakje.${mine.gangpot || !R.GANGPOT_DEEL ? '' : ` 1 op ${R.GANGPOT_DEEL} planten gaat automatisch naar de gangpot.`}`
          : `Je kan enkel ophalen wat de wachtrij al verwerkt heeft.`}</p>
        <form id="action-form" class="stack" autocomplete="off">
          <label class="field"><span>${isIn ? 'Aantal planten' : 'Aantal zakjes'}</span>
            <div class="input-wrap"><input class="input mono lg" type="number" inputmode="numeric" min="1" step="1" id="act-amount" placeholder="${isIn ? 'bv. 400' : 'bv. 20'}" ${disabled ? 'disabled' : ''}><span class="suffix">${isIn ? 'planten' : 'zakjes'}</span></div>
          </label>
          <div class="chips">${quick}</div>
          <div class="preview" id="act-preview">${isIn ? previewInleg(me, mine, 0, false) : previewOphalen(mine, 0)}</div>
          <div class="err" id="act-err"></div>
          <button class="btn ${isIn ? 'primary' : 'warn'} block lg" type="submit" ${disabled ? 'disabled' : ''}>${isIn ? 'Inleg registreren' : 'Ophalen registreren'}</button>
        </form>
      </section>`;
  }

  function queueList({ snap }) {
    const q = snap.queueInfo, now = snap.now;
    const isActive = ui.queue === 'active';
    const list = isActive ? q.active : q.done.slice(0, 40);
    const shown = list.slice(0, 25);
    const items = shown.map((d, i) => {
      const processing = isActive && d.start <= now && now < d.end;
      const pct = processing ? Math.min(100, Math.max(0, (now - d.start) / (d.end - d.start) * 100)) : 0;
      const right = !isActive ? `<span class="q-badge done">${I('check', 12)}</span>`
        : processing ? `<span class="q-badge live">${Math.max(1, Math.ceil((d.end - now) / 60000))} min</span>`
        : `<span class="q-badge">#${i + 1}</span>`;
      const meta = !isActive ? `klaar om ${U.clock(d.end)} · ${U.date(d.end)}`
        : processing ? 'wordt nu verwerkt' : `start om ${U.clock(d.start)}`;
      return `
        <div class="q-item ${processing ? 'processing' : ''} ${!isActive ? 'done' : ''}">
          <div class="q-main">
            ${C.dot(d.userName)}
            <div class="q-text"><b>${U.esc(d.userName)}</b><span class="muted"> · ${U.num(d.zakjes)} ${U.plural(d.zakjes, 'zakje', 'zakjes')}</span>
              <div class="q-meta mono">${U.clock(d.start)}–${U.clock(d.end)} · ${meta}</div></div>
            ${right}
          </div>
          ${processing ? `<div class="q-bar"><span style="width:${pct.toFixed(1)}%"></span></div>` : ''}
        </div>`;
    }).join('');
    return `
      <section class="card queue-list">
        ${C.cardHead('Verwerkingswachtrij', 'list', '', 'cyan')}
        ${C.seg('queue', [{ value: 'active', label: 'Bezig & wachtend', count: q.active.length }, { value: 'done', label: 'Afgerond', count: q.done.length }], ui.queue)}
        <div class="q-list">${items || C.empty(isActive ? 'Wachtrij is leeg.' : 'Nog niets afgerond.', 'clock')}
          ${list.length > shown.length ? `<div class="q-more muted small">+ ${list.length - shown.length} meer</div>` : ''}</div>
        <p class="muted tiny">FIFO op volgorde van inleg. Een batch die een server-restart raakt (7u58, 11u58, 17u58 — 5 min) herbegint volledig erna.</p>
      </section>`;
  }

  function overview({ state, snap, me }) {
    const rows = [...state.users]
      .map(u => snap.perUser.get(u.id))
      .sort((a, b) => b.tegoed - a.tegoed)
      .map(p => `
        <tr class="${p.user.id === me.id ? 'me' : ''}">
          <td><div class="who-cell">${C.avatar(p.user, 24)}<span>${U.esc(p.user.name)}</span>${p.gangpot ? C.pill('gedeeld', 'warn') : ''}</div></td>
          <td class="num">${U.num(p.user.total_ingelegd)}</td>
          <td class="num"><div class="num-meter"><span class="${p.level}">${U.num(p.momInleg)}</span>${p.gangpot ? '' : C.meter(p.ratio, p.level)}</div></td>
          <td class="num">${U.num(p.zakjes)}</td>
          <td class="num">${U.num(p.user.opgehaald)}</td>
          <td class="num lime strong">${U.num(p.momTegoed)}</td>
          <td class="num">${U.num(p.tegoed)}</td>
        </tr>`).join('');
    return `
      <section class="card flush">
        ${C.cardHead('Overzicht per profiel', 'users', `<span class="muted small mono">${state.users.length}/${R.MAX_USERS}</span>`)}
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Naam</th><th class="num">Ingelegd</th><th class="num">Onverwerkt</th><th class="num">Zakjes</th><th class="num">Opgehaald</th><th class="num">Klaar</th><th class="num">Tegoed</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  }

  App.loodsFeedItem = e => {
    if (e.type === 'inleg') return C.feedItem({ tone: 'lime', icon: 'sprout', ts: e.ts, delta: `+${e.zakjes_delta}`,
      html: e.note ? `<b>${U.esc(e.user_name)}</b> kreeg <b>${U.num(e.amount)}</b> planten` : `<b>${U.esc(e.user_name)}</b> legde <b>${U.num(e.amount)}</b> planten in`,
      sub: `${e.note ? U.esc(e.note) + ' · ' : ''}totaal ${U.num(e.cumulative_after)} · ${U.num(e.zakjes_after)} zakjes toegekend` });
    if (e.type === 'correctie') return C.feedItem({ tone: 'muted', icon: 'pencil', ts: e.ts, delta: '✎',
      html: `<b>${U.esc(e.user_name)}</b> — gecorrigeerd door Boss`, sub: U.esc(e.note || '') });
    return C.feedItem({ tone: 'warn', icon: 'arrowDown', ts: e.ts, delta: `−${e.amount}`,
      html: `<b>${U.esc(e.user_name)}</b> haalde <b>${U.num(e.amount)}</b> ${U.plural(e.amount, 'zakje', 'zakjes')} op`,
      sub: `resterend tegoed ${U.num(e.tegoed_after)}` });
  };

  function feed({ state, me }) {
    const all = [...state.log].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const filtered = all.filter(e => ui.feed === 'all' || (ui.feed === 'mine' ? e.user_id === me.id : e.type === ui.feed));
    const shown = filtered.slice(0, ui.feedLimit);
    return `
      <section class="card">
        ${C.cardHead('Logboek', 'list', `<span class="muted small mono">${U.num(state.log.length)} registraties</span>`)}
        ${C.seg('feed', [{ value: 'all', label: 'Alles' }, { value: 'inleg', label: 'Inleg' }, { value: 'ophalen', label: 'Ophalen' }, { value: 'mine', label: 'Van mij' }], ui.feed)}
        <div class="feed">${shown.map(App.loodsFeedItem).join('') || C.empty('Nog geen registraties.')}</div>
        ${filtered.length > shown.length ? `<button class="btn ghost block" data-more>Meer tonen (${filtered.length - shown.length})</button>` : ''}
      </section>`;
  }

  App.views.loods = {
    render(ctx) {
      return `
        <div class="grid-hero">${hero(ctx)}${queueStatus(ctx)}</div>
        ${kpis(ctx)}
        <div class="grid-2">${actionPanel(ctx)}${queueList(ctx)}</div>
        ${overview(ctx)}
        ${feed(ctx)}
        <p class="footnote">Elke inleg en elke opname wordt met naam en tijdstip vastgelegd en is voor iedereen zichtbaar. Je logt in met Discord, dus niemand anders kan onder jouw naam registreren.</p>`;
    },
    mount(ctx, root) {
      const { me } = ctx;
      C.bindSeg(root, (name, value) => {
        if (name === 'feed') ui.feedLimit = 12;
        ui[name] = value;
        App.rerender();
      });
      root.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
        ui.action = b.dataset.jump;
        App.rerender();
        const panel = document.getElementById('action-panel');
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => document.getElementById('act-amount')?.focus({ preventScroll: true }), 350);
      }));
      root.querySelector('[data-more]')?.addEventListener('click', () => { ui.feedLimit += 20; App.rerender(); });

      const form = root.querySelector('#action-form');
      const input = root.querySelector('#act-amount');
      const preview = root.querySelector('#act-preview');
      const hasGangpot = ctx.state.users.some(L.isGangpot);
      const update = () => {
        const n = Math.max(0, Math.floor(Number(input.value) || 0));
        preview.innerHTML = ui.action === 'inleg' ? previewInleg(me, ctx.mine, n, hasGangpot) : previewOphalen(ctx.mine, n);
      };
      input.addEventListener('input', update);
      root.querySelectorAll('[data-quick]').forEach(c => c.addEventListener('click', () => { input.value = c.dataset.quick; update(); input.focus(); }));
      form.addEventListener('submit', e => {
        e.preventDefault();
        const err = root.querySelector('#act-err');
        err.textContent = '';
        const amount = Number(input.value);
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try {
            if (ui.action === 'inleg') {
              const split = await App.store.registerInleg(me.id, amount);
              C.toast(`${U.num(split.self)} planten ingelegd${split.gangpot ? ` · ${U.num(split.gangpot)} naar gangpot` : ''}`);
            } else {
              await App.store.registerOphalen(me.id, amount);
              C.toast(`${U.num(amount)} ${U.plural(amount, 'zakje', 'zakjes')} opgehaald`);
            }
          } catch (ex) { err.textContent = U.friendlyError(ex); }
        });
      });
    }
  };
})(window.App);
