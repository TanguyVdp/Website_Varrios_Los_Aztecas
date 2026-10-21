/* Boss menu: enkel voor leden met het vinkje "Boss menu" (Ledenlijst) en de eigenaar. Keuzemenu: Wiet loods-instellingen,
 * mededelingen, agenda, afwezigheden beoordelen, gangpot bijhouden, … */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, R = App.RULES, L = App.L;
  const ui = { tab: 'overzicht', person: 'all', limit: 30 };
  const unlocked = () => App.can('boss');

  const noBoss = () => `
    <section class="card boss-lock noaccess" style="--accent:var(--violet)">
      <span class="lock-ic tone">${I('shield', 26)}</span>
      <h2>Geen toegang tot het Boss menu</h2>
      <p class="muted">Enkel wie de Boss aanvinkte in <b>Boss menu → Ledenlijst</b> kan hier binnen.</p>
      <a class="btn ghost" href="#/lobby">${I('back', 14)} Terug naar de lobby</a>
    </section>`;
  // overzicht per persoon = beheertabel (zoals de oude app): slepen voor de volgorde, Discord, Bewerken
  function overzicht({ state, snap }) {
    const geleverd = new Map();
    state.customerLog.forEach(e => { if (e.kind !== 'correctie') geleverd.set(e.by_user_id, (geleverd.get(e.by_user_id) || 0) + e.amount); });
    const rows = [...state.users].sort((a, b) => a.sort_order - b.sort_order).map(u => {
      const p = snap.perUser.get(u.id);
      return `<tr data-row="${u.id}">
        <td><div class="who-cell">${C.avatar(u, 26)}<div class="who-name"><b>${U.esc(u.name)}</b><span>${C.rank(u, true)}${u.pin || L.isGangpot(u) ? '' : C.pill('geen Discord', 'muted')}</span></div></div></td>
        <td class="num">${U.num(u.total_ingelegd)}</td>
        <td class="num ${p.level}">${U.num(p.momInleg)}</td>
        <td class="num">${U.num(p.zakjes)}</td>
        <td class="num">${U.num(u.opgehaald)}</td>
        <td class="num lime strong">${U.num(p.momTegoed)}</td>
        <td class="num">${U.num(p.tegoed)}</td>
        <td class="num violet">${U.num(geleverd.get(u.id) || 0)}</td>
        <td class="num"><button class="btn ghost sm" data-manage="${u.id}" title="Bewerken">${I('gear', 13)}<span class="btn-label">Bewerken</span></button></td>
      </tr>`;
    }).join('');
    const t = snap.totals;
    return `
      <section class="kpi-row four">
        ${C.kpi({ label: 'Profielen', value: `${state.users.length}<span class="dim">/${R.MAX_USERS}</span>`, icon: 'users' })}
        ${C.kpi({ label: 'Totaal ingelegd', value: U.num(t.ingelegd), icon: 'sprout' })}
        ${C.kpi({ label: 'Zakjes klaar', value: U.num(t.zakjesKlaar), icon: 'box', tone: 'lime' })}
        ${C.kpi({ label: 'Nog tegoed', value: U.num(t.nogTegoed), icon: 'inbox', tone: 'violet' })}
      </section>
      <section class="card flush">
        ${C.cardHead('Overzicht per persoon', 'users', `<a class="link-more" style="color:var(--violet)" href="#/boss/leden">Ledenlijst ${I('arrowRight', 13)}</a>`)}
        <div class="table-wrap"><table class="table boss-table">
          <thead><tr><th>Naam</th><th class="num">Ingelegd</th><th class="num">Onverwerkt</th><th class="num">Zakjes</th><th class="num">Opgehaald</th><th class="num">Klaar</th><th class="num">Tegoed</th><th class="num">Aan klanten</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="muted small card-pad order-hint">Profielen, Discord, foto's, rangen, volgorde en toegang beheer je in <a href="#/boss/leden" class="violet">Boss menu → Ledenlijst</a>. Hier: Wiet loods-cijfers corrigeren en registreren namens iemand.</p>
      </section>`;
  }

  // slepen met muis of vinger: pointerdown op de greep, daarna volgen we de pointer op het hele document
  // (pointer-capture op de greep zelf gaat verloren zodra de rij in de DOM verplaatst wordt)
  function bindDrag(root) {
    const body = root.querySelector('#order-body');
    if (!body) return;
    body.querySelectorAll('[data-drag]').forEach(h => h.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      const row = h.closest('tr');
      const before = [...body.children].map(r => r.dataset.row).join();
      row.classList.add('dragging');
      document.body.classList.add('is-dragging');
      const move = ev => {
        ev.preventDefault();
        const others = [...body.children].filter(r => r !== row);
        const next = others.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
        if (next) { if (row.nextElementSibling !== next) body.insertBefore(row, next); }
        else if (body.lastElementChild !== row) body.appendChild(row);
      };
      const up = async () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        row.classList.remove('dragging');
        document.body.classList.remove('is-dragging');
        const ids = [...body.children].map(r => r.dataset.row);
        if (ids.join() === before) return;
        try { await App.store.bossSetOrder(ids); C.toast('Volgorde opgeslagen'); } catch (ex) { C.toast(U.friendlyError(ex), 'error'); App.rerender(); }
      };
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    }));
  }

  function discordModal(u) {
    C.modal.open(`
      <h3>Discord koppelen — ${U.esc(u.name)}</h3>
      <p class="muted small">Vul het Discord user-ID in (Discord → Instellingen → Geavanceerd → Ontwikkelaarsmodus aan, dan rechtsklik op iemand → "Gebruikers-ID kopiëren"). Met dit ID logt het lid in. Leeg = koppeling verwijderen (kan dan niet meer inloggen).</p>
      <form class="stack" id="dc-form" autocomplete="off">
        <input class="input mono" id="dc-id" inputmode="numeric" placeholder="bv. 123456789012345678" value="${U.esc(u.discord_id || '')}">
        <div class="err" id="dc-err"></div>
        <button class="btn violet block" type="submit">Opslaan</button>
      </form>`, modal => {
      const form = modal.querySelector('#dc-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try { const v = modal.querySelector('#dc-id').value; await App.store.bossSetDiscord(u.id, v); C.modal.close(); C.toast(v.trim() ? `Discord gekoppeld aan ${U.esc(u.name)}` : 'Discord-koppeling verwijderd'); }
          catch (ex) { modal.querySelector('#dc-err').textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  function wachtrij({ snap }) {
    const b = snap.baseline;
    return `
      <div class="grid-2">
        <section class="card">
          ${C.cardHead('Snelheid & correctie', 'gear')}
          <form class="stack" id="bl-form">
            <div class="row-2">
              <label class="field"><span>Zakjes per batch</span><input class="input mono" id="bl-size" type="number" min="1" value="${b.batch_size}"></label>
              <label class="field"><span>Minuten per batch</span><input class="input mono" id="bl-min" type="number" min="1" value="${b.batch_minutes}"></label>
            </div>
            <label class="field"><span>Zakjes-correctie <em>bovenop het model</em></span><input class="input mono" id="bl-corr" type="number" step="1" value="${b.zakjes_correctie || 0}"></label>
            <div class="err" id="bl-err"></div>
            <button class="btn primary" type="submit">Opslaan</button>
          </form>
        </section>
        <section class="card">
          ${C.cardHead('Onderhoud', b.paused ? 'pause' : 'play', b.paused ? C.pill('gepauzeerd', 'warn') : C.pill('actief', 'lime'))}
          <p class="muted">Tijdens onderhoud staat de wachtrij-klok stil. Bij hervatten wordt de pauzeduur bij de klok-offset opgeteld, zodat iedereen netjes verdergaat waar hij stond.</p>
          <ul class="qs-facts">
            <li><span>Klok-offset</span><b class="mono">${b.offset_minutes || 0} min</b></li>
            <li><span>Laatst aangepast</span><b>${b.set_by ? U.esc(b.set_by) + ' · ' : ''}${b.set_at ? U.ts(b.set_at) : '—'}</b></li>
          </ul>
          <button class="btn ${b.paused ? 'primary' : 'warn'}" id="bl-pause">${I(b.paused ? 'play' : 'pause')} ${b.paused ? 'Wachtrij hervatten' : 'Wachtrij pauzeren'}</button>
        </section>
      </div>`;
  }

  function logboek({ state }) {
    const kl = id => state.customers.find(c => c.id === id);
    const merged = [
      ...state.log.map(e => ({ ts: e.ts, person: e.user_name, html: App.loodsFeedItem(e) })),
      ...state.customerLog.map(e => {
        const k = kl(e.customer_id); const kn = k ? U.esc(k.name) : 'verwijderde klant';
        const html = e.kind === 'correctie'
          ? C.feedItem({ tone: 'muted', icon: 'pencil', ts: e.ts, delta: '✎', html: `<b>${kn}</b> — gecorrigeerd door Boss`, sub: U.esc(e.note || '') })
          : e.kind === 'levering'
          ? C.feedItem({ tone: 'violet', icon: 'euro', ts: e.ts, delta: '€' + U.price(e.total_price), html: `<b>${U.esc(e.by_user_name)}</b> verkocht ${U.num(e.amount)} aan <b>${kn}</b>`, sub: `à €${U.price(e.price_per_unit)}/stuk` })
          : C.feedItem({ tone: 'cyan', icon: 'swap', ts: e.ts, delta: `+${e.zakjes_delta}`, html: `<b>${U.esc(e.by_user_name)}</b> swapte ${U.num(e.amount)} met <b>${kn}</b>`, sub: `totaal klant ${U.num(e.cumulative_after)}` });
        return { ts: e.ts, person: e.by_user_name, html };
      })
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const list = merged.filter(m => ui.person === 'all' || m.person === ui.person);
    const people = [...new Set(state.users.map(u => u.name))];
    return `
      <section class="card">
        ${C.cardHead('Volledig logboek', 'list', `<select class="input select" id="lb-person"><option value="all">Iedereen</option>${people.map(p => `<option ${ui.person === p ? 'selected' : ''}>${U.esc(p)}</option>`).join('')}</select>`)}
        <div class="feed">${list.slice(0, ui.limit).map(m => m.html).join('') || C.empty('Niets gevonden.')}</div>
        ${list.length > ui.limit ? `<button class="btn ghost block" data-more>Meer tonen (${list.length - ui.limit})</button>` : ''}
      </section>`;
  }

  function manageModal(u, ctx) {
    const p = ctx.snap.perUser.get(u.id), gp = L.isGangpot(u), who = App.boss.who(ctx);
    C.modal.open(`
      <div class="profile-head">${C.avatar(u, 52)}<div><h3>${U.esc(u.name)} ${C.rank(u)}</h3><p class="muted small">${u.pin ? 'kan inloggen' : 'nog geen Discord'} · klaar <b class="lime mono">${U.num(p.momTegoed)}</b> · tegoed <b class="mono">${U.num(p.tegoed)}</b></p></div></div>

      <div class="mng-block">
        <span class="eyebrow">Gegevens corrigeren</span>
        <p class="muted small">Overschrijft de waarden rechtstreeks — enkel voor correcties. Wordt gelogd.</p>
        <div class="row-3">
          <label class="field"><span>Ingelegd</span><input class="input mono" id="mg-in" type="number" min="0" value="${u.total_ingelegd}"></label>
          <label class="field"><span>Opgehaald</span><input class="input mono" id="mg-op" type="number" min="0" value="${u.opgehaald}"></label>
          <label class="field"><span>Legacy</span><input class="input mono" id="mg-lg" type="number" min="0" value="${u.legacy_zakjes || 0}"></label>
        </div>
        <button class="btn violet block" id="mg-save">Correctie opslaan</button>
      </div>

      <div class="mng-block">
        <span class="eyebrow">Namens ${U.esc(u.name)} registreren</span>
        <div class="stack">
          <div class="mng-inline"><input class="input mono" id="mg-inleg" type="number" min="1" placeholder="aantal planten"><button class="btn primary" id="mg-inleg-btn">${I('sprout', 14)} Inleggen</button></div>
          <div class="mng-inline"><input class="input mono" id="mg-ophaal" type="number" min="1" placeholder="aantal zakjes"><button class="btn warn" id="mg-ophaal-btn">${I('arrowDown', 14)} Ophalen</button></div>
        </div>
      </div>

      <div class="err" id="mg-err"></div>
`, modal => {
      const $ = s => modal.querySelector(s);
      const run = (btn, fn, msg, close = true) => C.busy(btn, async () => {
        $('#mg-err').textContent = '';
        try { await fn(); if (close) C.modal.close(); C.toast(msg); } catch (ex) { $('#mg-err').textContent = U.friendlyError(ex); }
      });
      $('#mg-save').addEventListener('click', e => run(e.currentTarget, () => App.store.bossSetUserData(u.id, { total_ingelegd: $('#mg-in').value, opgehaald: $('#mg-op').value, legacy_zakjes: $('#mg-lg').value }, who), `Gegevens van ${U.esc(u.name)} gecorrigeerd`));
      $('#mg-inleg-btn').addEventListener('click', e => run(e.currentTarget, () => App.store.registerInleg(u.id, $('#mg-inleg').value), `Inleg geregistreerd voor ${U.esc(u.name)}`));
      $('#mg-ophaal-btn').addEventListener('click', e => run(e.currentTarget, () => App.store.registerOphalen(u.id, $('#mg-ophaal').value), `Ophalen geregistreerd voor ${U.esc(u.name)}`));
    }, { wide: true });
  }

  function klantenBeheer({ state }) {
    const ks = [...state.customers].sort((a, b) => a.name.localeCompare(b.name));
    return `
      <section class="card flush">
        ${C.cardHead('Klanten beheren', 'users', `<span class="muted small">${ks.length} klanten</span>`)}
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Naam</th><th>Groep</th><th class="num">Geswapt</th><th class="num">Verkocht</th><th class="num">Omzet</th><th></th></tr></thead>
          <tbody>${ks.map(k => `<tr>
            <td><b>${U.esc(k.name)}</b></td>
            <td>${k.groep ? C.pill(k.groep, 'violet') : ''}</td>
            <td class="num">${U.num(k.total_geleverd)}</td>
            <td class="num">${U.num(k.total_verkocht || 0)}</td>
            <td class="num violet">€${U.price(k.total_omzet || 0)}</td>
            <td class="num nowrap"><button class="btn ghost sm" data-kedit="${k.id}">${I('pencil', 13)} Bewerken</button> <button class="btn ghost sm danger-text" data-kdel="${k.id}">${I('trash', 13)}</button></td>
          </tr>`).join('') || `<tr><td colspan="6">${C.empty('Nog geen klanten.')}</td></tr>`}</tbody>
        </table></div>
      </section>`;
  }

  function klantModal(k, ctx) {
    C.modal.open(`
      <h3>Klant bewerken — ${U.esc(k.name)}</h3>
      <p class="muted small">Overschrijft de waarden rechtstreeks — enkel voor correcties. Wordt gelogd.</p>
      <form class="stack" id="kd-form" autocomplete="off">
        <label class="field"><span>Naam</span><input class="input" id="kd-name" maxlength="60" value="${U.esc(k.name)}"></label>
        <div class="row-2">
          <label class="field"><span>Groep</span><input class="input" id="kd-groep" maxlength="40" value="${U.esc(k.groep || '')}"></label>
          <label class="field"><span>Telefoon</span><input class="input" id="kd-phone" maxlength="30" value="${U.esc(k.phone || '')}"></label>
        </div>
        <div class="row-3">
          <label class="field"><span>Geswapt</span><input class="input mono" id="kd-g" type="number" min="0" value="${k.total_geleverd}"></label>
          <label class="field"><span>Verkocht</span><input class="input mono" id="kd-v" type="number" min="0" value="${k.total_verkocht || 0}"></label>
          <label class="field"><span>Omzet (€)</span><input class="input mono" id="kd-o" type="number" min="0" step="0.01" value="${k.total_omzet || 0}"></label>
        </div>
        <div class="err" id="kd-err"></div>
        <button class="btn violet block" type="submit">Opslaan</button>
      </form>`, modal => {
      const $ = s => modal.querySelector(s);
      $('#kd-form').addEventListener('submit', e => {
        e.preventDefault();
        C.busy($('#kd-form button[type=submit]'), async () => {
          try {
            await App.store.bossSetKlant(k.id, { name: $('#kd-name').value, groep: $('#kd-groep').value, phone: $('#kd-phone').value, total_geleverd: $('#kd-g').value, total_verkocht: $('#kd-v').value, total_omzet: $('#kd-o').value }, App.boss.who(ctx));
            C.modal.close(); C.toast('Klant bijgewerkt');
          } catch (ex) { $('#kd-err').textContent = U.friendlyError(ex); }
        });
      });
    }, { wide: true });
  }

  // ---------- ledenlijst: profielen, toegang, volgorde ----------
  function sLeden({ state }) {
    const users = [...state.users].sort((a, b) => a.sort_order - b.sort_order);
    const vrij = users.filter(u => !u.pin && !L.isGangpot(u)).length;
    return `
      <section class="card flush">
        ${C.cardHead('Ledenlijst', 'users', `<button class="btn violet sm" data-new-profile ${users.length >= R.MAX_USERS ? 'disabled' : ''}>${I('plus', 13)} Profiel aanmaken</button>`)}
        <p class="muted small card-pad">${users.length}/${R.MAX_USERS} profielen${vrij ? ` · ${vrij} zonder Discord (kunnen niet inloggen)` : ''} · ${I('grip', 12)} sleep om de volgorde te bepalen · vink aan wie toegang heeft. <b>Boss menu</b> geeft ook gangpot en opslag.</p>
        <div class="table-wrap"><table class="table boss-table leden-table">
          <thead><tr><th></th><th>Lid</th><th>Status</th>${App.ACCESS.map(a => `<th class="center">${a.label}${a.hint ? `<small>${a.hint}</small>` : ''}</th>`).join('')}<th>Discord</th><th></th></tr></thead>
          <tbody id="order-body">${users.map(u => { const gp = L.isGangpot(u); return `<tr data-row="${u.id}">
            <td class="drag-cell"><span class="drag-handle" data-drag title="Slepen om de volgorde aan te passen">${I('grip', 16)}</span></td>
            <td><div class="who-cell">${C.avatar(u, 32)}<div class="who-name"><b>${U.esc(u.name)}</b><span>${C.rank(u, true)}</span></div></div></td>
            <td>${u.owner ? `<span class="rpill" style="--accent:var(--gold)">${I('crown', 11)}eigenaar</span>` : gp ? '<span class="dim small">gangpot</span>'
              : u.pin ? `<span class="rpill" style="--accent:var(--lime)">${I('check', 11)}kan inloggen</span>` : `<span class="rpill" style="--accent:var(--warn)">${I('clock', 11)}geen Discord</span>`}</td>
            ${App.ACCESS.map(a => { const on = App.hasAccess(u, a.key); const via = on && !u.owner && !(u.access || {})[a.key] && (a.key === 'gangpot' || a.key === 'opslag');
              return `<td class="center">${gp ? (a.key === 'boss' || a.key === 'gangpot' ? '<span class="dim small">—</span>' : '<span class="dim small">altijd</span>')
              : u.owner ? `<span class="chk on locked" style="--accent:var(--${a.tone})" title="Eigenaar: altijd">${I('check', 13)}</span>`
              : via ? `<span class="chk on locked" style="--accent:var(--${a.tone})" title="Via Boss menu">${I('check', 13)}</span>`
              : `<button class="chk ${on ? 'on' : ''}" style="--accent:var(--${a.tone})" data-access="${a.key}" data-uid="${u.id}" title="${a.label}${a.hint ? ' (' + a.hint + ')' : ''}" aria-pressed="${on}">${on ? I('check', 13) : ''}</button>`}</td>`; }).join('')}
            <td><button class="discord-btn ${u.discord_id ? 'set' : ''}" data-discord="${u.id}" title="${u.discord_id ? 'Discord-ID wijzigen' : 'Discord koppelen'}">${u.discord_id ? `<span class="mono">${U.esc(u.discord_id.slice(0, 6))}…${U.esc(u.discord_id.slice(-4))}</span>${I('pencil', 12)}` : `${I('plus', 12)} Koppelen`}</button></td>
            <td class="num"><button class="btn ghost sm" data-profile-edit="${u.id}" title="Beheren">${I('gear', 13)}<span class="btn-label">Beheren</span></button></td>
          </tr>`; }).join('')}</tbody>
        </table></div>
      </section>`;
  }

  const rankBtn = (r, cur) => `<button type="button" class="reason rank-opt ${r.lead ? 'lead' : ''} ${cur === r.id ? 'on' : ''}" data-rank="${r.id}">${I(r.icon, 14)}${r.label}</button>`;
  const rankPicker = cur => `
    <div class="rank-group"><span class="rank-group-label">★ Lead</span><div class="rank-opts">${App.RANKS.filter(r => r.lead).map(r => rankBtn(r, cur)).join('')}</div></div>
    <div class="rank-group"><div class="rank-opts">${App.RANKS.filter(r => !r.lead).map(r => rankBtn(r, cur)).join('')}<button type="button" class="reason rank-opt ${cur ? '' : 'on'}" data-rank="">Geen</button></div></div>`;

  function newProfileModal() {
    const f = { rank: null, access: { ...App.ACCESS_DEFAULT }, staff: false };
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--violet)">${I('user', 18)}</span><div><h3>Profiel aanmaken</h3><p class="muted small">Het lid logt in met Discord: vul het Discord-ID in, dan kan het meteen binnen.</p></div></div>
      <form class="stack" id="np-form" autocomplete="off">
        <label class="field"><span>Naam</span><input class="input" id="np-name" maxlength="24" placeholder="bv. Carlos"></label>
        <label class="field"><span>Discord-ID</span><input class="input mono" id="np-discord" inputmode="numeric" maxlength="22" placeholder="bv. 123456789012345678">
          <small class="dim">In Discord: rechtsklik op het lid → <b>Gebruikers-ID kopiëren</b> (ontwikkelaarsmodus aan). Kan ook later.</small></label>
        <div class="field"><span>Rang</span>${rankPicker(null)}</div>
        <div class="field"><span>Toegang</span>
          <div class="acc-opts">${App.ACCESS.map(a => { const on = a.key === 'amfi_staff' ? f.staff : !!f.access[a.key]; return `<button type="button" class="acc ${on ? 'on' : ''}" data-acc="${a.key}" style="--accent:var(--${a.tone})"><span class="chk ${on ? 'on' : ''}">${on ? I('check', 13) : ''}</span>${I(a.icon, 15)}<span>${a.label}${a.hint ? ` <em>${a.hint}</em>` : ''}</span></button>`; }).join('')}</div>
        </div>
        <div class="err" id="np-err"></div>
        <button class="btn violet block" type="submit">${I('plus', 14)} Aanmaken</button>
      </form>`, modal => {
      const $ = q => modal.querySelector(q);
      modal.querySelectorAll('[data-rank]').forEach(b => b.addEventListener('click', () => { f.rank = b.dataset.rank || null; modal.querySelectorAll('[data-rank]').forEach(x => x.classList.toggle('on', x === b)); }));
      modal.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.acc;
        if (k === 'amfi_staff') { f.staff = !f.staff; if (f.staff) f.access.amfi = true; }
        else { f.access[k] = !f.access[k]; if (k === 'amfi' && !f.access.amfi) f.staff = false; }
        modal.querySelectorAll('[data-acc]').forEach(x => {
          const on = x.dataset.acc === 'amfi_staff' ? f.staff : !!f.access[x.dataset.acc];
          x.classList.toggle('on', on); const c = x.querySelector('.chk'); c.classList.toggle('on', on); c.innerHTML = on ? I('check', 13) : '';
        });
      }));
      $('#np-form').addEventListener('submit', e => {
        e.preventDefault();
        C.busy($('#np-form button[type=submit]'), async () => {
          try {
            const discord = $('#np-discord').value.trim();
            if (discord && !/^\d{15,22}$/.test(discord)) throw new Error('ONGELDIG_DISCORD_ID');
            const u = await App.store.bossCreateProfile({ name: $('#np-name').value, rank: f.rank, access: f.access, amfi_staff: f.staff });
            for (const k of ['gangpot', 'boss']) if (f.access[k]) await App.store.bossSetAccess(u.id, k, true);
            if (discord) await App.store.bossSetDiscord(u.id, discord);
            C.modal.close();
            C.toast(discord ? `Profiel ${U.esc(u.name)} aangemaakt — kan inloggen met Discord` : `Profiel ${U.esc(u.name)} aangemaakt — vul nog het Discord-ID in`);
          } catch (ex) { $('#np-err').textContent = U.friendlyError(ex); }
        });
      });
    }, { wide: true });
  }

  function profileAdminModal(u) {
    const gp = L.isGangpot(u);
    C.modal.open(`
      <div class="profile-head">
        <button class="avatar-edit" id="pa-photo" title="Foto kiezen">${C.avatar(u, 56)}<span>${I('pencil', 12)}</span></button>
        <div><h3>${U.esc(u.name)} ${C.rank(u)}</h3><p class="muted small">${u.owner ? 'eigenaar — altijd alle rechten' : gp ? 'gangpot-profiel (kan niet inloggen)' : u.pin ? 'kan inloggen met Discord' : 'nog geen Discord-ID — kan niet inloggen'}</p></div>
      </div>
      <div class="mng-block">
        <span class="eyebrow">Profielfoto</span>
        <div class="row-2">
          <button class="btn ghost" id="pa-photo-pick">${I('user', 14)} Foto kiezen</button>
          <button class="btn ghost danger-text" id="pa-photo-del" ${u.avatar_url ? '' : 'disabled'}>${I('trash', 14)} Foto verwijderen</button>
        </div>
      </div>
      ${gp ? '' : `<div class="mng-block"><span class="eyebrow">Rang</span>${rankPicker(u.rank)}</div>`}
      <div class="err" id="pa-err"></div>
      ${gp || u.owner ? '' : `<button class="btn ghost block danger-text" id="pa-del">${I('trash', 14)} Profiel verwijderen</button>`}`, modal => {
      const $ = q => modal.querySelector(q);
      const pick = () => { C.modal.close(); C.pickAvatar(u.id); };
      $('#pa-photo').addEventListener('click', pick);
      $('#pa-photo-pick').addEventListener('click', pick);
      $('#pa-photo-del').addEventListener('click', e => C.busy(e.currentTarget, async () => { await App.store.setAvatar(u.id, null); C.modal.close(); C.toast('Profielfoto verwijderd'); }));
      modal.querySelectorAll('[data-rank]').forEach(b => b.addEventListener('click', () => C.busy(b, async () => {
        try {
          await App.store.bossSetRank(u.id, b.dataset.rank);
          modal.querySelectorAll('[data-rank]').forEach(x => x.classList.toggle('on', x === b));
          const r = App.RANKS.find(x => x.id === b.dataset.rank);
          C.toast(r ? `${U.esc(u.name)} is nu ${r.label}` : `Rang van ${U.esc(u.name)} verwijderd`);
        } catch (ex) { $('#pa-err').textContent = U.friendlyError(ex); }
      })));
      $('#pa-del')?.addEventListener('click', () => confirmModal(`Profiel van ${U.esc(u.name)} verwijderen?`, 'Het logboek blijft bewaard (met naam), enkel het profiel verdwijnt. Dit kan niet ongedaan gemaakt worden.', 'Verwijderen',
        async () => { await App.store.bossDeleteProfile(u.id); C.toast('Profiel verwijderd'); }));
    }, { wide: true });
  }

  // ---------- amfi loods: prijzen + medewerkers ----------
  function prodRow(p) {
    return `<div class="prod-row">
      <input class="input" data-p="naam" maxlength="40" placeholder="Product" value="${U.esc(p.naam || '')}">
      <input class="input mono" data-p="aantal_per_keer" type="number" min="0" step="1" placeholder="0" value="${p.aantal_per_keer ?? ''}">
      <input class="input mono" data-p="prijs" type="number" min="0" step="0.01" placeholder="—" value="${p.prijs ?? ''}">
      <label class="zw-chk" title="Betalen met zwart geld"><input type="checkbox" data-p="zwart" ${p.zwart ? 'checked' : ''}><span>zwart</span></label>
      <button type="button" class="abs-del" data-prod-del title="Verwijderen">${I('trash', 13)}</button>
    </div>`;
  }
  function shopCard(w) {
    return `<div class="shop-card">
      <div class="shop-head">
        <input class="input" data-w="naam" maxlength="40" placeholder="Winkel / locatie" value="${U.esc(w.naam || '')}">
        <button type="button" class="abs-del" data-shop-del title="Winkel verwijderen">${I('trash', 13)}</button>
      </div>
      <input class="input shop-info" data-w="info" maxlength="120" placeholder="Extra info (optioneel) — bv. postcode, waar de NPC staat" value="${U.esc(w.info || '')}">
      <div class="prod-head"><span>Product</span><span>Per keer</span><span>Prijs/stuk €</span><span></span><span></span></div>
      <div class="shop-prods">${(w.producten || []).map(prodRow).join('')}</div>
      <button type="button" class="btn ghost sm" data-prod-add>${I('plus', 13)} Product</button>
    </div>`;
  }
  function sAmfi({ state }) {
    const s = state.settings.amfi;
    const leden = state.users.filter(u => !L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);
    return `
      <div class="grid-2 amfi-boss">
        <section class="card">
          ${C.cardHead('Prijzen & recept', 'euro')}
          <p class="muted small">Per <b>1 keer</b>: ${U.esc(s.input_label)} + de ingrediënten hieronder = 1 ${U.esc(s.output_label)}. Nieuwe tickets rekenen met deze waarden (bestaande tickets houden hun prijs). Prijs leeg = geen prijs (bv. zelf te halen).</p>
          <form class="stack" id="am-form" autocomplete="off">
            <div class="row-3">
              <label class="field"><span>${U.esc(s.input_label)} / keer</span><input class="input mono" id="am-in" type="number" min="0" step="1" value="${s.input_per_keer}"></label>
              <label class="field"><span>Waarde 1 poeder €</span><input class="input mono" id="am-waarde" type="number" min="0" step="1" value="${s.output_waarde}"></label>
              <label class="field"><span>Wij kopen aan € / poeder</span><input class="input mono" id="am-wij" type="number" min="0" step="1" value="${s.prijs_wij_per_keer}"></label>
            </div>
            <div class="field"><span>Ingrediënten per keer, per winkel</span>
              <div id="am-shops">${s.winkels.map(shopCard).join('')}</div>
              <button type="button" class="btn ghost sm" id="am-shop-add">${I('plus', 13)} Winkel / locatie toevoegen</button>
            </div>
            <div class="err" id="am-err"></div>
            <button class="btn sky-btn block" type="submit">Prijzen opslaan</button>
          </form>
        </section>
        <section class="card">
          ${C.cardHead('Amfi-medewerkers', 'users', `<a class="link-more" style="color:var(--violet)" href="#/boss/leden">Ledenlijst ${I('arrowRight', 13)}</a>`)}
          <p class="muted small">Wie medewerker is (wachtrij zien, tickets opnemen, chatten en afronden) vink je aan in <b>Boss menu → Ledenlijst</b>, kolom Amfi loods.</p>
          <div class="staff-chips">${leden.filter(u => u.amfi_staff).map(u => `<span class="staff-chip">${C.avatar(u, 22)}<b class="tcap">${U.esc(u.name)}</b></span>`).join('') || '<span class="dim small">Nog niemand aangevinkt.</span>'}</div>
        </section>
      </div>`;
  }

  // wie heeft een recht (vinkje of via Boss menu / eigenaar) — voor de kaarten bij Opslag en Gangpot
  function whoHasCard(state, key, title, tone, icon) {
    const leden = state.users.filter(u => !L.isGangpot(u) && App.hasAccess(u, key)).sort((a, b) => a.sort_order - b.sort_order);
    return `
        <section class="card">
          ${C.cardHead(title, icon, `<a class="link-more" style="color:var(--violet)" href="#/boss/leden">Ledenlijst ${I('arrowRight', 13)}</a>`)}
          <p class="muted small">Geen code meer nodig: wie aangevinkt is in <b>Boss menu → Ledenlijst</b> (of het Boss menu heeft) kan hier meteen in.</p>
          <div class="staff-chips">${leden.map(u => `<span class="staff-chip">${C.avatar(u, 22)}<b class="tcap">${U.esc(u.name)}</b></span>`).join('') || '<span class="dim small">Nog niemand.</span>'}</div>
        </section>`;
  }

  // ---------- opslag loods: wie heeft toegang + overzicht ----------
  function sOpslag({ state }) {
    const M = App.MISSIONS, today = U.dkey(new Date());
    const from = U.dkey(U.addDays(new Date(), -29));
    const recent = state.missions.filter(m => m.datum >= from);
    const per = new Map();
    recent.forEach(m => { const x = per.get(m.user_name) || { total: 0 }; x.total++; x[m.type] = (x[m.type] || 0) + 1; per.set(m.user_name, x); });
    const rows = [...per.entries()].sort((a, b) => b[1].total - a[1].total);
    return `
      <div class="grid-2">
        ${whoHasCard(state, 'opslag', 'Wie heeft toegang', 'warn', 'users')}
        <section class="card">
          ${C.cardHead('Missies — laatste 30 dagen', 'list', `<a class="link-more" href="#/opslag" style="color:var(--warn)">Opslag loods ${I('arrowRight', 13)}</a>`)}
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Lid</th>${M.map(m => `<th class="num">${m.short}</th>`).join('')}<th class="num">Totaal</th></tr></thead>
            <tbody>${rows.map(([n, x]) => `<tr><td class="tcap">${U.esc(n)}</td>${M.map(m => `<td class="num">${x[m.id] || 0}</td>`).join('')}<td class="num strong">${x.total}</td></tr>`).join('') || `<tr><td colspan="${M.length + 2}">${C.empty('Nog geen missies.')}</td></tr>`}</tbody>
          </table></div>
          <p class="muted small" style="margin-top:10px">Vandaag: ${M.map(m => `${m.short} ${state.missions.some(x => x.datum === today && x.type === m.id) ? '✓' : '—'}`).join(' · ')}</p>
        </section>
      </div>`;
  }

  // ---------- boss-rechten: vinkje "Boss menu" of eigenaar ----------
  App.boss = {
    unlocked,
    who: ctx => (ctx && ctx.me ? `Boss (${ctx.me.name})` : 'Boss'),
    open(target = 'boss') {
      if (unlocked()) App.go(target); else C.toast(App.ERR.GEEN_BOSS);
    }
  };

  // ---------- onderdelen van het boss menu ----------
  const ST = App.ABSENCE.STATUS;
  const SECTIONS = [
    { id: 'leden', label: 'Ledenlijst', icon: 'users', tone: 'violet',
      desc: 'Profielen aanmaken of verwijderen, Discord koppelen, foto, rang, volgorde en wie waar toegang heeft (ook Boss menu).',
      badge: ({ state }) => { const v = state.users.filter(u => !u.pin && !L.isGangpot(u)).length; return { t: `${state.users.length} profielen${v ? ` · ${v} zonder Discord` : ''}`, tone: 'violet' }; } },
    { id: 'loods', label: 'Wiet loods-instellingen', icon: 'leaf', tone: 'lime',
      desc: 'Overzicht per persoon, cijfers corrigeren, registreren namens iemand, klanten, wachtrij en logboek.',
      badge: ({ snap }) => snap.baseline.paused ? { t: 'gepauzeerd', tone: 'warn' } : { t: 'actief', tone: 'lime' } },
    { id: 'mededeling', label: 'Mededeling maken', icon: 'megaphone', tone: 'gold',
      desc: 'Zet een bericht in de lobby dat iedereen meteen ziet.',
      badge: ({ state }) => ({ t: `${state.notices.length} actief`, tone: 'gold' }) },
    { id: 'agenda', label: 'Agenda', icon: 'calendar', tone: 'cyan',
      desc: 'Plaats vergaderingen, acties, deals en feesten in de gang-agenda.',
      badge: ({ state }) => ({ t: `${state.events.filter(e => e.datum >= U.dkey(new Date())).length} gepland`, tone: 'cyan' }) },
    { id: 'afwezig', label: 'Afwezigheden', icon: 'userx', tone: 'rose',
      desc: 'Keur afwezigheden goed of af en reageer erop.',
      badge: ({ state }) => { const n = state.absences.filter(a => a.status === 'aangevraagd').length; return n ? { t: `${n} te keuren`, tone: 'warn', hot: true } : { t: 'alles bekeken', tone: 'lime' }; } },
    { id: 'gangpot', label: 'Gangpot bijhouden', icon: 'vault', tone: 'gold',
      desc: 'Wekelijkse bijdrage afvinken en bijhouden wat er in de gangpot zit.',
      badge: ({ state }) => ({ t: `${state.gangpot.items.length} items`, tone: 'gold' }) },
    { id: 'amfi', label: 'Amfi loods', icon: 'flask', tone: 'sky',
      desc: 'Recept per winkel en de prijs per poeder.',
      badge: ({ state }) => { const n = state.tickets.filter(t => t.status === 'wachtrij').length; return { t: `${n} in wachtrij`, tone: n ? 'sky' : 'lime' }; } },
    { id: 'opslag', label: 'Opslag loods', icon: 'box', tone: 'warn',
      desc: 'Zien wie toegang heeft en wie de dagelijkse missies doet.',
      badge: ({ state }) => { const t = U.dkey(new Date()); const n = App.MISSIONS.filter(m => state.missions.some(x => x.datum === t && x.type === m.id)).length; return { t: `vandaag ${n}/${App.MISSIONS.length}`, tone: n === App.MISSIONS.length ? 'lime' : 'warn' }; } },
    { id: 'website', label: 'Website', icon: 'alert', tone: 'cyan',
      desc: 'Onderhoudsscherm aan of uit: tijdens onderhoud kan enkel wie het Boss menu heeft op de site.',
      badge: ({ state }) => state.settings.site_onderhoud ? { t: 'in onderhoud', tone: 'warn', hot: true } : { t: 'open voor iedereen', tone: 'lime' } }
  ];

  // ---------- website: onderhoudsscherm ----------
  function sWebsite({ state }) {
    const on = !!state.settings.site_onderhoud;
    return `
      <section class="card">
        ${C.cardHead('Onderhoudsscherm', 'alert', on ? C.pill('in onderhoud', 'warn') : C.pill('open', 'lime'))}
        <p class="muted">${on
          ? 'De website staat <b>in onderhoud</b>. Iedereen ziet het onderhoudsscherm; enkel wie het Boss menu heeft, kan na het inloggen verder.'
          : 'De website is <b>open</b>: iedereen met een gekoppeld Discord-account kan inloggen.'}</p>
        <button class="btn ${on ? 'primary' : 'warn'}" id="ws-toggle" style="margin-top:12px">${on ? `${I('play', 14)} Website openzetten voor iedereen` : `${I('pause', 14)} In onderhoud zetten`}</button>
      </section>`;
  }

  const tonePill = (t, tone, icon) => `<span class="rpill" style="--accent:var(--${tone})">${icon ? I(icon, 12) : ''}${t}</span>`;
  App.boss.fmtItem = (it, n = it.aantal) => it.eenheid === '€' ? `€ ${U.num(n)}` : `${U.num(n)} <small>${U.esc(it.eenheid)}</small>`;

  function hub(ctx) {
    return `
      <section class="boss-hero">
        <span class="boss-hero-ic">${I('shield', 26)}</span>
        <div class="boss-hero-text">
          <span class="eyebrow">Ingelogd als ${U.esc(App.boss.who(ctx))}</span>
          <h2>Wat wil je doen?</h2>
          <p class="muted">Kies een onderdeel. Alles wat je hier aanpast, ziet de familia meteen.</p>
        </div>
      </section>
      <div class="boss-grid">
        ${SECTIONS.map(s => { const b = s.badge(ctx); return `
          <a class="btile" href="#/boss/${s.id}" style="--accent:var(--${s.tone});--accent-soft:var(--${s.tone}-soft)">
            <span class="btile-ic">${I(s.icon, 22)}</span>
            <div class="btile-body"><h4>${s.label}</h4><p>${s.desc}</p></div>
            <div class="btile-foot">${b ? `<span class="rpill ${b.hot ? 'hot' : ''}" style="--accent:var(--${b.tone})">${b.t}</span>` : '<span></span>'}<span class="dept-go">${I('arrowRight', 16)}</span></div>
          </a>`; }).join('')}
      </div>`;
  }

  function secHead(s, right = '') {
    return `
      <div class="boss-sec-head" style="--accent:var(--${s.tone});--accent-soft:var(--${s.tone}-soft)">
        <a class="auth-back" href="#/boss">${I('back', 14)} Boss menu</a>
        <div class="bsh-title"><span class="btile-ic sm">${I(s.icon, 18)}</span><h2>${s.label}</h2></div>
        <div class="bsh-right">${right}</div>
      </div>`;
  }

  // ---- mededelingen ----
  const ui2 = { soort: 'info', tag: false, type: 'vergadering', datum: null, abs: 'aangevraagd' };
  const NOTICE_MAX = 1500;   // zelfde limiet als fn_add_notice (supabase/update-v2-mededeling-lang.sql)
  // ondertekening van een mededeling: rang uit de Ledenlijst + naam, bv. "Kapitein Bob V."
  const signName = u => { const r = App.RANKS.find(x => x.id === u.rank); return r ? `${r.label} ${u.name}` : u.name; };
  function sMededeling({ state, me }) {
    const K = App.NOTICE.KINDS;
    const leden = state.users.filter(u => !L.isGangpot(u)).sort((a, b) => a.sort_order - b.sort_order);
    if (!ui2.door || !leden.some(u => u.id === ui2.door)) ui2.door = me ? me.id : (leden[0] && leden[0].id);
    return `
      <div class="grid-2">
        <section class="card">
          ${C.cardHead('Nieuwe mededeling', 'megaphone')}
          <form class="stack" id="nt-form" autocomplete="off">
            <label class="field"><span>Titel</span><input class="input" id="nt-titel" maxlength="80" placeholder="bv. Vergadering verplaatst"></label>
            <label class="field"><span>Bericht <em class="dim mono" id="nt-count">0/${NOTICE_MAX}</em></span><textarea class="input" id="nt-tekst" rows="6" maxlength="${NOTICE_MAX}" placeholder="Wat moet de familia weten?"></textarea></label>
            <div class="field"><span>Soort</span><div class="reason-grid">${K.map(k => `<button type="button" class="reason ${ui2.soort === k.id ? 'on' : ''}" data-soort="${k.id}" style="--accent:var(--${k.tone})">${I(k.icon, 16)}<span>${k.label}</span></button>`).join('')}</div></div>
            <div class="field"><span>Tag in Discord</span>
              <button type="button" class="reason tag-chk ${ui2.tag ? 'on' : ''}" id="nt-tag" aria-pressed="${ui2.tag}" style="--accent:var(--violet)"><span class="box">${I('check', 12)}</span><span>@Varrios Los Aztecas taggen</span></button>
              <small class="muted">Aangevinkt = iedereen met die rol krijgt een melding in Discord.</small></div>
            <label class="field"><span>Geplaatst door</span>
              <select class="input select" id="nt-door">${leden.map(u => `<option value="${u.id}" ${u.id === ui2.door ? 'selected' : ''}>${U.esc(signName(u))}${me && u.id === me.id ? ' (jij)' : ''}</option>`).join('')}</select>
              <small class="muted">Staat onder de mededeling in de lobby en in Discord. De rang komt uit de Ledenlijst.</small></label>
            <div class="err" id="nt-err"></div>
            <button class="btn gold block lg" type="submit">${I('megaphone', 16)} Plaatsen in de lobby</button>
          </form>
        </section>
        <section class="card">
          ${C.cardHead('Staat nu in de lobby', 'list', `<span class="muted small">${state.notices.length}</span>`)}
          <div class="notice-list">${state.notices.map(n => App.noticeCard(n, true)).join('') || C.empty('Geen mededelingen.', 'megaphone')}</div>
        </section>
      </div>`;
  }

  // ---- agenda ----
  function sAgenda({ state }) {
    const T = App.AGENDA.TYPES;
    const today = U.dkey(new Date());
    const komend = state.events.filter(e => e.datum >= today).sort((a, b) => (a.datum + (a.tijd || '')).localeCompare(b.datum + (b.tijd || '')));
    return `
      <div class="grid-2">
        <section class="card">
          ${C.cardHead('Nieuw in de agenda', 'plus')}
          <form class="stack" id="ev-form" autocomplete="off">
            <label class="field"><span>Titel</span><input class="input" id="ev-titel" maxlength="80" placeholder="bv. Familievergadering"></label>
            <div class="field"><span>Soort</span><div class="reason-grid">${T.map(t => `<button type="button" class="reason ${ui2.type === t.id ? 'on' : ''}" data-type="${t.id}" style="--accent:var(--${t.tone})">${I(t.icon, 16)}<span>${t.label}</span></button>`).join('')}</div></div>
            <div class="field"><span>Datum</span>
              <button type="button" class="date-trigger" id="ev-trigger"><div class="dt-part"><small>Dag</small><b id="ev-dag">Kies een dag</b></div><span class="dt-ic cyan">${I('calendar', 16)}</span></button>
              <div class="cal-pop" id="ev-cal" hidden></div>
            </div>
            <div class="row-2">
              <label class="field"><span>Uur <em>(optioneel)</em></span><input class="input mono" id="ev-tijd" type="time"></label>
              <label class="field"><span>Plaats <em>(optioneel)</em></span><input class="input" id="ev-plaats" maxlength="80" placeholder="bv. Clubhuis"></label>
            </div>
            <label class="field"><span>Info <em>(optioneel)</em></span><textarea class="input" id="ev-info" rows="2" maxlength="300" placeholder="Wat moet iedereen weten of meebrengen?"></textarea></label>
            <div class="err" id="ev-err"></div>
            <button class="btn cyan block lg" type="submit">${I('calendar', 16)} In de agenda zetten</button>
          </form>
        </section>
        <section class="card">
          ${C.cardHead('Gepland', 'calendar', `<a class="link-more cyan" href="#/agenda">Agenda ${I('arrowRight', 13)}</a>`)}
          <div class="ev-list">${komend.map(e => App.eventRow(e, true, { state, me: null })).join('') || C.empty('Niets gepland.', 'calendar')}</div>
        </section>
      </div>`;
  }

  // ---- afwezigheden beoordelen ----
  function sAfwezig({ state }) {
    const list = state.absences.filter(a => ui2.abs === 'alles' || a.status === ui2.abs)
      .sort((a, b) => ui2.abs === 'aangevraagd' ? a.van.localeCompare(b.van) : b.van.localeCompare(a.van));
    const count = s => state.absences.filter(a => a.status === s).length;
    return `
      <section class="card">
        ${C.seg('abs', [
          { value: 'aangevraagd', label: 'Te keuren', count: count('aangevraagd') },
          { value: 'goedgekeurd', label: 'Goedgekeurd', count: count('goedgekeurd') },
          { value: 'afgekeurd', label: 'Afgekeurd', count: count('afgekeurd') },
          { value: 'alles', label: 'Alles', count: state.absences.length }], ui2.abs)}
        <div class="abs-list review">${list.map(a => App.absRow(a, { state, me: null }, U.dkey(new Date()), { review: true })).join('') || C.empty(ui2.abs === 'aangevraagd' ? 'Niets te keuren — alles is bekeken.' : 'Niets gevonden.', 'check')}</div>
      </section>`;
  }

  function reviewModal(a, status, ctx) {
    const st = status ? ST[status] : null;
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--${st ? st.tone : 'violet'})">${I(st ? st.icon : 'message', 18)}</span>
        <div><h3>${status === 'goedgekeurd' ? 'Goedkeuren' : status === 'afgekeurd' ? 'Afkeuren' : 'Reageren'}</h3>
        <p class="muted small"><b class="tcap">${U.esc(a.user_name)}</b> · ${U.dayLabel(a.van)}${a.tot !== a.van ? ' → ' + U.dayLabel(a.tot) : ''}</p></div></div>
      <form class="stack" id="rv-form">
        <label class="field"><span>Reactie ${status ? '<em>(optioneel)</em>' : ''}</span><textarea class="input" id="rv-txt" rows="3" maxlength="200" placeholder="${status === 'afgekeurd' ? 'Waarom niet? bv. we hebben je nodig op de vergadering.' : 'bv. Oké, geniet ervan!'}">${a.reactie && !status ? U.esc(a.reactie) : ''}</textarea></label>
        <div class="err" id="rv-err"></div>
        <button class="btn ${status === 'afgekeurd' ? 'danger' : status ? 'primary' : 'violet'} block" type="submit">${status === 'goedgekeurd' ? 'Goedkeuren' : status === 'afgekeurd' ? 'Afkeuren' : 'Reactie plaatsen'}</button>
      </form>`, modal => {
      const form = modal.querySelector('#rv-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try {
            await App.store.reviewAfwezigheid(a.id, { status, reactie: modal.querySelector('#rv-txt').value }, App.boss.who(ctx));
            C.modal.close();
            C.toast(status === 'goedgekeurd' ? 'Afwezigheid goedgekeurd' : status === 'afgekeurd' ? 'Afwezigheid afgekeurd' : 'Reactie geplaatst');
          } catch (ex) { modal.querySelector('#rv-err').textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  // ---- gangpot bijhouden ----
  // bewerkbaar raster van de gangpot — ook gebruikt op de pagina Gangpot (met de gangpot-code)
  App.gangpotEditGrid = items => `
        <div class="gp-grid">${items.map(it => `
          <div class="gp-item">
            <div class="gp-top"><span>${U.esc(it.naam)}</span><button class="abs-del" data-gp-del="${it.id}" title="Item verwijderen">${I('trash', 13)}</button></div>
            <b class="mono">${App.boss.fmtItem(it)}</b>
            <div class="gp-btns">
              <button class="btn ghost" data-gp-mut="${it.id}" data-dir="-1">${I('minus', 14)} Eruit</button>
              <button class="btn ghost" data-gp-mut="${it.id}" data-dir="1">${I('plus', 14)} Erbij</button>
            </div>
          </div>`).join('') || C.empty('Nog niets in de gangpot.', 'vault')}</div>`;

  // wie de wijziging deed: de Boss, of het ingelogde lid met het vinkje "Gangpot aanpassen"
  const gpWho = ctx => unlocked() ? App.boss.who(ctx) : (ctx.me ? ctx.me.name : 'Gangpot');

  App.bindGangpotEdit = (root, ctx) => {
    root.querySelectorAll('[data-gp-new]').forEach(b => b.addEventListener('click', () => gpNewModal(ctx)));
    root.querySelectorAll('[data-gp-mut]').forEach(b => b.addEventListener('click', () => {
      const it = ctx.state.gangpot.items.find(x => x.id === b.dataset.gpMut);
      if (it) gpMutModal(it, Number(b.dataset.dir), ctx);
    }));
    root.querySelectorAll('[data-gp-del]').forEach(b => b.addEventListener('click', () => {
      const it = ctx.state.gangpot.items.find(x => x.id === b.dataset.gpDel);
      if (it) confirmModal(`${U.esc(it.naam)} verwijderen?`, 'Het item verdwijnt uit de gangpot (de historiek blijft).', 'Verwijderen', async () => { await App.store.deleteGangpotItem(it.id); C.toast('Item verwijderd'); });
    }));
  };

  // wekelijkse bijdrage afvinken (week = vervaldag; pijltjes = vorige/volgende week)
  const payUi = { offset: 0 };
  function payCard(state) {
    const week = App.gangpotDue(U.addDays(new Date(), 7 * payUi.offset));
    const leden = App.gangpotMembers(state);
    const betaald = leden.filter(u => App.gangpotPaid(state, u.id, week)).length;
    return `
      <section class="card">
        ${C.cardHead('Wekelijkse bijdrage', 'users', `
          <div class="ag-nav">
            <button class="cal-nav" data-payweek="-1" aria-label="Vorige week">${I('back', 15)}</button>
            <span class="pay-weeklabel">${payUi.offset === 0 ? 'Deze week' : payUi.offset === -1 ? 'Vorige week' : payUi.offset === 1 ? 'Volgende week' : 'Week van'} · <b>${App.gangpotDueLabel(week)}</b></span>
            <button class="cal-nav" data-payweek="1" aria-label="Volgende week" ${payUi.offset >= 1 ? 'disabled' : ''}>${I('arrowRight', 15)}</button>
          </div>`)}
        <p class="muted small">Vink aan wie de gangpot betaald heeft. Te betalen tegen woensdag — wie dan nog niet aangevinkt is, staat op <b class="danger">te laat</b>. <b class="mono">${betaald}/${leden.length}</b> betaald.</p>
        <div class="staff-list pay-checks">${leden.map(u => { const p = App.gangpotPaid(state, u.id, week); return `
          <button class="staff-row ${p ? 'on paid' : ''}" data-pay="${u.id}" data-week="${week}" aria-pressed="${!!p}">
            <span class="chk ${p ? 'on' : ''}" style="--accent:var(--lime)">${p ? I('check', 13) : ''}</span>${C.avatar(u, 26)}<b class="tcap">${U.esc(u.name)}</b>
            <span class="muted small">${p ? `betaald ${U.date(p.paid_at)}` : ''}</span>
          </button>`; }).join('') || C.empty('Nog geen leden.', 'users')}</div>
        ${leden.length && betaald < leden.length ? `<button class="btn ghost sm" data-pay-all="${week}" style="margin-top:10px">${I('check', 13)} Iedereen op betaald zetten</button>` : ''}
      </section>`;
  }

  function sGangpot({ state }) {
    const items = [...state.gangpot.items].sort((a, b) => a.sort_order - b.sort_order);
    const log = [...state.gangpot.log].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 12);
    return `
      ${whoHasCard(state, 'gangpot', 'Wie mag de gangpot aanpassen', 'gold', 'users')}
      ${payCard(state)}
      <section class="card">
        ${C.cardHead('Wat zit er in de gangpot', 'vault', `<button class="btn gold" data-gp-new>${I('plus', 14)} Item toevoegen</button>`)}
        ${App.gangpotEditGrid(items)}
      </section>
      <section class="card">
        ${C.cardHead('Laatste wijzigingen', 'list', `<a class="link-more gold" href="#/gangpot">Gangpot ${I('arrowRight', 13)}</a>`)}
        <div class="feed">${log.map(App.gangpotFeedItem).join('') || C.empty('Nog geen wijzigingen.')}</div>
      </section>`;
  }

  App.gangpotFeedItem = e => C.feedItem({
    tone: e.delta > 0 ? 'lime' : 'warn', icon: e.delta > 0 ? 'plus' : 'minus', ts: e.ts,
    delta: `${e.delta > 0 ? '+' : '−'}${e.eenheid === '€' ? '€' : ''}${U.num(Math.abs(e.delta))}`,
    html: `<b>${U.esc(e.item_naam)}</b> ${e.delta > 0 ? 'erbij' : 'eruit'}${e.note ? ` — ${U.esc(e.note)}` : ''}`,
    sub: `nu ${e.eenheid === '€' ? '€ ' + U.num(e.aantal_after) : U.num(e.aantal_after) + ' ' + U.esc(e.eenheid)} · door ${U.esc(e.door)}`
  });

  function gpMutModal(it, dir, ctx) {
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--${dir > 0 ? 'lime' : 'warn'})">${I(dir > 0 ? 'plus' : 'minus', 18)}</span>
        <div><h3>${U.esc(it.naam)} ${dir > 0 ? 'erbij' : 'eruit'}</h3><p class="muted small">Nu in de pot: ${App.boss.fmtItem(it)}</p></div></div>
      <form class="stack" id="gm-form" autocomplete="off">
        <label class="field"><span>Hoeveel ${it.eenheid === '€' ? '(€)' : `(${U.esc(it.eenheid)})`}</span><input class="input lg mono" id="gm-n" type="number" min="1" step="1" inputmode="numeric" placeholder="0"></label>
        <label class="field"><span>Waarom <em>(optioneel)</em></span><input class="input" id="gm-note" maxlength="120" placeholder="${dir > 0 ? 'bv. opbrengst deal' : 'bv. meegegeven aan Kenzo'}"></label>
        <div class="err" id="gm-err"></div>
        <button class="btn ${dir > 0 ? 'primary' : 'warn'} block" type="submit">${dir > 0 ? 'Toevoegen' : 'Eruit halen'}</button>
      </form>`, modal => {
      const form = modal.querySelector('#gm-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try {
            const n = Number(modal.querySelector('#gm-n').value);
            if (!(n > 0)) throw new Error('ONGELDIG_AANTAL');
            await App.store.mutateGangpot(it.id, dir * n, modal.querySelector('#gm-note').value, gpWho(ctx));
            C.modal.close(); C.toast('Gangpot bijgewerkt');
          } catch (ex) { modal.querySelector('#gm-err').textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  function gpNewModal(ctx) {
    C.modal.open(`
      <div class="af-head"><span class="af-ic" style="--accent:var(--gold)">${I('vault', 18)}</span><div><h3>Item toevoegen</h3><p class="muted small">Bv. Cash, Wapens, Munitie, Drugs ...</p></div></div>
      <form class="stack" id="gn-form" autocomplete="off">
        <label class="field"><span>Naam</span><input class="input" id="gn-naam" maxlength="40" placeholder="bv. Shotguns"></label>
        <div class="row-2">
          <label class="field"><span>Eenheid</span><input class="input" id="gn-eenheid" maxlength="12" placeholder="stuks / € / dozen" list="gn-units"></label>
          <label class="field"><span>Nu in de pot</span><input class="input mono" id="gn-aantal" type="number" min="0" step="1" value="0"></label>
        </div>
        <datalist id="gn-units"><option value="stuks"><option value="€"><option value="dozen"><option value="zakjes"><option value="kg"></datalist>
        <div class="err" id="gn-err"></div>
        <button class="btn gold block" type="submit">Toevoegen</button>
      </form>`, modal => {
      const form = modal.querySelector('#gn-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try {
            await App.store.addGangpotItem({ naam: modal.querySelector('#gn-naam').value, eenheid: modal.querySelector('#gn-eenheid').value, aantal: modal.querySelector('#gn-aantal').value }, gpWho(ctx));
            C.modal.close(); C.toast('Item toegevoegd');
          } catch (ex) { modal.querySelector('#gn-err').textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  function confirmModal(title, text, label, fn) {
    C.modal.open(`
      <h3>${title}</h3><p class="muted">${text}</p><div class="err" id="cf-err"></div>
      <div class="row-2"><button class="btn ghost" data-modal-close>Annuleren</button><button class="btn ghost danger-text" id="cf-ok">${I('trash', 14)} ${label}</button></div>`, modal => {
      modal.querySelector('#cf-ok').addEventListener('click', e => C.busy(e.currentTarget, async () => {
        try { await fn(); C.modal.close(); } catch (ex) { modal.querySelector('#cf-err').textContent = U.friendlyError(ex); }
      }));
    });
  }

  App.views.boss = {
    title: ctx => { const s = SECTIONS.find(x => x.id === ctx.params[0]); return s && unlocked() ? s.label : 'Boss menu'; },
    render(ctx) {
      if (!unlocked()) return noBoss();
      const s = SECTIONS.find(x => x.id === ctx.params[0]);
      if (!s) return hub(ctx);
      if (s.id === 'loods') {
        const tabs = { overzicht, klanten: klantenBeheer, wachtrij, logboek };
        return `${secHead(s)}
          <div class="page-tools">${C.seg('tab', [{ value: 'overzicht', label: 'Overzicht', icon: 'users' }, { value: 'klanten', label: 'Klanten', icon: 'user' }, { value: 'wachtrij', label: 'Wachtrij', icon: 'clock' }, { value: 'logboek', label: 'Logboek', icon: 'list' }], ui.tab)}</div>
          ${tabs[ui.tab](ctx)}`;
      }
      const body = { leden: sLeden, mededeling: sMededeling, agenda: sAgenda, afwezig: sAfwezig, gangpot: sGangpot, opslag: sOpslag, amfi: sAmfi, website: sWebsite }[s.id];
      return secHead(s) + body(ctx);
    },
    mount(ctx, root) {
      if (!unlocked()) return;
      const sec = ctx.params[0];
      const who = App.boss.who(ctx);

      if (sec === 'loods') {
        C.bindSeg(root, (name, value) => { ui[name] = value; App.rerender(); });
        root.querySelector('[data-more]')?.addEventListener('click', () => { ui.limit += 30; App.rerender(); });
        root.querySelector('#lb-person')?.addEventListener('change', e => { ui.person = e.target.value; ui.limit = 30; App.rerender(); });
        const form = root.querySelector('#bl-form');
        form?.addEventListener('submit', e => {
          e.preventDefault();
          C.busy(form.querySelector('button[type=submit]'), async () => {
            try {
              await App.store.setBaseline({ batch_size: Number(root.querySelector('#bl-size').value), batch_minutes: Number(root.querySelector('#bl-min').value), zakjes_correctie: Math.round(Number(root.querySelector('#bl-corr').value) || 0) }, who);
              C.toast('Wachtrij-instellingen opgeslagen');
            } catch (ex) { root.querySelector('#bl-err').textContent = U.friendlyError(ex); }
          });
        });
        root.querySelectorAll('[data-manage]').forEach(b => b.addEventListener('click', () => {
          const u = ctx.state.users.find(x => x.id === b.dataset.manage); if (u) manageModal(u, ctx);
        }));
        root.querySelectorAll('[data-kedit]').forEach(b => b.addEventListener('click', () => {
          const k = ctx.state.customers.find(x => x.id === b.dataset.kedit); if (k) klantModal(k, ctx);
        }));
        root.querySelectorAll('[data-kdel]').forEach(b => b.addEventListener('click', () => {
          const k = ctx.state.customers.find(x => x.id === b.dataset.kdel);
          if (k) confirmModal(`Klant ${U.esc(k.name)} verwijderen?`, 'De geschiedenis blijft bewaard (als "verwijderde klant"), enkel de klantfiche verdwijnt.', 'Verwijderen', async () => { await App.store.bossDeleteKlant(k.id); C.toast('Klant verwijderd'); });
        }));
        const pause = root.querySelector('#bl-pause');
        pause?.addEventListener('click', () => C.busy(pause, async () => {
          const paused = !ctx.snap.baseline.paused;
          await App.store.setBaseline({ paused }, who);
          C.toast(paused ? 'Wachtrij gepauzeerd' : 'Wachtrij hervat');
        }));
      }

      if (sec === 'mededeling') {
        root.querySelectorAll('[data-soort]').forEach(b => b.addEventListener('click', () => {
          ui2.soort = b.dataset.soort; root.querySelectorAll('[data-soort]').forEach(x => x.classList.toggle('on', x === b));
        }));
        root.querySelector('#nt-door').addEventListener('change', e => { ui2.door = e.target.value; });
        const txt = root.querySelector('#nt-tekst'), count = root.querySelector('#nt-count');
        txt.addEventListener('input', () => { count.textContent = `${txt.value.length}/${NOTICE_MAX}`; });
        const tagBtn = root.querySelector('#nt-tag');
        tagBtn.addEventListener('click', () => { ui2.tag = !ui2.tag; tagBtn.classList.toggle('on', ui2.tag); tagBtn.setAttribute('aria-pressed', ui2.tag); });
        const form = root.querySelector('#nt-form');
        form.addEventListener('submit', e => {
          e.preventDefault();
          C.busy(form.querySelector('button[type=submit]'), async () => {
            try {
              const by = ctx.state.users.find(u => u.id === root.querySelector('#nt-door').value);
              await App.store.addMededeling({ titel: root.querySelector('#nt-titel').value, tekst: root.querySelector('#nt-tekst').value, soort: ui2.soort, tag: ui2.tag }, by ? signName(by) : who);
              ui2.tag = false; C.toast('Mededeling staat in de lobby');
            }
            catch (ex) { root.querySelector('#nt-err').textContent = U.friendlyError(ex); }
          });
        });
        root.querySelectorAll('[data-nt-del]').forEach(b => b.addEventListener('click', () =>
          confirmModal('Mededeling verwijderen?', 'Ze verdwijnt uit de lobby.', 'Verwijderen', async () => { await App.store.deleteMededeling(b.dataset.ntDel); C.toast('Mededeling verwijderd'); })));
      }

      if (sec === 'agenda') {
        root.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
          ui2.type = b.dataset.type; root.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('on', x === b));
        }));
        const pop = root.querySelector('#ev-cal'), trig = root.querySelector('#ev-trigger');
        const showDay = () => { root.querySelector('#ev-dag').textContent = ui2.datum ? U.dayLabel(ui2.datum) : 'Kies een dag'; };
        C.rangeCalendar(pop, { single: true, start: ui2.datum, end: ui2.datum, min: U.dkey(new Date()), onChange(s) { ui2.datum = s; showDay(); setTimeout(() => { pop.hidden = true; trig.classList.remove('open'); }, 180); } });
        trig.addEventListener('click', () => { pop.hidden = !pop.hidden; trig.classList.toggle('open', !pop.hidden); });
        showDay();
        const form = root.querySelector('#ev-form');
        form.addEventListener('submit', e => {
          e.preventDefault();
          C.busy(form.querySelector('button[type=submit]'), async () => {
            try {
              await App.store.addEvent({ titel: root.querySelector('#ev-titel').value, type: ui2.type, datum: ui2.datum, tijd: root.querySelector('#ev-tijd').value, plaats: root.querySelector('#ev-plaats').value, info: root.querySelector('#ev-info').value }, who);
              ui2.datum = null; C.toast('Staat in de agenda');
            } catch (ex) { root.querySelector('#ev-err').textContent = U.friendlyError(ex); }
          });
        });
        root.querySelectorAll('[data-ev-del]').forEach(b => b.addEventListener('click', () =>
          confirmModal('Uit de agenda halen?', 'Deze activiteit wordt verwijderd.', 'Verwijderen', async () => { await App.store.deleteEvent(b.dataset.evDel); C.toast('Activiteit verwijderd'); })));
      }

      if (sec === 'afwezig') {
        C.bindSeg(root, (name, value) => { ui2.abs = value; App.rerender(); });
        root.querySelectorAll('[data-review]').forEach(b => b.addEventListener('click', () => {
          const a = ctx.state.absences.find(x => x.id === b.dataset.id);
          if (a) reviewModal(a, b.dataset.review || null, ctx);
        }));
        root.querySelectorAll('[data-abs-del]').forEach(b => b.addEventListener('click', () => {
          const a = ctx.state.absences.find(x => x.id === b.dataset.absDel);
          if (!a) return;
          const per = `${U.dayLabel(a.van)}${a.tot !== a.van ? ' → ' + U.dayLabel(a.tot) : ''}`;
          confirmModal(`Afwezigheid van ${U.esc(a.user_name)} schrappen?`, `De melding van ${per} verdwijnt volledig (ook uit de planning en de agenda). Dit kan niet ongedaan gemaakt worden.`, 'Schrappen',
            async () => { await App.store.bossDeleteAfwezigheid(a.id); C.toast('Afwezigheid geschrapt'); });
        }));
      }

      if (sec === 'leden') {
        bindDrag(root);
        root.querySelector('[data-new-profile]')?.addEventListener('click', newProfileModal);
        root.querySelectorAll('[data-discord]').forEach(b => b.addEventListener('click', () => {
          const u = ctx.state.users.find(x => x.id === b.dataset.discord); if (u) discordModal(u);
        }));
        root.querySelectorAll('[data-profile-edit]').forEach(b => b.addEventListener('click', () => {
          const u = ctx.state.users.find(x => x.id === b.dataset.profileEdit); if (u) profileAdminModal(u);
        }));
        root.querySelectorAll('[data-access]').forEach(b => b.addEventListener('click', () => {
          const u = ctx.state.users.find(x => x.id === b.dataset.uid), a = App.ACCESS.find(x => x.key === b.dataset.access);
          if (!u || !a) return;
          const on = !App.hasAccess(u, a.key);
          C.busy(b, async () => { await App.store.bossSetAccess(u.id, a.key, on); C.toast(`${U.esc(u.name)}: ${on ? 'toegang tot' : 'geen toegang meer tot'} ${a.label}${a.hint ? ' (' + a.hint + ')' : ''}`); });
        }));
      }

      if (sec === 'amfi') {
        const shops = root.querySelector('#am-shops');
        const bind = () => {
          shops.querySelectorAll('[data-prod-del]').forEach(b => { b.onclick = () => b.closest('.prod-row').remove(); });
          shops.querySelectorAll('[data-shop-del]').forEach(b => { b.onclick = () => b.closest('.shop-card').remove(); });
          shops.querySelectorAll('[data-prod-add]').forEach(b => { b.onclick = () => {
            const list = b.closest('.shop-card').querySelector('.shop-prods');
            list.insertAdjacentHTML('beforeend', prodRow({})); bind(); list.lastElementChild.querySelector('input').focus();
          }; });
        };
        bind();
        root.querySelector('#am-shop-add').addEventListener('click', () => { shops.insertAdjacentHTML('beforeend', shopCard({ producten: [{}] })); bind(); shops.lastElementChild.querySelector('input').focus(); });
        const form = root.querySelector('#am-form');
        form.addEventListener('submit', e => {
          e.preventDefault();
          C.busy(form.querySelector('button[type=submit]'), async () => {
            try {
              const winkels = [...shops.querySelectorAll('.shop-card')].map(c => ({
                naam: c.querySelector('[data-w="naam"]').value, info: c.querySelector('[data-w="info"]').value,
                producten: [...c.querySelectorAll('.prod-row')].map(r => ({
                  naam: r.querySelector('[data-p="naam"]').value, aantal_per_keer: r.querySelector('[data-p="aantal_per_keer"]').value,
                  prijs: r.querySelector('[data-p="prijs"]').value, zwart: r.querySelector('[data-p="zwart"]').checked
                })).filter(p => p.naam.trim() || p.aantal_per_keer || p.prijs)
              })).filter(w => w.naam.trim() || w.producten.length);
              await App.store.bossSetAmfiSettings({ input_per_keer: root.querySelector('#am-in').value, output_waarde: root.querySelector('#am-waarde').value, prijs_wij_per_keer: root.querySelector('#am-wij').value, winkels });
              C.toast('Amfi-prijzen opgeslagen');
            } catch (ex) { root.querySelector('#am-err').textContent = U.friendlyError(ex); }
          });
        });
      }

      if (sec === 'website') {
        root.querySelector('#ws-toggle').addEventListener('click', e => C.busy(e.currentTarget, async () => {
          const on = !ctx.state.settings.site_onderhoud;
          await App.store.setSiteOnderhoud(on);
          C.toast(on ? 'Website staat in onderhoud' : 'Website is open voor iedereen');
        }));
      }

      if (sec === 'gangpot') {
        App.bindGangpotEdit(root, ctx);
        root.querySelectorAll('[data-payweek]').forEach(b => b.addEventListener('click', () => { payUi.offset = Math.min(1, payUi.offset + Number(b.dataset.payweek)); App.rerender(); }));
        root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
          const u = ctx.state.users.find(x => x.id === b.dataset.pay); if (!u) return;
          const paid = !App.gangpotPaid(ctx.state, u.id, b.dataset.week);
          C.busy(b, async () => { await App.store.bossSetGangpotPaid(u.id, b.dataset.week, paid, who); C.toast(`${U.esc(u.name)}: ${paid ? 'betaald' : 'niet betaald'}`); });
        }));
        root.querySelector('[data-pay-all]')?.addEventListener('click', e => C.busy(e.currentTarget, async () => {
          const week = e.currentTarget.dataset.payAll;
          for (const u of App.gangpotMembers(ctx.state)) if (!App.gangpotPaid(ctx.state, u.id, week)) await App.store.bossSetGangpotPaid(u.id, week, true, who);
          C.toast('Iedereen op betaald gezet');
        }));
      }

    }
  };
})(window.App);