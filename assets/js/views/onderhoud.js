/* Onderhoudsscherm: zolang de Boss de website "in onderhoud" zet (Boss menu → Website), ziet iedereen dit scherm.
 * Wie de bosscode ingeeft, mag al verder naar het inloggen (onthouden in deze browser tot het onderhoud voorbij is). */
(function (App) {
  const U = App.U, I = App.icon;
  const KEY = 'varrios-v2-preview';

  App.preview = {
    ok: () => U.storage.get(KEY) === '1',
    set: on => on ? U.storage.set(KEY, '1') : U.storage.del(KEY),
    // de website staat in onderhoud en deze browser heeft de bosscode nog niet ingegeven
    blocked: state => !!(state && state.settings && state.settings.site_onderhoud) && !App.preview.ok()
  };

  App.views.onderhoud = {
    render() {
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
      return `
        <div class="auth">
          <div class="auth-card onderhoud">
            <div class="auth-logo" aria-hidden="true"><div class="lh-ring"></div><img src="assets/img/logo-mark.png" alt=""></div>
            <span class="lh-eyebrow">${I('crown', 13)} Varrios Los Aztecas</span>
            <h2>Even in onderhoud</h2>
            <p class="muted">Het gangportaal krijgt een nieuwe versie. Nog even geduld — de Boss laat weten wanneer alles klaar is.</p>
            <div class="ond-code">
              <p class="small muted">${I('shield', 13)} Boss? Geef de bosscode in om al binnen te kijken.</p>
              <div class="pin-dots" id="pin-dots">${'<i></i>'.repeat(4)}</div>
              <div class="err center" id="ond-err"></div>
              <div class="keypad">${keys.map(k => k === '' ? '<span></span>' : `<button type="button" class="key" data-key="${k}">${k}</button>`).join('')}</div>
            </div>
          </div>
        </div>`;
    },
    mount(ctx, root) {
      let code = '';
      const dots = root.querySelector('#pin-dots'), err = root.querySelector('#ond-err');
      const paint = () => dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < code.length));
      const press = async k => {
        if (k === '⌫') code = code.slice(0, -1); else if (code.length < 4) code += k;
        err.textContent = ''; paint();
        if (code.length === 4) {
          try { await App.store.verifyBoss(code); App.preview.set(true); App.C.toast('Welkom — je kan nu inloggen'); App.rerender(); }
          catch (ex) { err.textContent = U.friendlyError(ex); dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400); code = ''; paint(); }
        }
      };
      root.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => press(b.dataset.key)));
      const onKey = e => {
        if (!document.body.contains(dots)) { document.removeEventListener('keydown', onKey); return; }
        if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫');
      };
      document.addEventListener('keydown', onKey);
    }
  };
})(window.App);
