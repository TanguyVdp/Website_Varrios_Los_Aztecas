/* Afwezigheid: wie is er wanneer niet — melden met datumkiezer, wie is er nu weg, planning per lid.
 * Elke melding wordt door de Boss goedgekeurd/afgekeurd (zie boss.js); afgekeurde tellen niet mee als afwezig. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, L = App.L, A = App.ABSENCE;
  const ui = { tab: 'komend' };
  const PLAN_DAYS = 21;

  const reasonOf = id => A.REASONS.find(r => r.id === id) || A.REASONS[A.REASONS.length - 1];
  const members = state => state.users.filter(u => u.pin && !L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);

  // gedeeld met de lobby: indeling van alle afwezigheden t.o.v. vandaag
  App.absInfo = state => {
    const today = U.dkey(new Date());
    const in7 = U.dkey(U.addDays(new Date(), 7));
    const all = (state.absences || []).filter(a => a.status !== 'afgekeurd').sort((a, b) => a.van.localeCompare(b.van) || a.tot.localeCompare(b.tot));
    return {
      today, all,
      now: all.filter(a => a.van <= today && a.tot >= today),
      upcoming: all.filter(a => a.van > today),
      week: all.filter(a => a.van > today && a.van <= in7),
      past: all.filter(a => a.tot < today).reverse()
    };
  };

  const reasonPill = a => { const r = reasonOf(a.reden); return `<span class="rpill" style="--accent:var(--${r.tone})">${I(r.icon, 12)}${r.label}</span>`; };
  const period = a => `${U.dayLabel(a.van)}${a.tot !== a.van ? ` → ${U.dayLabel(a.tot)}` : ''}`;

  function when(a, today) {
    if (a.tot < today) return 'afgelopen';
    if (a.van <= today) return a.tot === today ? 'laatste dag vandaag' : `terug op ${U.dayLabel(U.dkey(U.addDays(U.parseDay(a.tot), 1)))}`;
    const d = U.daysBetween(today, a.van);
    return d === 1 ? 'vanaf morgen' : `over ${d} dagen`;
  }

  const statusPill = a => { const s = A.STATUS[a.status] || A.STATUS.aangevraagd; return `<span class="rpill st" style="--accent:var(--${s.tone})">${I(s.icon, 11)}${s.label}</span>`; };

  // opts.review = knoppen voor de Boss (goedkeuren / afkeuren / reageren / schrappen)
  function row(a, { state, me }, today, opts = {}) {
    const u = state.users.find(x => x.id === a.user_id) || { name: a.user_name };
    const days = U.daysBetween(a.van, a.tot) + 1;
    const mine = me && a.user_id === me.id;
    return `
      <div class="abs-row ${a.tot < today ? 'past' : ''} ${a.van <= today && a.tot >= today && a.status !== 'afgekeurd' ? 'now' : ''} is-${a.status}">
        ${C.avatar(u, 38)}
        <div class="abs-main">
          <div class="abs-top"><b>${U.esc(u.name)}</b>${reasonPill(a)}${statusPill(a)}</div>
          <div class="abs-dates">${period(a)} <span class="dim">· ${days} ${U.plural(days, 'dag', 'dagen')}</span></div>
          ${a.toelichting ? `<div class="abs-note">“${U.esc(a.toelichting)}”</div>` : ''}
          ${a.reactie ? `<div class="abs-reply">${I('shield', 12)}<span><b>${U.esc(a.beoordeeld_door || 'Boss')}</b> ${U.esc(a.reactie)}</span></div>` : ''}
          ${opts.review ? `
          <div class="abs-actions">
            ${a.status !== 'goedgekeurd' ? `<button class="btn ghost sm ok" data-review="goedgekeurd" data-id="${a.id}">${I('check', 13)} Goedkeuren</button>` : ''}
            ${a.status !== 'afgekeurd' ? `<button class="btn ghost sm no" data-review="afgekeurd" data-id="${a.id}">${I('x', 13)} Afkeuren</button>` : ''}
            <button class="btn ghost sm" data-review="" data-id="${a.id}">${I('message', 13)} ${a.reactie ? 'Reactie wijzigen' : 'Reageren'}</button>
            <button class="btn ghost sm no" data-abs-del="${a.id}">${I('trash', 13)} Schrappen</button>
          </div>` : ''}
        </div>
        <div class="abs-side">
          <span class="abs-when">${when(a, today)}</span>
          ${mine && a.tot >= today ? `<button class="abs-del" data-del="${a.id}" title="Verwijderen" aria-label="Verwijderen">${I('trash', 14)}</button>` : ''}
        </div>
      </div>`;
  }
  App.absRow = row;

  function hero({ me }, info) {
    const mijnNu = info.now.find(a => a.user_id === me.id);
    return `
      <section class="abs-hero">
        <div class="abs-hero-text">
          <span class="lh-eyebrow rose">${I('calendar', 13)} Afwezigheid</span>
          <h2>Wie is er <span class="rose-text">niet</span>?</h2>
          <p class="muted">Meld op voorhand van wanneer tot wanneer je er niet bent, met een reden. Zo weet de familia op wie ze kan rekenen.</p>
          ${mijnNu ? `<div class="abs-me">${I('alert', 14)} Jij staat als afwezig: ${period(mijnNu)} (${reasonOf(mijnNu.reden).label.toLowerCase()})</div>` : ''}
        </div>
        <button class="btn rose lg" data-melden>${I('plus', 16)} Afwezigheid melden</button>
      </section>`;
  }

  function planning({ state }, today) {
    const start = U.startOfWeek(new Date());
    const days = Array.from({ length: PLAN_DAYS }, (_, i) => U.addDays(start, i));
    const keys = days.map(U.dkey);
    const first = keys[0], last = keys[keys.length - 1];
    const dow = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
    const dayCls = (d, i) => `${keys[i] === today ? 'is-today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'is-we' : ''} ${d.getDay() === 1 && i > 0 ? 'is-wk' : ''}`;
    const head = days.map((d, i) => `<div class="tl-day ${dayCls(d, i)}"><span>${dow[d.getDay()]}</span><b class="mono">${d.getDate()}</b></div>`).join('');
    const rows = members(state).map(u => {
      const abs = (state.absences || []).filter(a => a.user_id === u.id && a.tot >= first && a.van <= last);
      const cells = days.map((d, i) => {
        const k = keys[i];
        const a = abs.find(x => x.van <= k && x.tot >= k);
        if (!a) return `<div class="tl-cell ${dayCls(d, i)}"></div>`;
        const r = reasonOf(a.reden);
        const s = a.van === k || i === 0, e = a.tot === k || i === keys.length - 1;
        return `<div class="tl-cell ${dayCls(d, i)} on ${s ? 's' : ''} ${e ? 'e' : ''} ${a.status === 'aangevraagd' ? 'pending' : ''}" style="--accent:var(--${r.tone})" title="${U.esc(u.name)} · ${r.label} · ${period(a)}${a.status === 'aangevraagd' ? ' · nog te keuren' : ''}">${s ? I(r.icon, 11) : ''}</div>`;
      }).join('');
      return `<div class="tl-row"><div class="tl-name">${C.avatar(u, 22)}<span>${U.esc(u.name)}</span></div>${cells}</div>`;
    }).join('');
    const legend = A.REASONS.map(r => `<span class="tl-leg" style="--accent:var(--${r.tone})"><i></i>${r.label}</span>`).join('')
      + `<span class="tl-leg pending" style="--accent:var(--muted)"><i></i>nog te keuren</span>`;
    return `
      <section class="card flush">
        ${C.cardHead('Planning', 'calendar', `<span class="muted small">${U.dayLabel(first)} – ${U.dayLabel(last)}</span>`)}
        <div class="tl-scroll"><div class="tl" style="--n:${PLAN_DAYS}">
          <div class="tl-row tl-headrow"><div class="tl-name"></div>${head}</div>
          ${rows}
        </div></div>
        <div class="tl-legend">${legend}</div>
      </section>`;
  }

  function openMelden(ctx) {
    const today = U.dkey(new Date());
    const f = { van: null, tot: null, reden: null };
    const reasons = A.REASONS.map(r => `<button type="button" class="reason" data-reden="${r.id}" style="--accent:var(--${r.tone})">${I(r.icon, 16)}<span>${r.label}</span></button>`).join('');
    C.modal.open(`
      <div class="af-head"><span class="af-ic">${I('calendar', 18)}</span><div><h3>Afwezigheid melden</h3><p class="muted small">Laat de familia weten wanneer je er niet bent.</p></div></div>
      <form class="stack" id="af-form" autocomplete="off">
        <div class="field">
          <span>Periode</span>
          <button type="button" class="date-trigger" id="af-trigger" aria-expanded="true">
            <div class="dt-part"><small>Van</small><b id="af-van">Kies een dag</b></div>
            <span class="dt-arrow">${I('arrowRight', 15)}</span>
            <div class="dt-part"><small>Tot en met</small><b id="af-tot">—</b></div>
            <span class="dt-ic">${I('calendar', 16)}</span>
          </button>
          <div class="cal-pop" id="af-cal"></div>
          <div class="chips">
            <button type="button" class="chip" data-quick="vandaag">Vandaag</button>
            <button type="button" class="chip" data-quick="morgen">Morgen</button>
            <button type="button" class="chip" data-quick="weekend">Dit weekend</button>
            <button type="button" class="chip" data-quick="week">Volgende week</button>
          </div>
        </div>
        <div class="field"><span>Reden</span><div class="reason-grid">${reasons}</div></div>
        <label class="field"><span>Toelichting <em id="af-note-hint">(optioneel)</em></span>
          <textarea class="input" id="af-note" rows="2" maxlength="${A.MAX_NOTE}" placeholder="bv. op reis, examens, ..."></textarea>
        </label>
        <div class="af-sum" id="af-sum"></div>
        <div class="err" id="af-err"></div>
        <button class="btn rose block lg" type="submit" id="af-submit" disabled>Afwezigheid opslaan</button>
      </form>`, modal => {
      const $ = s => modal.querySelector(s);
      const pop = $('#af-cal'), trig = $('#af-trigger');
      const setPop = open => { pop.hidden = !open; trig.classList.toggle('open', open); trig.setAttribute('aria-expanded', open); };

      function sync() {
        $('#af-van').textContent = f.van ? U.dayLabel(f.van) : 'Kies een dag';
        $('#af-tot').textContent = f.tot ? U.dayLabel(f.tot) : f.van ? 'zelfde dag' : '—';
        const tot = f.tot || f.van;
        const n = f.van ? U.daysBetween(f.van, tot) + 1 : 0;
        $('#af-sum').innerHTML = f.van
          ? `${I('check', 14)}<span><b>${n} ${U.plural(n, 'dag', 'dagen')}</b> afwezig${f.reden ? ` · ${reasonOf(f.reden).label.toLowerCase()}` : ''} — ${U.dayLabel(f.van)}${tot !== f.van ? ` t.e.m. ${U.dayLabel(tot)}` : ''}</span>`
          : '';
        $('#af-note-hint').textContent = f.reden === 'andere' ? '(verplicht bij Andere)' : '(optioneel)';
        $('#af-submit').disabled = !(f.van && f.reden);
      }

      const cal = C.rangeCalendar(pop, { min: today, onChange(s, e) { f.van = s; f.tot = e; sync(); if (s && e) setTimeout(() => setPop(false), 220); } });
      trig.addEventListener('click', () => setPop(pop.hidden));
      modal.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && !trig.contains(e.target) && f.van) setPop(false); });

      modal.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => {
        const d = new Date(), dow = d.getDay();
        let s, e;
        if (b.dataset.quick === 'vandaag') { s = e = U.dkey(d); }
        if (b.dataset.quick === 'morgen') { s = e = U.dkey(U.addDays(d, 1)); }
        if (b.dataset.quick === 'weekend') { s = U.dkey(dow === 0 ? d : U.addDays(d, (6 - dow + 7) % 7)); e = U.dkey(U.addDays(d, (7 - dow) % 7)); }
        if (b.dataset.quick === 'week') { const ma = U.addDays(U.startOfWeek(d), 7); s = U.dkey(ma); e = U.dkey(U.addDays(ma, 6)); }
        f.van = s; f.tot = e; cal.set(s, e); setPop(false); sync();
      }));
      modal.querySelectorAll('[data-reden]').forEach(b => b.addEventListener('click', () => {
        f.reden = b.dataset.reden;
        modal.querySelectorAll('[data-reden]').forEach(x => x.classList.toggle('on', x === b));
        sync();
      }));

      $('#af-form').addEventListener('submit', e => {
        e.preventDefault();
        const err = $('#af-err');
        err.textContent = '';
        C.busy($('#af-submit'), async () => {
          try {
            await App.store.addAfwezigheid(ctx.me.id, { van: f.van, tot: f.tot || f.van, reden: f.reden, toelichting: $('#af-note').value });
            C.modal.close();
            C.toast('Afwezigheid aangevraagd — de Boss keurt ze goed');
          } catch (ex) { err.textContent = U.friendlyError(ex); }
        });
      });
      sync();
    }, { wide: true });
  }

  App.views.afwezig = {
    title: () => 'Afwezigheid',
    render(ctx) {
      const { state, me } = ctx;
      const info = App.absInfo(state);
      const t = info.today;
      const leden = members(state);
      const afwezigIds = new Set(info.now.map(a => a.user_id));
      const mijn = (state.absences || []).filter(a => a.user_id === me.id && a.tot >= t).sort((a, b) => a.van.localeCompare(b.van));
      const lijst = ui.tab === 'komend' ? info.upcoming : info.past.slice(0, 12);
      return `
        ${hero(ctx, info)}
        <div class="kpi-row four">
          ${C.kpi({ label: 'Nu afwezig', value: U.num(info.now.length), icon: 'calendar', tone: 'rose', sub: info.now.length ? info.now.map(a => U.esc(a.user_name)).join(', ') : 'iedereen is er' })}
          ${C.kpi({ label: 'Aanwezig vandaag', value: `${U.num(leden.filter(u => !afwezigIds.has(u.id)).length)}<small>/${leden.length}</small>`, icon: 'users', tone: 'lime', sub: 'actieve leden' })}
          ${C.kpi({ label: 'Komende 7 dagen', value: U.num(info.week.length), icon: 'clock', sub: U.plural(info.week.length, 'melding', 'meldingen') })}
          ${C.kpi({ label: 'Jouw meldingen', value: U.num(mijn.length), icon: 'user', sub: mijn.length ? `eerstvolgende ${U.dayLabel(mijn[0].van)}` : 'niets gepland' })}
        </div>
        <div class="grid-2">
          <section class="card">
            ${C.cardHead('Nu afwezig', 'alert', `<span class="muted small">${U.dayLabel(t)}</span>`)}
            <div class="abs-list">${info.now.map(a => row(a, ctx, t)).join('') || C.empty('Iedereen is er vandaag.', 'users')}</div>
          </section>
          <section class="card">
            ${C.cardHead('Mijn afwezigheden', 'user', `<button class="link-more rose" data-melden>${I('plus', 13)} Melden</button>`)}
            <div class="abs-list">${mijn.map(a => row(a, ctx, t)).join('') || C.empty('Je hebt niets gepland staan.', 'calendar')}</div>
          </section>
        </div>
        ${planning(ctx, t)}
        <section class="card">
          ${C.cardHead('Alle meldingen', 'list')}
          ${C.seg('abs', [{ value: 'komend', label: 'Gepland', count: info.upcoming.length }, { value: 'voorbij', label: 'Afgelopen', count: info.past.length }], ui.tab)}
          <div class="abs-list">${lijst.map(a => row(a, ctx, t)).join('') || C.empty(ui.tab === 'komend' ? 'Niemand heeft iets gepland.' : 'Nog niets afgelopen.', 'inbox')}</div>
        </section>`;
    },
    mount(ctx, root) {
      root.querySelectorAll('[data-melden]').forEach(b => b.addEventListener('click', () => openMelden(ctx)));
      C.bindSeg(root, (name, value) => { ui.tab = value; App.rerender(); });
      root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        const a = ctx.state.absences.find(x => x.id === b.dataset.del);
        if (!a) return;
        C.modal.open(`
          <h3>Afwezigheid verwijderen?</h3>
          <p class="muted">${reasonOf(a.reden).label} · ${period(a)}</p>
          <div class="err" id="del-err"></div>
          <div class="row-2">
            <button class="btn ghost" data-modal-close>Annuleren</button>
            <button class="btn ghost danger-text" id="del-ok">${I('trash', 14)} Verwijderen</button>
          </div>`, modal => {
          modal.querySelector('#del-ok').addEventListener('click', e => C.busy(e.currentTarget, async () => {
            try { await App.store.deleteAfwezigheid(a.id, ctx.me.id); C.modal.close(); C.toast('Afwezigheid verwijderd'); }
            catch (ex) { modal.querySelector('#del-err').textContent = U.friendlyError(ex); }
          }));
        });
      }));
    }
  };
})(window.App);