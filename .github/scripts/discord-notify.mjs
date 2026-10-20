// ============================================================
// Wietloods — Discord-notificaties wanneer zakjes klaar zijn
//
// Draait periodiek via .github/workflows/discord-notify.yml (GitHub Actions,
// gratis, geen server nodig). Leest de wachtrij op exact dezelfde manier als
// de website (index.html: computeQueueTimeline, buildPostCutoverLog en co.)
// — bij een wijziging aan die logica in index.html, hou deze kopie gelijk.
//
// Belangrijk: dit script schrijft NIETS naar Supabase. Het leest enkel via
// de publieke anon key (zelfde rechten als de browser), en houdt zelf bij
// welke deposits al gemeld zijn in .github/state/discord-notified.json,
// dat de workflow terug commit naar de repo.
//
// Pauze-bewust: als de wachtrij gepauzeerd staat (loods_baseline.paused),
// gebruikt dit script het bevroren paused_at-moment i.p.v. de echte klok —
// exact zoals nowForQueue() in index.html. Zonder dit zou de bot gewoon
// doortellen met de nieuwe (snellere) instellingen terwijl de site zelf
// bevroren staat, en te vroeg/foute meldingen sturen.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
// sinds het inloggen met Discord kan de publieke sleutel niets meer lezen → de service-sleutel (zoals de agenda-bot)
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const STATE_PATH = new URL('../state/discord-notified.json', import.meta.url);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DISCORD_WEBHOOK_URL) {
  console.error('Ontbrekende env vars: SUPABASE_URL, SUPABASE_ANON_KEY, DISCORD_WEBHOOK_URL zijn allemaal verplicht.');
  process.exit(1);
}

// ---------- Supabase REST helpers ----------
// let op: PostgREST geeft standaard maximaal 1000 rijen terug — voor loods_log
// (dat kan groeien) vragen we expliciet een groter bereik op via de Range-header,
// anders zou de simulatie stiekem op een afgeknipte geschiedenis draaien.
async function sbGet(path, extraHeaders) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...extraHeaders
    }
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} faalde: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- exacte kopie van de wachtrij-logica uit index.html ----------
const RATIO_IN = 2;         // huidige ratio: 2 planten -> 1 zakje (loods-upgrade, ingegaan op lege loods)
const LEGACY_RATIO_IN = 3;  // oude ratio, voor het bevroren legacy-deel

const RESTART_WINDOWS = [
  { h: 7, m: 58, endH: 8, endM: 3 },
  { h: 11, m: 58, endH: 12, endM: 3 },
  { h: 17, m: 58, endH: 18, endM: 3 }
];
function findEarliestBlackoutOverlap(start, end) {
  let best = null;
  for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
    for (const w of RESTART_WINDOWS) {
      const ws = new Date(start); ws.setDate(ws.getDate() + dayOffset); ws.setHours(w.h, w.m, 0, 0);
      const we = new Date(start); we.setDate(we.getDate() + dayOffset); we.setHours(w.endH, w.endM, 0, 0);
      if (ws < end && we > start) {
        if (!best || ws < best.start) best = { start: ws, end: we };
      }
    }
  }
  return best;
}
function scheduleBatch(startDate, batchMinutes) {
  let start = new Date(startDate);
  while (true) {
    const end = new Date(start.getTime() + batchMinutes * 60000);
    const overlap = findEarliestBlackoutOverlap(start, end);
    if (!overlap) return { start, end };
    start = new Date(overlap.end);
  }
}
function computeQueueTimeline(log, batchSize, batchMinutes, offsetMinutes) {
  batchSize = batchSize || 5;
  batchMinutes = batchMinutes || 1;
  const offsetMs = (offsetMinutes || 0) * 60000;
  const deposits = log.filter(e => e.type === 'inleg' && e.zakjes_delta > 0)
    .slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const units = [];
  deposits.forEach((e, di) => {
    for (let i = 0; i < e.zakjes_delta; i++) units.push({ depositIndex: di, depositTs: new Date(e.ts) });
  });
  const batches = [];
  for (let i = 0; i < units.length; i += batchSize) batches.push(units.slice(i, i + batchSize));

  let freeAt = null;
  const perDeposit = new Map();
  batches.forEach(batch => {
    const eligible = new Date(Math.max(...batch.map(u => u.depositTs.getTime())) + offsetMs);
    const from = (freeAt && freeAt > eligible) ? freeAt : eligible;
    const { start, end } = scheduleBatch(from, batchMinutes);
    freeAt = end;
    batch.forEach(u => {
      if (!perDeposit.has(u.depositIndex)) {
        perDeposit.set(u.depositIndex, {
          logId: deposits[u.depositIndex].id,
          userName: deposits[u.depositIndex].user_name,
          zakjes: 0, start, end
        });
      }
      const d = perDeposit.get(u.depositIndex);
      d.zakjes += 1;
      if (start < d.start) d.start = start;
      if (end > d.end) d.end = end;
    });
  });
  return { deposits: [...perDeposit.values()] };
}

