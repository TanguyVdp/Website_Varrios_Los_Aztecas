/* ============================================================
 * Wietloods — pure rekenlogica (geen DOM, geen database).
 * 1-op-1 overgenomen uit de oude index.html (computeQueueTimeline,
 * buildPostCutoverLog, momenteelInleg..., zakjesKlaarInLoods), maar
 * gebundeld in één snapshot() zodat views niets zelf hoeven te rekenen.
 * LET OP: .github/scripts/discord-notify.mjs in de oude repo heeft een
 * kopie van de wachtrij-logica — wijzig je die hier, hou die gelijk.
 * ============================================================ */
(function (App) {
  const R = App.RULES;
  const L = {};

  L.isGangpot = u => !!u && typeof u.name === 'string' && u.name.trim().toLowerCase() === R.GANGPOT_NAME;

  // legacy_zakjes ligt vast aan de oude ratio; alles daarboven telt aan de huidige
  L.zakjesForTotal = (legacyZakjes, totalIngelegd) => {
    const rest = Math.max(0, totalIngelegd - legacyZakjes * R.LEGACY_RATIO_IN);
    return legacyZakjes + Math.floor(rest / R.RATIO_IN) * R.RATIO_OUT;
  };
  L.zakjesVoor = u => L.zakjesForTotal(u.legacy_zakjes || 0, u.total_ingelegd);
  L.zakjesVoorKlant = totaal => Math.floor(totaal / R.KLANT_RATIO_IN) * R.KLANT_RATIO_OUT;

  // gangpot-afroming: 1 op GANGPOT_DEEL planten naar gangpot (nooit van gangpot zelf; GANGPOT_DEEL 0 = uit)
  L.splitInleg = (user, amount, hasGangpot) => {
    const gangpot = (R.GANGPOT_DEEL && hasGangpot && !L.isGangpot(user)) ? Math.floor(amount / R.GANGPOT_DEEL) : 0;
    return { self: amount - gangpot, gangpot };
  };

  // ---------- wachtrij (FIFO, batches, server-restarts) ----------
  function blackoutOverlap(start, end) {
    let best = null;
    for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
      for (const w of R.RESTART_WINDOWS) {
        const ws = new Date(start); ws.setDate(ws.getDate() + dayOffset); ws.setHours(w.h, w.m, 0, 0);
        const we = new Date(start); we.setDate(we.getDate() + dayOffset); we.setHours(w.endH, w.endM, 0, 0);
        if (ws < end && we > start && (!best || ws < best.start)) best = { start: ws, end: we };
      }
    }
    return best;
  }
  // een batch is ondeelbaar: raakt hij een restart, dan herbegint hij volledig erna
  function scheduleBatch(startDate, batchMinutes) {
    let start = new Date(startDate);
    while (true) {
      const end = new Date(start.getTime() + batchMinutes * 60000);
      const overlap = blackoutOverlap(start, end);
      if (!overlap) return { start, end };
      start = new Date(overlap.end);
    }
  }

  // haalt het bevroren legacy-deel (verwerkt vóór de ratio-omschakeling) uit de simulatie
  L.buildPostCutoverLog = (fullLog, users, cutoverAtIso) => {
    if (!cutoverAtIso) return fullLog;
    const cutoverAt = new Date(cutoverAtIso);
    const legacyLeft = new Map(users.map(u => [u.id, (u.legacy_zakjes || 0) * R.LEGACY_RATIO_IN]));
    const deposits = fullLog.filter(e => e.type === 'inleg' && e.zakjes_delta > 0)
      .slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const trimmed = [];
    deposits.forEach(d => {
      const left = legacyLeft.has(d.user_id) ? legacyLeft.get(d.user_id) : 0;
      const consumed = Math.min(d.amount, left);
      if (legacyLeft.has(d.user_id)) legacyLeft.set(d.user_id, left - consumed);
      const remainingAmount = d.amount - consumed;
      if (remainingAmount <= 0) return;
      const remainingZakjes = Math.floor(remainingAmount / R.RATIO_IN);
      if (remainingZakjes <= 0) return;
      const ts = new Date(d.ts) < cutoverAt ? cutoverAt.toISOString() : d.ts;
      trimmed.push({ ...d, amount: remainingAmount, zakjes_delta: remainingZakjes, ts });
    });
    return trimmed;
  };

  L.computeQueue = (log, baseline) => {
    const batchSize = baseline.batch_size || R.BASELINE_DEFAULT.batch_size;
    const batchMinutes = baseline.batch_minutes || R.BASELINE_DEFAULT.batch_minutes;
    const offsetMs = (baseline.offset_minutes || 0) * 60000;
    const deposits = log.filter(e => e.type === 'inleg' && e.zakjes_delta > 0)
      .slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));

    const units = [];
    deposits.forEach((e, di) => {
      for (let i = 0; i < e.zakjes_delta; i++) units.push({ di, ts: new Date(e.ts) });
    });

    let freeAt = null;
    const perDeposit = new Map();
    const batches = [];
    for (let i = 0; i < units.length; i += batchSize) {
      const batch = units.slice(i, i + batchSize);
      const eligible = new Date(Math.max(...batch.map(u => u.ts.getTime())) + offsetMs);
      const from = (freeAt && freeAt > eligible) ? freeAt : eligible;
      const { start, end } = scheduleBatch(from, batchMinutes);
      freeAt = end;
      const byUser = {};
      batch.forEach(u => {
        const dep = deposits[u.di];
        const key = dep.user_id || dep.user_name;
        byUser[key] = (byUser[key] || 0) + 1;
        if (!perDeposit.has(u.di)) perDeposit.set(u.di, { id: dep.id, userId: dep.user_id, userName: dep.user_name, amount: dep.amount, zakjes: 0, start, end });
        const d = perDeposit.get(u.di);
        d.zakjes += 1;
        if (start < d.start) d.start = start;
        if (end > d.end) d.end = end;
      });
      batches.push({ start, end, zakjes: batch.length, byUser });
    }
    return { deposits: [...perDeposit.values()], batches };
  };

  // tijdens onderhoud (paused) staat de wachtrij-klok stil op paused_at
  L.nowForQueue = baseline => (baseline.paused && baseline.paused_at) ? new Date(baseline.paused_at) : new Date();

  /* Alles wat een view nodig heeft, in één keer berekend.
   * Begrippen (zelfde als in de oude app):
   *  - zakjes       = totaal ooit toegekend (instant bij inleg)
   *  - tegoed       = zakjes - opgehaald
   *  - momTegoed    = wat de wachtrij al écht verwerkt heeft - opgehaald  (= wat je NU kan ophalen)
   *  - momInleg     = planten van jou die nog niet verwerkt zijn (max 6000, behalve gangpot)
   */
  L.snapshot = state => {
    const b = { ...R.BASELINE_DEFAULT, ...state.baseline };
    const now = L.nowForQueue(b);
    const queue = L.computeQueue(L.buildPostCutoverLog(state.log, state.users, b.ratio_cutover_at), b);

    const verwerkt = new Map();
    queue.batches.forEach(bt => {
      if (bt.end <= now) Object.entries(bt.byUser).forEach(([k, c]) => verwerkt.set(k, (verwerkt.get(k) || 0) + c));
    });

    const perUser = new Map();
    const t = { ingelegd: 0, toegekend: 0, opgehaald: 0, plantenInLoods: 0, zakjesKlaarModel: 0 };
    state.users.forEach(u => {
      const legacy = u.legacy_zakjes || 0;
      const done = verwerkt.get(u.id) || 0;
      const zakjes = L.zakjesVoor(u);
      const totaalVerwerkt = legacy + done;
      const momInleg = Math.max(0, u.total_ingelegd - (legacy * R.LEGACY_RATIO_IN + done * R.RATIO_IN));
      const momTegoed = Math.max(0, totaalVerwerkt - u.opgehaald);
      const gangpot = L.isGangpot(u);
      const ratio = gangpot ? 0 : momInleg / R.MAX_MOMENTEEL_INLEG;
      perUser.set(u.id, {
        user: u, zakjes, tegoed: zakjes - u.opgehaald, momInleg, momTegoed, gangpot, ratio,
        ruimte: gangpot ? Infinity : Math.max(0, R.MAX_MOMENTEEL_INLEG - momInleg),
        level: gangpot ? 'ok' : ratio >= 1 ? 'danger' : ratio >= 0.75 ? 'warn' : 'ok'
      });
      t.ingelegd += u.total_ingelegd;
      t.toegekend += zakjes;
      t.opgehaald += u.opgehaald;
      t.plantenInLoods += momInleg;
      t.zakjesKlaarModel += momTegoed;
    });
    t.nogTegoed = t.toegekend - t.opgehaald;
    t.zakjesKlaar = Math.max(0, t.zakjesKlaarModel + (b.zakjes_correctie || 0));

    const active = queue.deposits.filter(d => d.end > now).sort((a, c) => a.start - c.start);
    const done = queue.deposits.filter(d => d.end <= now).sort((a, c) => c.end - a.end);
    const pending = queue.batches.filter(bt => bt.end > now);
    const totalZakjes = queue.batches.reduce((s, bt) => s + bt.zakjes, 0);
    const pendingZakjes = pending.reduce((s, bt) => s + bt.zakjes, 0);

    return {
      now, baseline: b, queue, perUser, totals: t,
      queueInfo: {
        active, done, totalZakjes, pendingZakjes,
        processing: active.find(d => d.start <= now) || null,
        finishAt: pending.length ? new Date(Math.max(...pending.map(bt => bt.end.getTime()))) : null
      }
    };
  };

  App.L = L;
})(window.App);
