/* Onderhoudsscherm: zolang de Boss de website "in onderhoud" zet (Boss menu → Website), ziet iedereen dit scherm.
 * Wie het Boss menu heeft, logt in met Discord en komt gewoon verder (app.js). */
(function (App) {
  const U = App.U, I = App.icon;

  App.views.onderhoud = {
    render(ctx) {
      const a = App.store.auth;
      const me = ctx.me;
      return `
        <div class="auth">
          <div class="auth-card onderhoud">
            <div class="auth-logo" aria-hidden="true"><div class="lh-ring"></div><img src="assets/img/logo-mark.png" alt=""></div>
            <span class="lh-eyebrow">${I('crown', 13)} Varrios Los Aztecas</span>
            <h2>Even in onderhoud</h2>
            <p class="muted">Het gangportaal krijgt een nieuwe versie. Nog even geduld — de Boss laat weten wanneer alles klaar is.</p>
            <div class="ond-code">
              ${a.status === 'anon'
                ? `<p class="small muted">${I('shield', 13)} Boss? Log in met Discord om al binnen te kijken.</p>${App.discordButton()}`
                : `<p class="small muted">${I('user', 13)} Ingelogd als <b>${U.esc(me ? me.name : a.discordName || 'Discord-account')}</b>. Je kan binnen zodra het onderhoud voorbij is.</p>
                   <button class="btn ghost sm" data-signout>${I('logout', 13)} Uitloggen</button>`}
            </div>
          </div>
        </div>`;
    },
    mount(ctx, root) {
      App.bindDiscordLogin(root);
      root.querySelector('[data-signout]')?.addEventListener('click', () => App.store.signOut());
    }
  };
})(window.App);
