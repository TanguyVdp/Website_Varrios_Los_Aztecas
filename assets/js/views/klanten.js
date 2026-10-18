/* Klantenbestand (gedeeld) + klantdetail met swappen/verkopen. */
(function (App) {
  const U = App.U, C = App.C, I = App.icon, R = App.RULES, L = App.L;
  const ui = { groep: 'all', q: '', mode: 'swap' };

  function newKlantModal(me) {
    C.modal.open(`
      <h3>Nieuwe klant</h3>
      <p class="muted">Het klantenbestand is gezamenlijk — iedereen ziet en vult het aan.</p>
      <form class="stack" id="kl-form" autocomplete="off">
        <label class="field"><span>Naam</span><input class="input" id="kl-name" maxlength="40" placeholder="bv. Big Mike"></label>
        <div class="row-2">
          <label class="field"><span>Groep <em>optioneel</em></span><input class="input" id="kl-groep" maxlength="24" placeholder="bv. Ballas"></label>
          <label class="field"><span>Telefoon <em>optioneel</em></span><input class="input mono" id="kl-phone" type="tel" maxlength="20" placeholder="555-0100"></label>
        </div>
        <div class="err" id="kl-err"></div>
        <button class="btn violet block" type="submit">Klant aanmaken</button>
      </form>`, modal => {
      const form = modal.querySelector('#kl-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try {
            const k = await App.store.createKlant({
              name: modal.querySelector('#kl-name').value, groep: modal.querySelector('#kl-groep').value, phone: modal.querySelector('#kl-phone').value
            }, me);
            C.modal.close(); C.toast('Klant aangemaakt'); App.go('klant/' + k.id);
          } catch (ex) { modal.querySelector('#kl-err').textContent = U.friendlyError(ex); }
        });
      });
    });
  }

  App.views.klanten = {
    render({ state }) {
      const cs = state.customers;
      const tot = cs.reduce((s, c) => ({ g: s.g + c.total_geleverd, z: s.z + L.zakjesVoorKlant(c.total_geleverd), v: s.v + (c.total_verkocht || 0), o: s.o + (c.total_omzet || 0) }), { g: 0, z: 0, v: 0, o: 0 });
      const groepen = [...new Set(cs.map(c => c.groep).filter(Boolean))].sort();
      const cards = [...cs].sort((a, b) => a.name.localeCompare(b.name)).map(c => `
        <a class="klant-card" href="#/klant/${c.id}" data-name="${U.esc(c.name.toLowerCase())}" data-groep="${U.esc((c.groep || '').toLowerCase())}">
          <div class="kc-top">
            <span class="avatar sq" style="--s:40px;--c:${U.personColor(c.name)}">${U.esc(U.initials(c.name))}</span>
            <div class="kc-id"><b>${U.esc(c.name)}</b><span class="muted small">${c.groep ? U.esc(c.groep) : 'geen groep'}${c.phone ? ' · ' + U.esc(c.phone) : ''}</span></div>
            <span class="kc-go">${I('chevronRight', 16)}</span>
          </div>
          <div class="kc-stats">
            <div><span>Geswapt</span><b class="mono">${U.num(c.total_geleverd)}</b></div>
            <div><span>Zakjes</span><b class="mono lime">${U.num(L.zakjesVoorKlant(c.total_geleverd))}</b></div>
            <div><span>Omzet</span><b class="mono violet">€${U.price(c.total_omzet)}</b></div>
          </div>
          <div class="kc-foot muted tiny">${c.last_activity ? `laatst actief ${U.ago(c.last_activity)} geleden` : 'nog geen activiteit'}</div>
        </a>`).join('');
      return `
        <section class="kpi-row four">
          ${C.kpi({ label: 'Klanten', value: U.num(cs.length), icon: 'users' })}
          ${C.kpi({ label: 'Totaal geswapt', value: U.num(tot.g), icon: 'swap', sub: `ratio ${R.KLANT_RATIO_IN}:${R.KLANT_RATIO_OUT}` })}
          ${C.kpi({ label: 'Zakjes meegegeven', value: U.num(tot.z), icon: 'box', tone: 'lime' })}
          ${C.kpi({ label: 'Totale omzet', value: '€' + U.price(tot.o), icon: 'euro', tone: 'violet', sub: `${U.num(tot.v)} stuks verkocht` })}
        </section>
        <section class="toolbar">
          <div class="search">${I('search', 15)}<input class="input" id="kl-search" placeholder="Zoek op naam of groep…" value="${U.esc(ui.q)}"></div>
          <div class="chips">
            <button class="chip ${ui.groep === 'all' ? 'on' : ''}" data-groep="all">Alle</button>
            ${groepen.map(g => `<button class="chip ${ui.groep === g.toLowerCase() ? 'on' : ''}" data-groep="${U.esc(g.toLowerCase())}">${U.esc(g)}</button>`).join('')}
          </div>
          <button class="btn violet" id="kl-add">${I('plus')} Nieuwe klant</button>
        </section>
        <section class="klant-grid" id="kl-grid">${cards}</section>
        <div id="kl-empty" ${cs.length ? 'hidden' : ''}>${C.empty(cs.length ? 'Geen klanten gevonden.' : 'Nog geen klanten aangemaakt.', 'users')}</div>`;
    },
    mount(ctx, root) {
      const apply = () => {
        let visible = 0;
        root.querySelectorAll('.klant-card').forEach(card => {
          const hit = (!ui.q || card.dataset.name.includes(ui.q) || card.dataset.groep.includes(ui.q)) && (ui.groep === 'all' || card.dataset.groep === ui.groep);
          card.hidden = !hit; if (hit) visible++;
        });
        root.querySelector('#kl-empty').hidden = visible > 0;
      };
      const search = root.querySelector('#kl-search');
      search.addEventListener('input', () => { ui.q = search.value.trim().toLowerCase(); apply(); });
      root.querySelectorAll('[data-groep]').forEach(b => b.addEventListener('click', () => {
        ui.groep = b.dataset.groep;
        root.querySelectorAll('[data-groep]').forEach(x => x.classList.toggle('on', x === b));
        apply();
      }));
      root.querySelector('#kl-add').addEventListener('click', () => newKlantModal(ctx.me));
      apply();
    }
  };

  function klantFeed(e) {
    if (e.kind === 'levering') return C.feedItem({ tone: 'violet', icon: 'euro', ts: e.ts, delta: '€' + U.price(e.total_price),
      html: `<b>${U.num(e.amount)}</b> verkocht à €${U.price(e.price_per_unit)}/stuk`, sub: `door ${U.esc(e.by_user_name)} · totaal verkocht ${U.num(e.cumulative_after)}` });
    if (e.kind === 'correctie') return C.feedItem({ tone: 'muted', icon: 'pencil', ts: e.ts, delta: '✎', html: 'Gecorrigeerd door Boss', sub: U.esc(e.note || '') });
    return C.feedItem({ tone: 'lime', icon: 'swap', ts: e.ts, delta: `+${e.zakjes_delta}`,
      html: `<b>${U.num(e.amount)}</b> geswapt`, sub: `door ${U.esc(e.by_user_name)} · totaal ${U.num(e.cumulative_after)} · ${e.zakjes_delta} ${U.plural(e.zakjes_delta, 'zakje', 'zakjes')} meegegeven` });
  }

  App.views.klant = {
    title: ctx => { const k = ctx.state.customers.find(c => c.id === ctx.params[0]); return k ? k.name : 'Klant'; },
    render(ctx) {
      const k = ctx.state.customers.find(c => c.id === ctx.params[0]);
      if (!k) return `<a class="back" href="#/klanten">${I('back', 15)} Terug naar klanten</a>${C.empty('Klant niet gevonden.', 'users')}`;
      const log = ctx.state.customerLog.filter(e => e.customer_id === k.id).sort((a, b) => new Date(b.ts) - new Date(a.ts));
      const isSwap = ui.mode === 'swap';
      return `
        <a class="back" href="#/klanten">${I('back', 15)} Terug naar klanten</a>
        <section class="card klant-head">
          <div class="kh-id">
            <span class="avatar sq" style="--s:56px;--c:${U.personColor(k.name)}">${U.esc(U.initials(k.name))}</span>
            <div>
              <h2>${U.esc(k.name)}</h2>
              <div class="kh-meta">
                ${k.groep ? C.pill(k.groep) : '<span class="muted small">geen groep</span>'}
                ${k.phone ? `<a class="muted small" href="tel:${U.esc(k.phone)}">${I('phone', 13)} ${U.esc(k.phone)}</a>` : ''}
                <span class="muted small">aangemaakt door ${U.esc(k.created_by || '?')}</span>
              </div>
            </div>
          </div>
          <div class="kh-stats">
            <div><span>Geswapt</span><b class="mono">${U.num(k.total_geleverd)}</b></div>
            <div><span>Zakjes mee</span><b class="mono lime">${U.num(L.zakjesVoorKlant(k.total_geleverd))}</b></div>
            <div><span>Verkocht</span><b class="mono">${U.num(k.total_verkocht)}</b></div>
            <div><span>Omzet</span><b class="mono violet">€${U.price(k.total_omzet)}</b></div>
          </div>
        </section>
        <div class="grid-2 klant-body">
          <section class="card action">
            ${C.seg('mode', [{ value: 'swap', label: `Swappen ${R.KLANT_RATIO_IN}:${R.KLANT_RATIO_OUT}`, icon: 'swap' }, { value: 'verkoop', label: 'Verkopen', icon: 'euro' }], ui.mode)}
            <p class="muted small action-hint">${isSwap
              ? `Elke ${R.KLANT_RATIO_IN} geswapt = ${R.KLANT_RATIO_OUT} zakje, dat de klant meteen meekrijgt — er wordt niets tegoed gehouden.`
              : 'Registreer een verkoop met aantal en prijs per stuk.'}</p>
            <form class="stack" id="reg-form" autocomplete="off">
              <div class="${isSwap ? '' : 'row-2'}">
                <label class="field"><span>Aantal</span><input class="input mono lg" id="reg-amount" type="number" min="1" step="1" inputmode="numeric" placeholder="bv. 40"></label>
                ${isSwap ? '' : `<label class="field"><span>Prijs / stuk</span><div class="input-wrap"><span class="prefix">€</span><input class="input mono lg has-prefix" id="reg-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="100"></div></label>`}
              </div>
              <div class="preview" id="reg-preview"><span class="muted">Vul een aantal in.</span></div>
              <div class="err" id="reg-err"></div>
              <button class="btn violet block lg" type="submit">Registreren</button>
            </form>
          </section>
          <section class="card">
            ${C.cardHead('Historiek', 'list', `<span class="muted small mono">${log.length}</span>`)}
            <div class="feed">${log.map(klantFeed).join('') || C.empty('Nog geen registraties voor deze klant.')}</div>
          </section>
        </div>`;
    },
    mount(ctx, root) {
      const k = ctx.state.customers.find(c => c.id === ctx.params[0]);
      if (!k) return;
      C.bindSeg(root, (name, value) => { ui[name] = value; App.rerender(); });
      const form = root.querySelector('#reg-form');
      const amount = root.querySelector('#reg-amount');
      const price = root.querySelector('#reg-price');
      const preview = root.querySelector('#reg-preview');
      const update = () => {
        const n = Math.max(0, Math.floor(Number(amount.value) || 0));
        if (!n) { preview.innerHTML = '<span class="muted">Vul een aantal in.</span>'; return; }
        if (ui.mode === 'swap') {
          const plus = L.zakjesVoorKlant(k.total_geleverd + n) - L.zakjesVoorKlant(k.total_geleverd);
          preview.innerHTML = `<div class="pv-row"><span>Klant krijgt meteen mee</span><b class="mono lime">+${plus} ${U.plural(plus, 'zakje', 'zakjes')}</b></div>
            <div class="pv-row"><span>Nieuw totaal geswapt</span><b class="mono">${U.num(k.total_geleverd + n)}</b></div>`;
        } else {
          const p = Number(price.value) || 0;
          preview.innerHTML = `<div class="pv-row"><span>Totaal deze verkoop</span><b class="mono violet">€${U.price(n * p)}</b></div>`;
        }
      };
      amount.addEventListener('input', update);
      price?.addEventListener('input', update);
      form.addEventListener('submit', e => {
        e.preventDefault();
        C.busy(form.querySelector('button[type=submit]'), async () => {
          try {
            if (ui.mode === 'swap') await App.store.registerSwap(k.id, Number(amount.value), ctx.me);
            else await App.store.registerVerkoop(k.id, Number(amount.value), Number(price.value), ctx.me);
            C.toast(ui.mode === 'swap' ? 'Swap geregistreerd' : 'Verkoop geregistreerd');
          } catch (ex) { root.querySelector('#reg-err').textContent = U.friendlyError(ex); }
        });
      });
    }
  };
})(window.App);
