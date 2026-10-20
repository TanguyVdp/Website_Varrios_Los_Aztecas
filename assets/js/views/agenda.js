/* Agenda: maandkalender + eerstvolgende activiteiten. De Boss plaatst activiteiten (boss.js → Agenda),
 * leden melden zich aan: aanwezig / misschien / afwezig (reden verplicht: keuze uit App.AGENDA.AFWEZIG of zelf typen) — ook via de Discord-bot. Per dag zie je ook wie er afwezig is. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, T = App.AGENDA.TYPES;
  const ui = { month: null };   // eerste dag van de getoonde maand ('YYYY-MM-DD'), null = deze maand

  const typeOf = id => T.find(t => t.id === id) || T[T.length - 1];
  const sortEv = (a, b) => (a.datum + (a.tijd || '')).localeCompare(b.datum + (b.tijd || ''));
  const RS = App.AGENDA.RSVP;
  const rsvpOf = id => RS.find(r => r.id === id);
  const leden = state => state.users.filter(u => u.pin && !App.L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);
  const absentOn = (state, k) => (state.absences || []).filter(a => a.status !== 'afgekeurd' && a.van <= k && a.tot >= k);

  function relDay(k) {
    const diff = U.daysBetween(U.dkey(new Date()), k);
    return { diff, label: diff === 0 ? 'vandaag' : diff === 1 ? 'morgen' : diff < 0 ? 'voorbij' : `over ${diff} dagen` };
  }

  // samenvatting van de aanmeldingen + jouw antwoord
  function rsvpLine(e, { state, me }) {
    const rs = (state.rsvps || []).filter(x => x.event_id === e.id);
    const mine = me && rs.find(x => x.user_id === me.id);
    const past = relDay(e.datum).diff < 0;
    const counts = RS.map(s => { const n = rs.filter(x => x.status === s.id).length; return `<span class="rs-count" style="--accent:var(--${s.tone})" title="${s.label}">${I(s.icon, 11)}${n}</span>`; }).join('');
    const you = !me ? '' : mine
      ? `<span class="rpill" style="--accent:var(--${rsvpOf(mine.status).tone})">Jij: ${rsvpOf(mine.status).label.toLowerCase()}</span>`
      : past ? '' : `<span class="rpill hot" style="--accent:var(--warn)">${I('alert', 11)}Nog niet geantwoord</span>`;
    return `<div class="rs-line">${counts}${you}</div>`;
  }

  // gedeeld met boss.js (admin = verwijderknop)
  App.eventRow = (e, admin, ctx) => {
    const t = typeOf(e.type), d = U.parseDay(e.datum), r = relDay(e.datum);
    return `
      <div class="ev-row ${r.diff < 0 ? 'past' : ''}" style="--accent:var(--${t.tone})" data-ev="${e.id}">
        <div class="ev-date"><b class="mono">${d.getDate()}</b><span>${d.toLocaleDateString('nl-BE', { month: 'short' })}</span></div>
        <div class="ev-main">
          <div class="abs-top"><b>${U.esc(e.titel)}</b><span class="rpill" style="--accent:var(--${t.tone})">${I(t.icon, 11)}${t.label}</span></div>
          <div class="ev-meta"><span>${d.toLocaleDateString('nl-BE', { weekday: 'long' })}</span>${e.tijd ? `<span>${I('clock', 12)}${e.tijd}</span>` : ''}${e.plaats ? `<span>${I('pin', 12)}${U.esc(e.plaats)}</span>` : ''}</div>
          ${e.info ? `<div class="ev-info">${U.esc(e.info)}</div>` : ''}
          ${ctx ? rsvpLine(e, ctx) : ''}
        </div>
        <div class="abs-side">
          <span class="abs-when ${r.diff >= 0 && r.diff <= 1 ? 'hot' : ''}">${r.label}</span>
          ${admin ? `<button class="abs-del" data-ev-del="${e.id}" title="Verwijderen" aria-label="Verwijderen">${I('trash', 14)}</button>` : ''}
        </div>
      </div>`;
  };

  // reden bij afwezig: "Werk" / "Werk — late shift" / vrije tekst (= andere) ↔ { reden: id, extra }
  const AFW = App.AGENDA.AFWEZIG;
  function parseReden(txt, mijnAfw) {
    if (txt) {
      const o = AFW.find(r => r.id !== 'andere' && (txt === r.label || txt.startsWith(r.label + ' — ')));
      return o ? { reden: o.id, extra: txt.slice(o.label.length + 3) } : { reden: 'andere', extra: txt };
    }
    // afwezig gemeld die dag → die reden alvast voorstellen
    if (mijnAfw && AFW.some(r => r.id === mijnAfw.reden)) return { reden: mijnAfw.reden, extra: mijnAfw.toelichting || '' };
    return { reden: null, extra: '' };
  }
  function composeReden(id, extra) {
    extra = String(extra || '').trim();
    if (!id) return '';
    if (id === 'andere') return extra;
    const o = AFW.find(r => r.id === id);
    return (o.label + (extra ? ' — ' + extra : '')).slice(0, 140);
  }

  function detail(e, ctx) {
    const { state, me } = ctx;
    const t = typeOf(e.type), d = U.parseDay(e.datum), r = relDay(e.datum);
    const weg = absentOn(state, e.datum);
    const rs = (state.rsvps || []).filter(x => x.event_id === e.id);
    const mine = me && rs.find(x => x.user_id === me.id);
    const mijnAfw = me && weg.find(a => a.user_id === me.id);
    const sel = { status: mine ? mine.status : (mijnAfw ? 'afwezig' : null), ...parseReden(mine && mine.status === 'afwezig' ? mine.reden : null, mijnAfw) };
    const geantwoord = new Set(rs.map(x => x.user_id));
    const nogNiet = leden(state).filter(u => !geantwoord.has(u.id));
    const group = s => { const list = rs.filter(x => x.status === s.id); return `
      <div class="rs-group" style="--accent:var(--${s.tone})">
        <div class="rs-ghead">${I(s.icon, 13)}<b>${s.label}</b><span class="mono">${list.length}</span></div>
        <div class="rs-names">${list.map(x => `<span class="rs-name"><b class="tcap">${U.esc(x.user_name)}</b>${x.reden ? `<em>${U.esc(x.reden)}</em>` : ''}</span>`).join('') || '<span class="dim small">—</span>'}</div>
      </div>`; };
    C.modal.open(`
      <div class="ev-detail-head" style="--accent:var(--${t.tone})">
        <div class="ev-date lg"><b class="mono">${d.getDate()}</b><span>${d.toLocaleDateString('nl-BE', { month: 'short' })}</span></div>
        <div><span class="rpill" style="--accent:var(--${t.tone})">${I(t.icon, 11)}${t.label}</span><h3>${U.esc(e.titel)}</h3></div>
      </div>
      <ul class="qs-facts">
        <li><span>Wanneer</span><b class="tcap">${d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}${e.tijd ? ' · ' + e.tijd : ''}</b></li>
        <li><span>Plaats</span><b>${e.plaats ? U.esc(e.plaats) : '—'}</b></li>
        <li><span>Nog</span><b>${r.label}</b></li>
        <li><span>Geplaatst door</span><b>${U.esc(e.door || 'Boss')}</b></li>
      </ul>
      ${e.info ? `<p class="ev-info box">${U.esc(e.info)}</p>` : ''}
      ${me && r.diff >= 0 ? `
      <form class="rs-form" id="rs-form" autocomplete="off">
        <span class="eyebrow">Ben jij erbij?</span>
        <div class="rs-opts">${RS.map(s => `<button type="button" class="reason ${sel.status === s.id ? 'on' : ''}" data-rs="${s.id}" style="--accent:var(--${s.tone})">${I(s.icon, 16)}<span>${s.label}</span></button>`).join('')}</div>
        <div class="field" id="rs-reden-wrap" ${sel.status === 'afwezig' ? '' : 'hidden'}>
          <span>Waarom ben je er niet bij? <em>(verplicht)</em></span>
          <div class="reason-grid">${AFW.map(r => `<button type="button" class="reason ${sel.reden === r.id ? 'on' : ''}" data-rr="${r.id}" style="--accent:var(--${r.tone})">${I(r.icon, 15)}<span>${r.label}</span></button>`).join('')}</div>
          <input class="input" id="rs-reden" maxlength="110" placeholder="${sel.reden === 'andere' ? 'Typ je reden' : 'Toelichting (optioneel)'}" value="${U.esc(sel.extra || '')}">
        </div>
        ${mijnAfw && !mine ? `<p class="muted small">${I('userx', 12)} Je staat die dag als afwezig gemeld.</p>` : ''}
        <div class="err" id="rs-err"></div>
        <button class="btn cyan block" type="submit" id="rs-save" ${sel.status ? '' : 'disabled'}>${mine ? 'Antwoord wijzigen' : 'Antwoord opslaan'}</button>
      </form>` : ''}
      <div class="rs-groups">${RS.map(group).join('')}</div>
      ${nogNiet.length ? `<div class="ev-absent"><span class="eyebrow">Nog niet geantwoord (${nogNiet.length})</span><div>${nogNiet.map(u => `<span class="rpill" style="--accent:var(--muted)">${U.esc(u.name)}</span>`).join('')}</div></div>` : ''}
      ${weg.length ? `<div class="ev-absent"><span class="eyebrow">Afwezig gemeld die dag</span><div>${weg.map(a => `<span class="rpill" style="--accent:var(--rose)">${U.esc(a.user_name)}</span>`).join('')}</div></div>` : ''}`, modal => {
      const form = modal.querySelector('#rs-form');
      if (!form) return;
      const wrap = modal.querySelector('#rs-reden-wrap');
      modal.querySelectorAll('[data-rs]').forEach(b => b.addEventListener('click', () => {
        sel.status = b.dataset.rs;
        modal.querySelectorAll('[data-rs]').forEach(x => x.classList.toggle('on', x === b));
        wrap.hidden = sel.status !== 'afwezig';
        modal.querySelector('#rs-save').disabled = false;
      }));
      const txt = modal.querySelector('#rs-reden');
      modal.querySelectorAll('[data-rr]').forEach(b => b.addEventListener('click', () => {
        sel.reden = b.dataset.rr;
        modal.querySelectorAll('[data-rr]').forEach(x => x.classList.toggle('on', x === b));
        txt.placeholder = sel.reden === 'andere' ? 'Typ je reden' : 'Toelichting (optioneel)';
        if (sel.reden === 'andere') txt.focus();
      }));
      form.addEventListener('submit', ev => {
        ev.preventDefault();
        C.busy(modal.querySelector('#rs-save'), async () => {
          try {
            await App.store.setRsvp(e.id, me.id, sel.status, sel.status === 'afwezig' ? composeReden(sel.reden, txt.value) : '');
            C.modal.close(); C.toast(`Aangemeld als ${rsvpOf(sel.status).label.toLowerCase()}`);
          } catch (ex) { modal.querySelector('#rs-err').textContent = U.friendlyError(ex); }
        });
      });
    }, { wide: true });
  }

  function month({ state }) {
    const today = U.dkey(new Date());
    const base = ui.month ? U.parseDay(ui.month) : new Date();
    const y = base.getFullYear(), m = base.getMonth();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysIn = new Date(y, m + 1, 0).getDate();
    const cells = Math.ceil((offset + daysIn) / 7) * 7;
    const byDay = new Map();
    state.events.forEach(e => { if (!byDay.has(e.datum)) byDay.set(e.datum, []); byDay.get(e.datum).push(e); });
    let html = '';
    for (let i = 0; i < cells; i++) {
      const d = new Date(y, m, 1 - offset + i), k = U.dkey(d);
      const evs = (byDay.get(k) || []).sort(sortEv);
      const weg = absentOn(state, k).length;
      html += `
        <div class="ag-cell ${d.getMonth() !== m ? 'out' : ''} ${k === today ? 'today' : ''} ${k < today ? 'past' : ''} ${d.getDay() % 6 === 0 ? 'we' : ''}">
          <div class="ag-num"><b class="mono">${d.getDate()}</b>${weg ? `<span class="ag-weg" title="${weg} afwezig">${I('userx', 11)}${weg}</span>` : ''}</div>
          ${evs.slice(0, 3).map(e => { const t = typeOf(e.type); return `<button class="ag-ev" data-ev="${e.id}" style="--accent:var(--${t.tone})">${e.tijd ? `<span class="mono">${e.tijd}</span>` : ''}${U.esc(e.titel)}</button>`; }).join('')}
          ${evs.length > 3 ? `<span class="ag-more">+${evs.length - 3} meer</span>` : ''}
        </div>`;
    }
    const title = new Date(y, m, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
    return `
      <section class="card flush ag-cal">
        <div class="ag-head">
          <h3 class="tcap">${title}</h3>
          <div class="ag-nav">
            <button class="cal-nav" data-month="-1" aria-label="Vorige maand">${I('back', 15)}</button>
            <button class="btn ghost sm" data-month="0">Vandaag</button>
            <button class="cal-nav" data-month="1" aria-label="Volgende maand">${I('arrowRight', 15)}</button>
          </div>
        </div>
        <div class="ag-dow">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="ag-grid">${html}</div>
        <div class="tl-legend">${T.map(t => `<span class="tl-leg" style="--accent:var(--${t.tone})"><i></i>${t.label}</span>`).join('')}<span class="tl-leg" style="--accent:var(--rose)">${I('userx', 12)} afwezig</span></div>
      </section>`;
  }

  App.views.agenda = {
    title: () => 'Agenda',
    render(ctx) {
      const today = U.dkey(new Date());
      const komend = ctx.state.events.filter(e => e.datum >= today).sort(sortEv);
      const boss = App.boss.unlocked();
      return `
        <section class="abs-hero ag-hero">
          <div class="abs-hero-text">
            <span class="lh-eyebrow cyan">${I('calendar', 13)} Agenda</span>
            <h2>Wat staat er <span class="cyan">op de planning</span>?</h2>
            <p class="muted">Vergaderingen, acties, deals en feesten van de familia. Kan je niet? Meld het via Afwezigheid.</p>
          </div>
          <button class="btn ${boss ? 'cyan' : 'ghost'} lg" data-plaats>${I(boss ? 'plus' : 'shield', 16)} ${boss ? 'Activiteit plaatsen' : 'Plaatsen (Boss)'}</button>
        </section>
        <div class="ag-layout">
          ${month(ctx)}
          <section class="card">
            ${C.cardHead('Eerstvolgende', 'clock', `<span class="muted small">${komend.length} gepland</span>`)}
            <div class="ev-list">${komend.slice(0, 6).map(e => App.eventRow(e, false, ctx)).join('') || C.empty('Niets gepland.', 'calendar')}</div>
          </section>
        </div>`;
    },
    mount(ctx, root) {
      root.querySelector('[data-plaats]').addEventListener('click', () => App.boss.open('boss/agenda'));
      root.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => {
        const n = Number(b.dataset.month);
        const base = ui.month ? U.parseDay(ui.month) : new Date();
        ui.month = n === 0 ? null : U.dkey(new Date(base.getFullYear(), base.getMonth() + n, 1));
        App.rerender();
      }));
      root.querySelectorAll('[data-ev]').forEach(b => b.addEventListener('click', () => {
        const e = ctx.state.events.find(x => x.id === b.dataset.ev);
        if (e) detail(e, ctx);
      }));
      // #/agenda/<id> (bv. vanuit de lobby): die activiteit meteen openen, daarna de link terug naar #/agenda
      if (ctx.params[0]) {
        const e = ctx.state.events.find(x => x.id === ctx.params[0]);
        history.replaceState(null, '', location.pathname + location.search + '#/agenda');
        if (e) setTimeout(() => detail(e, ctx), 0);
      }
    }
  };
})(window.App);