/* Herbruikbare UI-bouwstenen (geven HTML-strings terug) + modal & toast. */
(function (App) {
  const U = App.U, I = App.icon;
  const C = {};

  C.avatar = (user, size = 32) => {
    const col = U.personColor(user.name);
    // de gangpot gebruikt standaard het Varrios-logo als profielfoto
    if (!user.avatar_url && App.L && App.L.isGangpot(user)) return `<span class="avatar logo-av" style="--s:${size}px;--c:var(--gold);background-image:url('assets/img/logo.png')"></span>`;
    if (user.avatar_url) return `<span class="avatar" style="--s:${size}px;--c:${col};background-image:url('${U.esc(user.avatar_url)}')"></span>`;
    return `<span class="avatar" style="--s:${size}px;--c:${col}">${U.esc(U.initials(user.name))}</span>`;
  };
  // toegang tot een afdeling of recht (App.ACCESS). Eigenaar = alles; Boss menu geeft ook gangpot + opslag;
  // het gangpot-profiel (kan niet inloggen) telt als "overal toegang" maar is geen Boss.
  App.hasAccess = (u, key) => {
    if (!u || !key) return true;
    if (u.owner) return true;
    const a = u.access || {};
    if (App.L.isGangpot(u)) return key !== 'boss' && key !== 'gangpot';
    if (key === 'amfi_staff') return !!u.amfi_staff;
    if ((key === 'gangpot' || key === 'opslag') && a.boss) return true;
    return !!a[key];
  };
  // mag de ingelogde gebruiker dit? (App.me wordt gezet door app.js)
  App.can = key => !!App.me && App.hasAccess(App.me, key);

  // bestandskiezer voor een profielfoto → verkleind → opslaan
  C.pickAvatar = userId => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', async () => {
      try { const data = await U.resizeImage(inp.files[0]); await App.store.setAvatar(userId, data); C.toast('Profielfoto opgeslagen'); }
      catch (ex) { C.toast(U.friendlyError(ex), 'error'); }
    });
    inp.click();
  };

  C.rank = (user, sm) => {
    const r = user && user.rank && App.RANKS.find(x => x.id === user.rank);
    return r ? `<span class="rank-pill ${sm ? 'sm' : ''} ${r.lead ? 'lead' : ''}" title="${r.label}${r.lead ? ' · Lead' : ''}">${I(r.icon, sm ? 10 : 12)}${r.label}</span>` : '';
  };
  C.dot = name => `<span class="pdot" style="--c:${U.personColor(name)}"></span>`;

  C.kpi = ({ label, value, icon, tone = '', sub = '', id = '' }) => `
    <div class="kpi ${tone ? 'tone-' + tone : ''}">
      <div class="kpi-top"><span class="kpi-label">${label}</span>${icon ? `<span class="kpi-ic">${I(icon, 15)}</span>` : ''}</div>
      <div class="kpi-value mono"${id ? ` id="${id}"` : ''}>${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;

  C.seg = (name, options, active) => `
    <div class="seg" role="tablist" data-seg="${name}">${options.map(o => `
      <button type="button" class="seg-btn ${o.value === active ? 'on' : ''}" data-seg-value="${o.value}">${o.icon ? I(o.icon, 14) : ''}<span>${o.label}</span>${o.count != null ? `<span class="seg-count">${o.count}</span>` : ''}</button>`).join('')}
    </div>`;

  C.cardHead = (title, icon, right = '', tone = '') => `
    <div class="card-head">
      <h3>${icon ? `<span class="ch-ic ${tone}">${I(icon, 15)}</span>` : ''}${title}</h3>
      ${right ? `<div class="card-head-right">${right}</div>` : ''}
    </div>`;

  C.empty = (text, icon = 'inbox') => `<div class="empty">${I(icon, 22)}<span>${text}</span></div>`;
  C.meter = (ratio, level = 'ok') => `<div class="meter ${level}"><span style="width:${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%"></span></div>`;
  C.pill = (text, tone = 'violet') => `<span class="pill ${tone}">${U.esc(text)}</span>`;

  C.feedItem = ({ tone, icon, html, sub, ts, delta }) => `
    <div class="feed-item">
      <span class="feed-ic ${tone}">${I(icon, 14)}</span>
      <div class="feed-body"><div class="feed-text">${html}</div>${sub ? `<div class="feed-sub">${sub}</div>` : ''}</div>
      <div class="feed-right"><div class="feed-delta ${tone} mono">${delta || ''}</div><div class="feed-time" title="${U.ts(ts)}">${U.ago(ts)}</div></div>
    </div>`;

  // koppelt alle [data-seg] in root aan een callback(name, value)
  C.bindSeg = (root, cb) => {
    root.querySelectorAll('[data-seg]').forEach(seg => {
      seg.querySelectorAll('[data-seg-value]').forEach(btn => btn.addEventListener('click', () => cb(seg.dataset.seg, btn.dataset.segValue)));
    });
  };

  // knop in "bezig"-toestand tijdens een async actie
  C.busy = async (btn, fn) => {
    if (btn.disabled) return;
    const html = btn.innerHTML;
    btn.disabled = true; btn.classList.add('is-busy');
    try { return await fn(); }
    finally { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = html; }
  };

  // ---------- modal ----------
  let escHandler = null;
  C.modal = {
    open(html, onMount, opts = {}) {
      const root = document.getElementById('modal-root');
      root.innerHTML = `<div class="modal-bg" data-modal-bg><div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <button class="modal-x" data-modal-close aria-label="Sluiten">${I('x', 16)}</button>${html}</div></div>`;
      const bg = root.querySelector('.modal-bg');
      bg.addEventListener('mousedown', e => { if (e.target === bg) C.modal.close(); });
      root.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', C.modal.close));
      escHandler = e => { if (e.key === 'Escape') C.modal.close(); };
      document.addEventListener('keydown', escHandler);
      requestAnimationFrame(() => bg.classList.add('in'));
      const modal = root.querySelector('.modal');
      if (onMount) onMount(modal);
      const first = modal.querySelector('input');
      if (first) setTimeout(() => first.focus(), 30);
    },
    close() {
      document.getElementById('modal-root').innerHTML = '';
      if (escHandler) document.removeEventListener('keydown', escHandler);
      escHandler = null;
    },
    isOpen() { return !!document.querySelector('#modal-root .modal'); }
  };

  // ---------- kalender om een periode te kiezen ----------
  // 1e klik = eerste dag, 2e klik = laatste dag (zelfde dag mag). Geeft { set(start, end) } terug.
  // single: true = één dag kiezen (start === end)
  C.rangeCalendar = (host, { start = null, end = null, min = null, single = false, onChange } = {}) => {
    let view = U.parseDay(start || U.dkey(new Date()));
    view.setDate(1);
    const DOW = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
    function draw() {
      const y = view.getFullYear(), m = view.getMonth();
      const gridStart = new Date(y, m, 1 - (new Date(y, m, 1).getDay() + 6) % 7);
      const today = U.dkey(new Date());
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
        const k = U.dkey(d), off = min && k < min;
        const cls = ['cal-d'];
        if (d.getMonth() !== m) cls.push('out');
        if (k === today) cls.push('today');
        if (d.getDay() === 0 || d.getDay() === 6) cls.push('we');
        if (k === start) cls.push('s');
        if (start && k === (end || start)) cls.push('e');
        if (start && end && k > start && k < end) cls.push('in');
        cells += `<button type="button" class="${cls.join(' ')}" data-k="${k}" ${off ? 'disabled' : ''}>${d.getDate()}</button>`;
      }
      const canPrev = !min || U.dkey(new Date(y, m, 0)) >= min;
      host.innerHTML = `
        <div class="cal">
          <div class="cal-head">
            <button type="button" class="cal-nav" data-nav="-1" ${canPrev ? '' : 'disabled'} aria-label="Vorige maand">${I('back', 15)}</button>
            <b>${view.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })}</b>
            <button type="button" class="cal-nav" data-nav="1" aria-label="Volgende maand">${I('arrowRight', 15)}</button>
          </div>
          <div class="cal-dow">${DOW.map(x => `<span>${x}</span>`).join('')}</div>
          <div class="cal-grid">${cells}</div>
          <div class="cal-hint">${single ? 'Kies een dag' : !start || end ? 'Klik de eerste dag dat je er niet bent' : 'Klik nu de laatste dag (of dezelfde dag)'}</div>
        </div>`;
      host.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation(); view.setMonth(view.getMonth() + Number(b.dataset.nav)); draw();
      }));
      const days = host.querySelectorAll('[data-k]');
      days.forEach(b => {
        b.addEventListener('click', e => {
          e.stopPropagation();
          const k = b.dataset.k;
          if (single) { start = end = k; } else if (!start || end) { start = k; end = null; } else if (k < start) { start = k; } else { end = k; }
          draw();
          if (onChange) onChange(start, end);
        });
        // voorbeeld van de periode tijdens het kiezen van de laatste dag
        b.addEventListener('mouseenter', () => {
          if (single || !start || end) return;
          days.forEach(c => c.classList.toggle('pre', c.dataset.k > start && c.dataset.k <= b.dataset.k));
        });
      });
    }
    draw();
    return { set(s, e) { start = s; end = e; if (s) { view = U.parseDay(s); view.setDate(1); } draw(); } };
  };

  // ---------- code-pop-up met cijfertoetsen (4 cijfers) ----------
  // verify(code) moet een fout gooien als de code niet klopt; onOk(code) na een juiste code
  C.codeModal = ({ title, sub, icon = 'lock', tone = 'violet', verify, onOk }) => {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    C.modal.open(`
      <div class="boss-lock in-modal" style="--accent:var(--${tone})">
        <span class="lock-ic tone">${I(icon, 26)}</span>
        <h2>${title}</h2>
        <p class="muted">${sub || ''}</p>
        <div class="pin-dots" id="cm-dots">${'<i></i>'.repeat(4)}</div>
        <div class="err center" id="cm-err"></div>
        <div class="keypad">${keys.map(k => k === '' ? '<span></span>' : `<button type="button" class="key" data-key="${k}">${k}</button>`).join('')}</div>
      </div>`, modal => {
      let code = '';
      const dots = modal.querySelector('#cm-dots'), err = modal.querySelector('#cm-err');
      const paint = () => dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < code.length));
      const press = async k => {
        if (k === '⌫') code = code.slice(0, -1); else if (code.length < 4) code += k;
        err.textContent = ''; paint();
        if (code.length === 4) {
          try { await verify(code); const c = code; C.modal.close(); onOk(c); }
          catch (ex) { err.textContent = U.friendlyError(ex); dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400); code = ''; paint(); }
        }
      };
      modal.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => press(b.dataset.key)));
      const onKey = e => {
        if (!document.body.contains(dots)) { document.removeEventListener('keydown', onKey); return; }
        if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫');
      };
      document.addEventListener('keydown', onKey);
    });
  };

  // ---------- toast ----------
  C.toast = (msg, kind = 'ok') => {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<span class="toast-ic">${I(kind === 'error' ? 'alert' : 'check', 14)}</span><span>${msg}</span>`;
    root.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3200);
  };

  App.C = C;
})(window.App);
