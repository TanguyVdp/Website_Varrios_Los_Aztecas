/* Amfi loods: tickets voor de vaste ruil (App.AMFI.DEFAULT.ruil, aanpasbaar in Boss menu → Amfi loods).
 * Een lid maakt een ticket, de Varrios bot zet meteen in het ticket wat er mee moet. Amfi-medewerkers (vinkje in
 * het Boss menu) zien de wachtrij, nemen een ticket op, chatten en ronden af ("ruil gedaan"). Daarna heeft het lid
 * een cooldown: het aftellertje staat bovenaan de Amfi loods en rechtsboven op de kaart in de lobby. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, AM = App.AMFI;
  const ui = { tab: 'mijn' };
  const nr = t => '#' + String(t.nr).padStart(3, '0');

  const isStaff = ctx => !!(ctx.me && ctx.me.amfi_staff) || App.boss.unlocked();
  // wie de actie doet. Als gangpot werken: in een gangpot-ticket ben je de gangpot, bij andermans ticket je eigen account
  const actor = (ctx, t) => {
    const u = App.actingAs && !(t && t.user_id === ctx.me.id) ? App.realMe : ctx.me;
    return { userId: u.id, boss: App.boss.unlocked(), name: u.amfi_staff || !App.boss.unlocked() || u === ctx.me && App.actingAs ? u.name : App.boss.who(ctx) };
  };
  const isGp = ctx => !!ctx.me && App.L.isGangpot(ctx.me);   // gangpot: onbeperkt tickets, geen cooldown
  const byQueue = (a, b) => new Date(a.created_at) - new Date(b.created_at);
  const pill = (map, k) => { const s = map[k] || map.ruil; return `<span class="rpill" style="--accent:var(--${s.tone})">${I(s.icon, 11)}${s.label}</span>`; };
  const fmt = n => AM.eur(n);

  // cooldown van de ingelogde persoon (null = mag een ticket maken) — ook gebruikt in de lobby
  App.amfiCooldown = ctx => ctx.me && !isGp(ctx) ? AM.cooldownUntil(ctx.state.tickets, ctx.me.id, ctx.state.settings.amfi) : null;
  // "wo 6 nov. om 14:32" + "nog 1d 3u"
  App.amfiCooldownText = until => {
    const ms = until - Date.now(), m = Math.max(1, Math.ceil(ms / 60000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
    const left = d ? `${d}d ${h}u` : h ? `${h}u ${String(min).padStart(2, '0')}m` : `${min} min`;
    const day = until.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
    return { when: `${day} om ${U.clock(until)}`, left: `nog ${left}` };
  };

  // ---------- lijsten ----------
  function ticketRow(t, ctx, staffView) {
    const pos = AM.position(ctx.state.tickets, t), sm = AM.summary(t);
    const u = ctx.state.users.find(x => x.id === t.user_id) || { name: t.user_name };
    const last = t.messages[t.messages.length - 1];
    return `
      <div class="tk-row is-${t.status}" data-open="${t.id}" tabindex="0" role="link">
        <span class="tk-nr mono">${nr(t)}${(n => n ? `<i class="tk-new">+${n}</i>` : '')((t.user_id === ctx.me.id || t.medewerker_id === ctx.me.id) ? AM.unread(t, ctx.me.id) : 0)}</span>
        ${staffView ? C.avatar(u, 34) : `<span class="tk-ic">${I('flask', 16)}</span>`}
        <div class="tk-main">
          <div class="abs-top">${staffView ? `<b class="tcap">${U.esc(t.user_name)}</b>` : `<b>${U.num(sm.out)} ${sm.label}</b>`}${pill(AM.STATUS, t.status)}${AM.isRuil(t) ? '' : pill(AM.LEVERING, t.levering)}</div>
          <div class="tk-meta">
            <span>${U.num(sm.in)} amfetamine → ${U.num(sm.out)} ${sm.label}</span>
            ${t.levering === 'wij' ? `<span class="gold">${fmt(t.quote.te_betalen)}</span>` : ''}
            ${t.status === 'wachtrij' ? `<span class="sky">plaats ${pos} in de wachtrij</span>` : ''}
            ${t.medewerker_naam ? `<span>${I('user', 12)} <span class="tcap">${U.esc(t.medewerker_naam)}</span></span>` : ''}
          </div>
          ${last ? `<div class="tk-last">${last.from === 'bot' ? `${I('sparkle', 11)} ` : `<b class="tcap">${U.esc(last.user_name)}:</b> `}${U.esc(last.text.split('\n')[0])}</div>` : ''}
        </div>
        <div class="abs-side">
          <span class="abs-when">${U.ago(t.updated_at)}</span>
          ${staffView && t.status === 'wachtrij' ? `<button class="btn sky-btn sm" data-claim="${t.id}">${I('check', 13)} Ik help</button>` : ''}
        </div>
      </div>`;
  }

  // knop rechtsboven: naar je open ticket, nieuw ticket, of het aftellertje van je cooldown
  function heroAction(ctx, open) {
    if (open) return `<button class="btn ghost lg" data-open="${open.id}">${I('message', 16)} Naar mijn ticket ${nr(open)}</button>`;
    const until = App.amfiCooldown(ctx);
    if (until) { const c = App.amfiCooldownText(until); return `
      <div class="amfi-cd" title="Na een afgeronde ruil moet je ${AM.settings(ctx.state.settings.amfi).ruil.cooldown_uur} uur wachten">
        <span class="amfi-cd-label">${I('clock', 13)} Nieuw ticket vanaf</span>
        <b>${c.when}</b>
        <span class="amfi-cd-left mono">${c.left}</span>
      </div>`; }
    return `<button class="btn sky-btn lg" data-new>${I('plus', 16)} Nieuw ticket</button>`;
  }

  function listView(ctx) {
    const { state, me } = ctx;
    const staff = isStaff(ctx), r = AM.settings(state.settings.amfi).ruil;
    const mine = state.tickets.filter(t => t.user_id === me.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const queue = state.tickets.filter(t => t.status === 'wachtrij').sort(byQueue);
    const busy = state.tickets.filter(t => t.status === 'bezig').sort(byQueue);
    const done = state.tickets.filter(t => !AM.OPEN(t.status)).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 10);
    const tab = staff ? ui.tab : 'mijn';
    const open = isGp(ctx) ? null : mine.find(t => AM.OPEN(t.status));   // de gangpot mag altijd een nieuw ticket maken
    const canNew = !open && !App.amfiCooldown(ctx);
    return `
      <section class="abs-hero amfi-hero">
        <div class="abs-hero-text">
          <span class="lh-eyebrow sky">${I('flask', 13)} Amfi loods</span>
          <h2>Ruil via een <span class="sky">ticket</span></h2>
          <p class="muted">Breng <b>${U.num(r.amfetamine)} amfetamine</b> + <b>${fmt(r.wit_geld)}</b> wit geld + <b>${fmt(r.zwart_geld)}</b> zwart geld naar de loods en je krijgt <b>${U.num(r.mythisch_klant)} mythische</b> terug. Je komt in de wachtrij en een medewerker helpt je verder in je ticket. Na je ruil kan je pas na ${U.num(r.cooldown_uur)} uur een nieuw ticket maken.</p>
          <div class="lh-meta"><span>${I('clock', 13)} ${queue.length} in de wachtrij</span><span>${I('message', 13)} ${busy.length} in behandeling</span></div>
        </div>
        ${heroAction(ctx, open)}
      </section>
      ${staff ? `<div class="page-tools">${C.seg('tab', [{ value: 'mijn', label: 'Mijn tickets', icon: 'user', count: mine.length }, { value: 'staff', label: 'Wachtrij (medewerker)', icon: 'list', count: queue.length + busy.length }], tab)}</div>` : ''}
      ${tab === 'mijn' ? `
        <section class="card">
          ${C.cardHead('Mijn tickets', 'message')}
          <div class="tk-list">${mine.map(t => ticketRow(t, ctx, false)).join('') || `<div class="tk-empty">${C.empty('Je hebt nog geen tickets.', 'flask')}${canNew ? `<button class="btn sky-btn" data-new>${I('plus', 14)} Eerste ticket aanmaken</button>` : ''}</div>`}</div>
        </section>` : `
        <section class="card">
          ${C.cardHead('In de wachtrij', 'clock', `<span class="muted small">eerst binnen, eerst geholpen</span>`)}
          <div class="tk-list">${queue.map(t => ticketRow(t, ctx, true)).join('') || C.empty('Niemand in de wachtrij.', 'check')}</div>
        </section>
        <section class="card">
          ${C.cardHead('In behandeling', 'message')}
          <div class="tk-list">${busy.map(t => ticketRow(t, ctx, true)).join('') || C.empty('Geen tickets in behandeling.', 'inbox')}</div>
        </section>
        <section class="card">
          ${C.cardHead('Recent afgerond', 'check')}
          <div class="tk-list">${done.map(t => ticketRow(t, ctx, true)).join('') || C.empty('Nog niets afgerond.', 'inbox')}</div>
        </section>`}`;
  }

  // ---------- wat er in een ticket staat ----------
  // de ruil: wat de klant meebrengt en wat hij terugkrijgt
  function ruilHtml(q) {
    return `
      <div class="q-box">
        <span class="eyebrow">Breng mee naar de loods</span>
        <ul class="q-list">
          <li><span>Amfetamine</span><b class="mono">${U.num(q.amfetamine)}</b></li>
          <li><span>Wit geld</span><b class="mono">${fmt(q.wit_geld)}</b></li>
          <li><span>Zwart geld</span><b class="mono">${fmt(q.zwart_geld)} <i class="zw">zwart</i></b></li>
        </ul>
        <div class="q-total"><span>Je krijgt terug</span><b class="mono">${U.num(q.mythisch_klant)} mythische</b></div>
      </div>`;
  }
  // oude tickets (van vóór de ruil): boodschappenlijst of te betalen bedrag
  function quoteHtml(q) {
    if (q.type === 'ruil') return ruilHtml(q);
    if (q.levering === 'zelf') return `
      <div class="q-box">
        <span class="eyebrow">Wat je moest kopen · ${U.num(q.input)} ${q.input_label}</span>
        ${q.winkels.map(w => `
          <div class="q-shop">
            <div class="q-shop-head"><b>${U.esc(w.naam)}</b>${w.info ? `<span>${I('pin', 11)} ${U.esc(w.info)}</span>` : ''}</div>
            <ul class="q-list">${w.items.map(p => `<li><span>${U.num(p.aantal)}× ${U.esc(p.naam)}${p.prijs != null ? ` <em>à ${fmt(p.prijs)}${p.zwart ? ' zwart' : ''}</em>` : ''}</span><b class="mono">${p.totaal != null ? fmt(p.totaal) : '—'}${p.zwart ? ' <i class="zw">zwart</i>' : ''}</b></li>`).join('')}</ul>
          </div>`).join('')}
        <div class="q-total"><span>Geschatte kost</span><b class="mono">${fmt(q.kost_wit)}${q.kost_zwart ? ` <small>+ ${fmt(q.kost_zwart)} zwart</small>` : ''}</b></div>
      </div>`;
    return `
      <div class="q-box wij">
        <span class="eyebrow">Te betalen</span>
        <ul class="q-list"><li><span>${U.num(q.output)} × ${U.esc(q.output_label)} <em>à ${fmt(q.prijs_per_keer)}</em></span><b class="mono">${fmt(q.te_betalen)}</b></li></ul>
        <div class="q-total"><span>Totaal</span><b class="mono">${fmt(q.te_betalen)}</b></div>
      </div>`;
  }

  // ---------- nieuw ticket ----------
  function newTicketModal(ctx) {
    const q = AM.quote(ctx.state.settings.amfi);
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--sky)">${I('flask', 18)}</span><div><h3>Nieuw ticket</h3><p class="muted small">Vaste ruil: altijd exact ${U.num(q.amfetamine)} amfetamine per ticket.</p></div></div>
      <form class="stack" id="tk-form" autocomplete="off">
        ${ruilHtml(q)}
        <p class="muted small">${I('clock', 12)} Na je ruil kan je pas na ${U.num(q.cooldown_uur)} uur een nieuw ticket maken.</p>
        <label class="field"><span>Opmerking <em>(optioneel)</em></span><textarea class="input" id="tk-opm" rows="2" maxlength="300" placeholder="bv. liefst vandaag nog"></textarea></label>
        <div class="err" id="tk-err"></div>
        <button class="btn sky-btn block lg" type="submit" id="tk-submit">${I('message', 16)} Ticket aanmaken</button>
      </form>`, modal => {
      const $ = s => modal.querySelector(s);
      $('#tk-form').addEventListener('submit', e => {
        e.preventDefault();
        C.busy($('#tk-submit'), async () => {
          try {
            const t = await App.store.createAmfiTicket(ctx.me.id, { opmerking: $('#tk-opm').value });
            C.modal.close(); C.toast(`Ticket ${nr(t)} aangemaakt — je staat in de wachtrij`); App.go('amfi/' + t.id);
          } catch (ex) { $('#tk-err').textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  // ---------- afronden: de medewerker bevestigt dat de ruil in-game gebeurd is ----------
  function finishModal(t, ctx, go) {
    const q = t.quote;
    if (!AM.isRuil(t)) {
      C.modal.open(`<h3>Ticket ${nr(t)} afronden?</h3><p class="muted">Het ticket wordt gesloten.</p>
        <div class="row-2"><button class="btn ghost" data-modal-close>Terug</button><button class="btn primary" id="fin-ok">${I('check', 14)} Afronden</button></div>`,
      modal => modal.querySelector('#fin-ok').addEventListener('click', () => { C.modal.close(); go(); }));
      return;
    }
    const checks = [
      `${U.num(q.amfetamine)} amfetamine ontvangen`,
      `${fmt(q.wit_geld)} wit geld ontvangen <em>(voor de loods)</em>`,
      `${fmt(q.zwart_geld)} zwart geld ontvangen`,
      `${U.num(q.mythisch_klant)} mythische gegeven aan <span class="tcap">${U.esc(t.user_name)}</span>`
    ];
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--lime)">${I('check', 18)}</span><div><h3>Ruil afronden — ${nr(t)}</h3><p class="muted small">Vink alles af wat in-game gebeurd is.</p></div></div>
      <div class="fin-checks">${checks.map((c, i) => `<label class="fin-check"><input type="checkbox" data-fin="${i}"><span>${c}</span></label>`).join('')}</div>
      <p class="muted small">De loods houdt <b>${U.num(q.mythisch_loods)} mythische</b> + <b>${fmt(q.wit_geld)}</b> wit geld — dat komt op jouw naam in het overzicht van de Boss. ${U.esc(t.user_name)} kan daarna pas na ${U.num(q.cooldown_uur)} uur een nieuw ticket maken.</p>
      <div class="row-2"><button class="btn ghost" data-modal-close>Terug</button><button class="btn primary" id="fin-ok" disabled>${I('check', 14)} Ruil gedaan</button></div>`, modal => {
      const boxes = [...modal.querySelectorAll('[data-fin]')], ok = modal.querySelector('#fin-ok');
      boxes.forEach(b => b.addEventListener('change', () => { ok.disabled = !boxes.every(x => x.checked); }));
      ok.addEventListener('click', () => { C.modal.close(); go(); });
    });
  }

  // ---------- één ticket ----------
  function bubble(m, ctx) {
    const mine = m.user_id && m.user_id === ctx.me.id;
    const u = m.user_id ? (ctx.state.users.find(x => x.id === m.user_id) || { name: m.user_name }) : null;
    const who = m.from === 'bot' ? `<span class="avatar logo-av" style="--s:30px;background-image:url('assets/img/logo.png')"></span>` : C.avatar(u, 30);
    return `
      <div class="msg from-${m.from} ${mine ? 'mine' : ''}">
        ${mine ? '' : who}
        <div class="msg-body">
          <div class="msg-head"><b class="${m.from === 'bot' ? '' : 'tcap'}">${U.esc(m.user_name)}</b>${m.from === 'bot' ? '<span class="rpill" style="--accent:var(--violet)">bot</span>' : m.from === 'staff' ? '<span class="rpill" style="--accent:var(--sky)">medewerker</span>' : ''}<span class="msg-time">${U.clock(m.ts)}</span></div>
          <div class="msg-text">${U.esc(m.text).replace(/\n/g, '<br>')}</div>
        </div>
      </div>`;
  }

  function ticketView(ctx, t) {
    const staff = isStaff(ctx), owner = t.user_id === ctx.me.id;
    if (!owner && !staff) return `<a class="auth-back" href="#/amfi">${I('back', 14)} Tickets</a>${C.empty('Je hebt geen toegang tot dit ticket.', 'lock')}`;
    const pos = AM.position(ctx.state.tickets, t), open = AM.OPEN(t.status), q = t.quote, sm = AM.summary(t);
    return `
      <div class="boss-sec-head" style="--accent:var(--sky);--accent-soft:var(--sky-soft)">
        <a class="auth-back" href="#/amfi">${I('back', 14)} Tickets</a>
        <div class="bsh-title"><span class="btile-ic sm">${I('message', 18)}</span><h2>Ticket ${nr(t)}</h2>${pill(AM.STATUS, t.status)}</div>
      </div>
      <div class="tk-layout">
        <section class="card flush chat-card">
          <div class="chat" id="chat">${t.messages.map(m => bubble(m, ctx)).join('')}</div>
          ${open ? `
          <form class="chat-form" id="chat-form" autocomplete="off">
            <textarea class="input" id="chat-text" rows="1" maxlength="500" placeholder="${owner ? 'Stuur een bericht naar de medewerker…' : `Stuur een bericht naar ${U.esc(t.user_name)}…`}"></textarea>
            <button class="btn sky-btn" type="submit" aria-label="Versturen">${I('arrowRight', 16)}</button>
          </form>` : `<div class="chat-closed">${I('lock', 13)} Dit ticket is ${AM.STATUS[t.status].label.toLowerCase()} — je kan niet meer reageren.</div>`}
        </section>
        <aside class="tk-side">
          <section class="card">
            ${C.cardHead(AM.isRuil(t) ? 'Ruil' : 'Bestelling', 'flask')}
            <ul class="qs-facts">
              <li><span>Van</span><b class="tcap">${U.esc(t.user_name)}</b></li>
              <li><span>Brengt binnen</span><b>${U.num(sm.in)} amfetamine</b></li>
              <li><span>Krijgt</span><b>${U.num(sm.out)} ${sm.label}</b></li>
              ${AM.isRuil(t) ? '' : `<li><span>Ingrediënten</span><b>${(AM.LEVERING[t.levering] || AM.LEVERING.ruil).label}</b></li>`}
              <li><span>Status</span><b>${t.status === 'wachtrij' ? `plaats ${pos} in de wachtrij` : AM.STATUS[t.status].label}</b></li>
              <li><span>Medewerker</span><b class="tcap">${t.medewerker_naam ? U.esc(t.medewerker_naam) : '—'}</b></li>
              <li><span>Aangemaakt</span><b>${U.ts(t.created_at)}</b></li>
              ${t.afgerond_at ? `<li><span>Afgerond</span><b>${U.ts(t.afgerond_at)}${t.afgerond_door_naam ? ` · <span class="tcap">${U.esc(t.afgerond_door_naam)}</span>` : ''}</b></li>` : ''}
            </ul>
            ${quoteHtml(q)}
          </section>
          ${open ? `
          <section class="card tk-actions">
            ${staff && t.status === 'wachtrij' ? `<button class="btn sky-btn block" data-claim="${t.id}">${I('check', 15)} Ik help deze persoon</button>` : ''}
            ${staff && t.status === 'bezig' ? `<button class="btn primary block" data-status="klaar">${I('check', 15)} ${AM.isRuil(t) ? 'Ruil gedaan — afronden' : 'Ticket afronden'}</button>
              <button class="btn ghost block" data-status="wachtrij">${I('refresh', 14)} Terug in de wachtrij</button>` : ''}
            ${(owner && t.status === 'wachtrij') || staff ? `<button class="btn ghost block danger-text" data-status="geannuleerd">${I('x', 14)} Ticket annuleren</button>` : ''}
          </section>` : ''}
        </aside>
      </div>`;
  }

  App.views.amfi = {
    title: ctx => { const t = ctx.params[0] && ctx.state.tickets.find(x => x.id === ctx.params[0]); return t ? `Ticket ${nr(t)}` : 'Amfi loods'; },
    render(ctx) {
      if (ctx.params[0]) {
        const t = ctx.state.tickets.find(x => x.id === ctx.params[0]);
        return t ? ticketView(ctx, t) : `<a class="auth-back" href="#/amfi">${I('back', 14)} Tickets</a>${C.empty('Ticket niet gevonden.', 'inbox')}`;
      }
      return listView(ctx);
    },
    mount(ctx, root) {
      root.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => newTicketModal(ctx)));
      C.bindSeg(root, (name, value) => { ui.tab = value; App.rerender(); });
      root.querySelectorAll('[data-open]').forEach(el => {
        const go = e => { if (e.target.closest('[data-claim]')) return; App.go('amfi/' + el.dataset.open); };
        el.addEventListener('click', go);
        el.addEventListener('keydown', e => { if (e.key === 'Enter') go(e); });
      });
      root.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        C.busy(b, async () => {
          try { await App.store.claimTicket(b.dataset.claim, actor(ctx)); C.toast('Je helpt deze persoon nu'); App.go('amfi/' + b.dataset.claim); }
          catch (ex) { C.toast(U.friendlyError(ex), 'error'); }
        });
      }));
      const t = ctx.params[0] && ctx.state.tickets.find(x => x.id === ctx.params[0]);
      if (!t) return;
      // ticket bekeken → nieuwe berichten gelezen (na de render, anders herteken je midden in deze mount)
      if (App.AMFI.unread(t, ctx.me.id)) setTimeout(() => App.store.markTicketRead(t.id, ctx.me.id), 0);
      const chat = root.querySelector('#chat');
      if (chat) chat.scrollTop = chat.scrollHeight;
      const form = root.querySelector('#chat-form');
      if (form) {
        const ta = form.querySelector('#chat-text');
        const send = () => C.busy(form.querySelector('button'), async () => {
          try { await App.store.ticketMessage(t.id, actor(ctx, t), ta.value); ta.value = ''; root.querySelector('#chat-text')?.focus(); }
          catch (ex) { C.toast(U.friendlyError(ex), 'error'); }
        });
        form.addEventListener('submit', e => { e.preventDefault(); send(); });
        ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
      }
      root.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
        const st = b.dataset.status;
        const go = () => C.busy(b, async () => {
          try { await App.store.setTicketStatus(t.id, st, actor(ctx, t)); C.toast({ klaar: 'Ruil afgerond', wachtrij: 'Ticket terug in de wachtrij', geannuleerd: 'Ticket geannuleerd' }[st]); }
          catch (ex) { C.toast(U.friendlyError(ex), 'error'); }
        });
        if (st === 'klaar') finishModal(t, ctx, go);
        else if (st === 'geannuleerd') {
          C.modal.open(`<h3>Ticket ${nr(t)} annuleren?</h3><p class="muted">Het ticket wordt gesloten en verdwijnt uit de wachtrij.</p>
            <div class="row-2"><button class="btn ghost" data-modal-close>Terug</button><button class="btn ghost danger-text" id="cx-ok">${I('x', 14)} Annuleren</button></div>`,
          modal => modal.querySelector('#cx-ok').addEventListener('click', () => { C.modal.close(); go(); }));
        } else go();
      }));
    }
  };
})(window.App);
