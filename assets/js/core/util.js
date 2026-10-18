/* Kleine helpers: formatteren, escapen, kleuren. */
(function (App) {
  const U = {};

  U.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.num = n => Number(n || 0).toLocaleString('nl-BE');
  U.price = n => Number(n || 0).toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  U.clock = d => new Date(d).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  U.date = d => new Date(d).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' });
  U.ts = ts => U.date(ts) + ' · ' + U.clock(ts);
  U.plural = (n, one, many) => (n === 1 ? one : many);

  U.ago = ts => {
    const min = (Date.now() - new Date(ts).getTime()) / 60000;
    if (min < 1) return 'zonet';
    if (min < 60) return Math.round(min) + ' min';
    if (min < 1440) return Math.floor(min / 60) + 'u';
    const d = Math.floor(min / 1440);
    return d === 1 ? 'gisteren' : d + 'd';
  };

  U.duration = ms => {
    const total = Math.max(0, Math.round(ms / 60000));
    const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
    const parts = [];
    if (d) parts.push(d + 'd');
    if (d || h) parts.push(h + 'u');
    parts.push(m + 'min');
    return parts.join(' ');
  };

  // kalenderdagen als 'YYYY-MM-DD' (lokale tijd) — sorteerbaar en vergelijkbaar als gewone strings
  U.dkey = d => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  U.parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  U.addDays = (d, n) => { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
  U.daysBetween = (a, b) => Math.round((U.parseDay(b) - U.parseDay(a)) / 86400000);
  U.dayLabel = k => U.parseDay(k).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  U.startOfWeek = d => { d = new Date(d); return U.addDays(d, -((d.getDay() + 6) % 7)); };

  // profielfoto: vierkant bijsnijden en verkleinen in de browser (zoals de oude app) → jpeg data-URL
  U.resizeImage = (file, size = 192, quality = 0.85) => new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('ONGELDIGE_FOTO'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ONGELDIGE_FOTO')); };
    img.src = url;
  });

  U.initials = name => String(name || '?').replace(/["']/g, '').trim().slice(0, 2).toUpperCase();

  const PALETTE = ['#A6F24D', '#3FDDC4', '#9584F0', '#EC7FC0', '#F0B24E', '#6FB7FF', '#FF8A65', '#C3E88D', '#B39DDB', '#4DD0E1'];
  U.personColor = name => {
    let h = 0;
    for (const ch of String(name || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  };

  U.uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  U.wait = ms => new Promise(r => setTimeout(r, ms));

  U.storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privémodus */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* privémodus */ } }
  };

  U.friendlyError = e => {
    const code = (e && e.message) ? e.message.trim() : '';
    return App.ERR[code] || code || 'Er ging iets mis. Probeer opnieuw.';
  };

  App.U = U;
})(window.App);