// bouwt de "getrimde" (na-cutover) log — exacte kopie van buildPostCutoverLog
// in index.html. Zonder cutoverAtIso (nog geen ratio-migratie) ongewijzigd.
function buildPostCutoverLog(fullLog, users, cutoverAtIso) {
  if (!cutoverAtIso) return fullLog;
  const cutoverAt = new Date(cutoverAtIso);
  const legacyLeft = new Map(users.map(u => [u.id, (u.legacy_zakjes || 0) * LEGACY_RATIO_IN]));
  const deposits = fullLog.filter(e => e.type === 'inleg' && e.zakjes_delta > 0)
    .slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const trimmed = [];
  deposits.forEach(d => {
    const left = legacyLeft.has(d.user_id) ? legacyLeft.get(d.user_id) : 0;
    const consumed = Math.min(d.amount, left);
    if (legacyLeft.has(d.user_id)) legacyLeft.set(d.user_id, left - consumed);
    const remainingAmount = d.amount - consumed;
    if (remainingAmount <= 0) return;
    const remainingZakjes = Math.floor(remainingAmount / RATIO_IN);
    if (remainingZakjes <= 0) return;
    const ts = new Date(d.ts) < cutoverAt ? cutoverAt.toISOString() : d.ts;
    trimmed.push({ ...d, amount: remainingAmount, zakjes_delta: remainingZakjes, ts });
  });
  return trimmed;
}

// ---------- state (welke deposits al gemeld zijn) ----------
async function readState() {
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null; // bestaat nog niet -> eerste run
  }
}
async function writeState(state) {
  const fs = await import('node:fs/promises');
  await fs.mkdir(new URL('.', STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function fmtClock(d) {
  return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
}
function fmtDate(d) {
  return d.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Brussels' });
}

async function sendDiscordMessage(content) {
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, username: 'Wietloods', allowed_mentions: { parse: ['users'] } })
  });
  if (!res.ok) throw new Error(`Discord webhook faalde: ${res.status} ${await res.text()}`);
}

async function main() {
  const [log, baselineRows, users] = await Promise.all([
    sbGet('loods_log?select=id,type,ts,user_id,user_name,zakjes_delta,amount&type=eq.inleg&order=ts.asc', { Range: '0-9999' }),
    sbGet('loods_baseline?select=offset_minutes,batch_size,batch_minutes,paused,paused_at,ratio_cutover_at'),
    sbGet('users_public?select=id,name,discord_id,legacy_zakjes')
  ]);
  const baseline = baselineRows[0] || { offset_minutes: 0, batch_size: 5, batch_minutes: 1 };
  const discordByName = new Map(users.map(u => [u.name.toLowerCase(), u.discord_id]));

  const trimmedLog = buildPostCutoverLog(log, users, baseline.ratio_cutover_at);
  const result = computeQueueTimeline(trimmedLog, baseline.batch_size, baseline.batch_minutes, baseline.offset_minutes);
  const now = (baseline.paused && baseline.paused_at) ? new Date(baseline.paused_at) : new Date();
  const ready = result.deposits.filter(d => d.end <= now);

  let state = await readState();
  if (!state) {
    // eerste run: geen berichten sturen voor bestaande geschiedenis, enkel baseline vastleggen
    state = { notifiedLogIds: ready.map(d => d.logId) };
    await writeState(state);
    console.log(`Eerste run — bootstrap, ${ready.length} bestaande afgeronde inleg(gen) gemarkeerd als reeds gemeld, geen berichten verstuurd.`);
    return;
  }

  if (baseline.paused) {
    console.log('Wachtrij staat gepauzeerd — niets te doen (klok bevroren op paused_at).');
    return;
  }

  const notified = new Set(state.notifiedLogIds);
  const toNotify = ready.filter(d => !notified.has(d.logId));

  if (toNotify.length === 0) {
    console.log('Niets nieuws om te melden.');
    return;
  }

  for (const d of toNotify) {
    const discordId = discordByName.get(d.userName.toLowerCase());
    const mention = discordId ? `<@${discordId}>` : `**${d.userName}**`;
    const content = `${mention} je zakjes zijn klaar! Verwerkt van **${fmtClock(d.start)}** tot **${fmtClock(d.end)}** (${fmtDate(d.start)}). Je kan nu **${d.zakjes} zakje${d.zakjes === 1 ? '' : 's'}** ophalen.`;
    await sendDiscordMessage(content);
    notified.add(d.logId);
    console.log(`Gemeld: ${d.userName} — ${d.zakjes} zakjes.`);
  }

  await writeState({ notifiedLogIds: [...notified] });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
