// ============================================================
// Varrios portaal — Discord-bot voor de agenda (periodiek)
//
// Draait mee in .github/workflows/discord-notify.yml (elke ~2 min via cron-job.org).
//  1. Nieuwe activiteit in de agenda → bericht in het agenda-kanaal met knoppen
//     (✅ Aanwezig / 🤔 Misschien / ❌ Afwezig + link naar de site).
//  2. Houdt dat bericht bij: wie wat geantwoord heeft (ook antwoorden via de site).
//  3. Herinneringen als tag in het agenda-kanaal (geen DM's meer):
//     - 24u en 5u voor de start: wie nog niet geantwoord heeft (wie die dag als afwezig gemeld staat, wordt overgeslagen);
//       de 5u-tag vervangt de 24u-tag
//     - 2u voor de start: wie "aanwezig" antwoordde ("@bob @mike — Wapenveiling begint over 2 uur")
//     Bijgehouden in agenda_pings: wie intussen antwoordt (of niet meer aanwezig is) gaat eruit zonder opnieuw
//     getagd te worden; activiteit verwijderd → bericht weg. Vereist supabase/update-v2-agenda-tags.sql.
//  4. Activiteit begonnen → knoppen uit; 12u na de start → bericht weg uit het kanaal. Activiteit verwijderd → bericht meteen weg.
//     Berichten staan in volgorde van de datum, de eerstvolgende ONDERAAN; staat er iets verkeerd, dan wordt opnieuw gepost.
//     Onder een tag (24u/5u) staan zelf ook de knoppen Aanwezig/Afwezig, zodat getagde leden daar meteen antwoorden.
//  5. Mededelingen van de Boss → bericht in het mededelingen-kanaal (enkel met het vinkje "Tag in Discord"
//     wordt de rol @Varrios Los Aztecas getagd, via DISCORD_MEDEDELINGEN_ROLE_ID);
//     mededeling gewijzigd → bericht bijgewerkt; verwijderd op de site (uit de lobby) → het bericht BLIJFT in Discord.
//  6. Amfi-tickets → één bericht per ticket in het lead-kanaal (DISCORD_AMFI_CHANNEL_ID), bijgewerkt als de status verandert.
//  7. Leden-lijst → één bericht in #leden-lijst met alle leden per rang (uit de Ledenlijst op de site), bijgewerkt bij wijzigingen.
//  8. Afwezigheid → #afwezigheid: knop "Afwezigheid melden", meldingen (ook van de site) met Goedkeuren/Afkeuren voor de Boss,
//     en de rol "Afwezig" zolang iemand afwezig is (zie afwezigheid() onderaan).
// De knoppen zelf worden verwerkt door de Supabase Edge Function supabase/functions/discord-agenda.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN, DISCORD_AGENDA_CHANNEL_ID (+ optioneel SITE_URL,
// DISCORD_MEDEDELINGEN_CHANNEL_ID — zonder dat kanaal worden mededelingen gewoon overgeslagen).
// Ontbreekt er één van de verplichte, dan doet dit script niets (zodat de zakjes-melding gewoon blijft werken).
// buildMessage() is een kopie van die in de Edge Function — hou ze gelijk.
// ============================================================

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN, DISCORD_AGENDA_CHANNEL_ID, DISCORD_MEDEDELINGEN_CHANNEL_ID, DISCORD_AMFI_CHANNEL_ID } = process.env;
const SITE_URL = (process.env.SITE_URL || 'https://tanguyvdp.github.io/Website_Varrios_Los_Aztecas/').replace(/\/?$/, '/');
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !DISCORD_BOT_TOKEN || !DISCORD_AGENDA_CHANNEL_ID) {
  console.log('Agenda-bot nog niet ingesteld (secrets ontbreken) — overgeslagen.');
  process.exit(0);
}
const API = 'https://discord.com/api/v10';
const HOUR = 3600000;

// ---------- Supabase (service role: mag ook agenda_discord en users lezen/schrijven) ----------
const sbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders, Range: '0-9999', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${opts.method || 'GET'} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;   // "return=minimal" geeft een lege body
}
const sbInsert = (table, row) => sb(table, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } });
const sbUpdate = (table, filter, patch) => sb(`${table}?${filter}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
const sbDelete = (table, filter) => sb(`${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

// ---------- Discord ----------
async function discord(path, method = 'GET', body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method, headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 429) { const j = await res.json().catch(() => ({})); await new Promise(r => setTimeout(r, ((j.retry_after || 1) * 1000) + 100)); continue; }
    const text = await res.text();
    if (!res.ok) { const err = new Error(`Discord ${method} ${path}: ${res.status} ${text}`); err.status = res.status; throw err; }
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`Discord ${method} ${path}: te veel verzoeken`);
}

// ---------- agenda-bericht (kopie in supabase/functions/discord-agenda/index.ts) ----------
const RSVP = [
  { id: 'aanwezig', label: 'Aanwezig', emoji: '✅', style: 3 },
  { id: 'misschien', label: 'Misschien', emoji: '🤔', style: 2, old: true },   // geen knop meer; oude antwoorden blijven zichtbaar
  { id: 'afwezig', label: 'Afwezig', emoji: '❌', style: 4 }
];
const TYPES = {
  vergadering: { label: 'Vergadering', emoji: '👥', color: 0x8b7cf6 },
  actie: { label: 'Actie', emoji: '🔥', color: 0xef4444 },
  deal: { label: 'Deal', emoji: '🤝', color: 0x9be15d },
  feest: { label: 'Feest', emoji: '👑', color: 0xf4b41a },
  andere: { label: 'Andere', emoji: '📌', color: 0x22d3ee }
};
const dayLabel = datum => {
  const s = new Date(datum + 'T12:00:00Z').toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// één naam per regel, met een bolletje; leeg = streepje
const names = list => (list.length ? list.map(n => `• ${n}`).join('\n') : '—').slice(0, 1024);
// "nog niet geantwoord" verdeeld over 3 kolommen (de 2e en 3e kolom hebben een onzichtbare titel)
const columns = (title, list) => {
  const per = Math.max(1, Math.ceil(list.length / 3));
  return [0, 1, 2].map(i => ({ name: i === 0 ? title : '​', value: names(list.slice(i * per, (i + 1) * per)).replace(/^—$/, i === 0 ? '—' : '​'), inline: true }));
};

// één veld per antwoord ("misschien" enkel als iemand dat vroeger koos), aangevuld tot een volle rij van 3
const rsvpFields = mine => {
  const f = RSVP.map(s => {
    const l = mine.filter(r => r.status === s.id).map(r => r.user_name + (r.reden ? ` *(${r.reden})*` : ''));
    return s.old && !l.length ? null : { name: `${s.emoji} ${s.label} (${l.length})`, value: names(l), inline: true };
  }).filter(Boolean);
  while (f.length % 3) f.push({ name: '​', value: '​', inline: true });
  return f;
};

function buildMessage(ev, rsvps, members, closed = false) {
  const t = TYPES[ev.type] || TYPES.andere;
  const mine = rsvps.filter(r => r.event_id === ev.id);
  const answered = new Set(mine.map(r => r.user_id));
  const open = members.filter(u => !answered.has(u.id)).map(u => u.name);
  const lines = [`🗓️ **${dayLabel(ev.datum)}**${ev.tijd ? ` om **${ev.tijd}**` : ''}`];
  if (ev.plaats) lines.push(`📍 ${ev.plaats}`);
  if (ev.info) lines.push('', ev.info);
  lines.push('', closed ? '🔒 Aanmelden is gesloten.' : 'Ben jij erbij? Klik hieronder — je kan je antwoord altijd nog wijzigen.');
  return {
    embeds: [{
      title: `${t.emoji} ${ev.titel}`,
      url: `${SITE_URL}#/agenda/${ev.id}`,
      description: lines.join('\n'),
      color: t.color,
      fields: [
        ...rsvpFields(mine),
        ...(open.length ? columns(`⏳ Geen antwoord (${open.length})`, open) : [{ name: '⏳ Geen antwoord (0)', value: 'Iedereen heeft geantwoord 🎉' }])
      ],
      footer: { text: `${t.label} · geplaatst door ${ev.door || 'Boss'}` }
    }],
    components: [{
      type: 1,
      components: [
        ...RSVP.filter(s => !s.old).map(s => ({ type: 2, style: s.style, label: s.label, emoji: { name: s.emoji }, custom_id: `rsvp:${ev.id}:${s.id}`, disabled: closed })),
        { type: 2, style: 5, label: 'Open op de site', url: `${SITE_URL}#/agenda/${ev.id}` }
      ]
    }]
  };
}

// wat er in een agenda-bericht kan wijzigen (antwoorden + "geplaatst door") — anders → bericht bijwerken
const msgSig = msg => JSON.stringify([msg.embeds[0].fields, msg.embeds[0].footer]);

// ---------- tijd (TZ=Europe/Brussels in de workflow) ----------
const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// zonder uur rekenen we met 12u00
const startOf = ev => new Date(`${ev.datum}T${ev.tijd || '12:00'}:00`);

// herinneringen: [kolom in agenda_discord, uren voor de start, wie getagd wordt]
const REMINDERS = [['reminded_24', 24, 'open'], ['reminded_5', 5, 'open'], ['reminded_2', 2, 'aanwezig']];

// wie getagd wordt bij een herinnering: 'open' = nog niet geantwoord (en die dag niet afwezig gemeld),
// 'aanwezig' = antwoordde "aanwezig"
function remindTargets(ev, kind, rsvps, members, absences) {
  const mine = rsvps.filter(r => r.event_id === ev.id);
  if (kind === 'aanwezig') {
    const yes = new Set(mine.filter(r => r.status === 'aanwezig').map(r => r.user_id));
    return members.filter(u => yes.has(u.id));
  }
  const answered = new Set(mine.map(r => r.user_id));
  const absent = new Set(absences.filter(a => a.van <= ev.datum && a.tot >= ev.datum).map(a => a.user_id));
  return members.filter(u => !answered.has(u.id) && !absent.has(u.id));
}

// tag in het agenda-kanaal; wie (nog) geen Discord-ID heeft, staat er met naam
const tags = list => list.map(u => u.discord_id ? `<@${u.discord_id}>` : `**${u.name || '?'}**`).join(' ');
const overText = hours => hours === 24 ? 'morgen' : `over ${hours} uur`;
const pingText = (ev, kind, hours, list) => kind === 'aanwezig'
  ? `🔔 ${tags(list)} — **${ev.titel}** begint ${overText(hours)}${ev.tijd ? ` (om ${ev.tijd})` : ''}. Tot straks!`
  : `⏰ ${tags(list)} — **${ev.titel}** begint ${overText(hours)}${ev.tijd ? ` (om ${ev.tijd})` : ''} en ${list.length === 1 ? 'je hebt' : 'jullie hebben'} nog niet geantwoord. Antwoord hieronder 👇`;
// knoppen onder de tag: wie getagd wordt, antwoordt meteen daar (zelfde custom_id als het agenda-bericht → Edge Function)
const pingButtons = (ev, kind) => [{
  type: 1,
  components: [
    ...(kind === 'open' ? RSVP.filter(s => !s.old).map(s => ({ type: 2, style: s.style, label: s.label, emoji: { name: s.emoji }, custom_id: `rsvp:${ev.id}:${s.id}` })) : []),
    { type: 2, style: 5, label: 'Open op de site', url: `${SITE_URL}#/agenda/${ev.id}` }
  ]
}];

async function remind(ev, kind, hours, rsvps, members, absences) {
  const list = remindTargets(ev, kind, rsvps, members, absences);
  if (!list.length) { console.log(`  niemand te taggen (${kind})`); return; }
  const sent = await discord(`/channels/${DISCORD_AGENDA_CHANNEL_ID}/messages`, 'POST', {
    content: pingText(ev, kind, hours, list),
    components: pingButtons(ev, kind),
    allowed_mentions: { users: list.map(u => u.discord_id).filter(Boolean) }
  });
  console.log(`  getagd (${kind}, ${hours}u): ${list.map(u => u.name).join(', ')}`);
  // onthouden, zodat de bot het bericht kan inkorten/weghalen (tabel agenda_pings)
  try {
    await sbInsert('agenda_pings', { message_id: sent.id, channel_id: DISCORD_AGENDA_CHANNEL_ID, event_id: ev.id, hours, kind,
      users: list.map(u => ({ id: u.id, name: u.name, discord_id: u.discord_id || null })) });
  } catch (e) { console.log(`  agenda_pings bijhouden lukte niet: ${e.message}`); }
}

// bestaan de kolommen van supabase/update-v2-agenda-tags.sql al? Zo niet: geen herinneringen (ook geen DM's)
async function remindersReady() {
  try {
    await sb('agenda_discord?select=reminded_5&limit=1');
    await sb('agenda_pings?select=kind&limit=1');
    return true;
  } catch (e) {
    console.log('Herinneringen overgeslagen: voer eerst supabase/update-v2-agenda-tags.sql uit in Supabase.');
    return false;
  }
}

// tags opruimen (zonder opnieuw te taggen):
//  - 'open': wie intussen antwoordde gaat eruit; iedereen geantwoord, activiteit begonnen of een nieuwere tag (5u na 24u) → bericht weg
//  - 'aanwezig': wie niet meer "aanwezig" staat gaat eruit; niemand meer over of 12u na de start → bericht weg
//  - activiteit verwijderd → altijd weg
async function cleanPings(rsvps, now) {
  let pings;
  try { pings = await sb('agenda_pings?select=*'); } catch (e) { return; }   // tabel bestaat nog niet
  if (!pings.length) return;
  const evs = await sb(`events?select=id,titel,datum,tijd&id=in.(${[...new Set(pings.map(p => p.event_id))].join(',')})`);
  const evById = new Map(evs.map(e => [e.id, e]));
  for (const p of pings) {
    const ev = evById.get(p.event_id);
    const kind = p.kind || 'open';
    const mine = rsvps.filter(r => r.event_id === p.event_id);
    const left = (p.users || []).filter(u => kind === 'aanwezig'
      ? mine.some(r => r.user_id === u.id && r.status === 'aanwezig')
      : !mine.some(r => r.user_id === u.id));
    const over = ev && (kind === 'aanwezig' ? now - startOf(ev) >= 12 * HOUR : now >= startOf(ev));
    const replaced = kind === 'open' && pings.some(q => q.event_id === p.event_id && (q.kind || 'open') === 'open' && BigInt(q.message_id) > BigInt(p.message_id));
    try {
      if (!ev || over || replaced || !left.length) {
        try { await discord(`/channels/${p.channel_id}/messages/${p.message_id}`, 'DELETE'); }
        catch (e) { if (e.status !== 404) throw e; }
        await sbDelete('agenda_pings', `message_id=eq.${p.message_id}`);
        console.log(`Vermelding weggehaald: ${ev ? ev.titel : p.event_id}`);
      } else if (left.length < (p.users || []).length) {
        await discord(`/channels/${p.channel_id}/messages/${p.message_id}`, 'PATCH', {
          content: pingText(ev, kind, p.hours, left), components: pingButtons(ev, kind), allowed_mentions: { parse: [] }
        });
        await sbUpdate('agenda_pings', `message_id=eq.${p.message_id}`, { users: left });
        console.log(`Vermelding ingekort (${left.length} over): ${ev.titel}`);
      }
    } catch (e) { console.log(`Vermelding ${p.message_id}: ${e.message}`); }
  }
}

async function main() {
  const now = new Date();
  const yesterday = dkey(new Date(now.getTime() - 24 * HOUR));
  const [events, rsvps, users, absences, posts] = await Promise.all([
    sb(`events?select=*&datum=gte.${yesterday}&order=datum.asc`),
    sb('event_rsvps?select=*'),
    // alle profielen (behalve gangpot), ook wie nog nooit ingelogd heeft — zelfde lijst als in de Edge Function
    sb('users?select=id,name,discord_id,sort_order&order=sort_order.asc'),
    sb('absences?select=user_id,van,tot&status=neq.afgekeurd'),
    sb('agenda_discord?select=*')
  ]);
  const members = users.filter(u => u.name.trim().toLowerCase() !== 'gangpot');
  const canRemind = await remindersReady();
  const byEvent = new Map(posts.map(p => [p.event_id, p]));
  const eventIds = new Set(events.map(e => e.id));

  // verwijderde activiteiten → bericht meteen weg uit het kanaal (de tags ruimt cleanPings op)
  for (const p of posts) {
    if (eventIds.has(p.event_id) || p.closed) continue;
    const still = await sb(`events?select=id&id=eq.${p.event_id}`);
    if (still.length) continue;   // bestaat nog, maar is ouder dan gisteren
    try { await discord(`/channels/${p.channel_id}/messages/${p.message_id}`, 'DELETE'); }
    catch (e) { if (e.status !== 404) { console.log(`Bericht van verwijderde activiteit ${p.message_id}: ${e.message}`); continue; } }
    await sbDelete('agenda_discord', `event_id=eq.${p.event_id}`);
    console.log(`Verwijderde activiteit — bericht weg: ${p.event_id}`);
  }

  // afgelopen activiteit: 12u na de start het bericht uit het kanaal halen (op de site blijft ze in de kalender staan)
  const oldPosts = posts.filter(p => p.closed);
  if (oldPosts.length) {
    const evs = await sb(`events?select=id,datum,tijd&id=in.(${oldPosts.map(p => p.event_id).join(',')})`);
    const evById = new Map(evs.map(e => [e.id, e]));
    for (const p of oldPosts) {
      const ev = evById.get(p.event_id);
      if (ev && now - startOf(ev) < 12 * HOUR) continue;
      try { await discord(`/channels/${p.channel_id}/messages/${p.message_id}`, 'DELETE'); }
      catch (e) { if (e.status !== 404) { console.log(`Afgelopen bericht verwijderen: ${e.message}`); continue; } }
      await sbDelete('agenda_discord', `event_id=eq.${p.event_id}`);
      console.log(`Afgelopen, uit het kanaal gehaald: ${p.event_id}`);
    }
  }

  for (const ev of events) {
    const start = startOf(ev);
    let post = byEvent.get(ev.id);
    const closed = now >= start;

    // nieuw → posten (enkel als het nog niet begonnen is)
    if (!post) {
      if (closed) continue;
      const msg = buildMessage(ev, rsvps, members);
      const sent = await discord(`/channels/${DISCORD_AGENDA_CHANNEL_ID}/messages`, 'POST', { content: '📅 **Nieuwe activiteit in de agenda!**', ...msg });
      const left = start - now;
      post = { event_id: ev.id, channel_id: DISCORD_AGENDA_CHANNEL_ID, message_id: sent.id, counts: msgSig(msg), closed: false };
      // net geplaatst: geen herinnering voor een moment dat al voorbij is
      if (canRemind) for (const [key, hours] of REMINDERS) post[key] = left < hours * HOUR;
      await sbInsert('agenda_discord', post);
      console.log(`Gepost: ${ev.titel} (${ev.datum})`);
      continue;
    }
    if (post.closed) continue;

    // begonnen → knoppen uit
    if (closed) {
      try { await discord(`/channels/${post.channel_id}/messages/${post.message_id}`, 'PATCH', buildMessage(ev, rsvps, members, true)); }
      catch (e) { console.log(`Sluiten ${ev.titel}: ${e.message}`); }
      await sbUpdate('agenda_discord', `event_id=eq.${ev.id}`, { closed: true });
      console.log(`Gesloten: ${ev.titel}`);
      continue;
    }

    // tellingen bijwerken als er iets veranderd is (bv. antwoord via de site)
    const msg = buildMessage(ev, rsvps, members);
    const counts = msgSig(msg);
    if (counts !== post.counts) {
      try {
        await discord(`/channels/${post.channel_id}/messages/${post.message_id}`, 'PATCH', msg);
        await sbUpdate('agenda_discord', `event_id=eq.${ev.id}`, { counts });
        console.log(`Bijgewerkt: ${ev.titel}`);
      } catch (e) {
        // bericht verwijderd in Discord → opnieuw posten bij de volgende run
        if (e.status === 404) await sbDelete('agenda_discord', `event_id=eq.${ev.id}`);
        console.log(`Bijwerken ${ev.titel}: ${e.message}`);
      }
    }

    // herinneringen (tags in het agenda-kanaal)
    for (const [key, hours, kind] of canRemind ? REMINDERS : []) {
      if (post[key] || now < start - hours * HOUR) continue;
      await sbUpdate('agenda_discord', `event_id=eq.${ev.id}`, { [key]: true });   // eerst markeren: nooit dubbel
      post[key] = true;
      // niet sturen als dit moment al voorbij was bij het plaatsen, of als de volgende herinnering van dezelfde soort ook al aan de beurt is
      const nextDue = REMINDERS.some(([, h, k]) => k === kind && h < hours && now >= start - h * HOUR);
      if (nextDue || new Date(post.posted_at).getTime() > start.getTime() - hours * HOUR) continue;
      // werkelijke tijd tot de start (de bot draait om de paar minuten, of stond even stil)
      const left = Math.max(1, Math.round((start - now) / HOUR));
      console.log(`Herinnering ${hours}u (${kind}): ${ev.titel}`);
      await remind(ev, kind, Math.min(hours, left), rsvps, members, absences);
    }
  }

  await reorder(events, rsvps, members, now);
  await cleanPings(rsvps, now);
}

// Volgorde in het kanaal: de EERSTVOLGENDE activiteit staat ONDERAAN (vlak boven het typvak, die zie je meteen),
// de verste bovenaan. Staat er een bericht verkeerd (bv. nieuwe activiteit die later valt dan de rest), dan worden
// de berichten die eronder horen opnieuw gepost (nieuw bericht, oud weg). Antwoorden staan in de database,
// dus er gaat niets verloren; de knoppen werken via event_id. Enkel open (nog niet begonnen) activiteiten.
async function reorder(events, rsvps, members, now) {
  const posts = await sb('agenda_discord?select=*&closed=eq.false');
  const byEvent = new Map(posts.filter(p => p.channel_id === DISCORD_AGENDA_CHANNEL_ID).map(p => [p.event_id, p]));
  const open = events.filter(ev => byEvent.has(ev.id) && now < startOf(ev))
    .sort((a, b) => startOf(b) - startOf(a) || String(b.created_at).localeCompare(String(a.created_at)));
  // langste begin van de lijst dat al in de juiste volgorde staat (bericht-ID's = tijdstip van posten)
  let keep = 0, last = 0n;
  for (const ev of open) { const id = BigInt(byEvent.get(ev.id).message_id); if (id < last) break; last = id; keep++; }
  for (const ev of open.slice(keep)) {
    const post = byEvent.get(ev.id);
    const msg = buildMessage(ev, rsvps, members);
    const sent = await discord(`/channels/${DISCORD_AGENDA_CHANNEL_ID}/messages`, 'POST', msg);
    await sbUpdate('agenda_discord', `event_id=eq.${ev.id}`, { message_id: sent.id, counts: msgSig(msg) });
    try { await discord(`/channels/${post.channel_id}/messages/${post.message_id}`, 'DELETE'); }
    catch (e) { if (e.status !== 404) console.log(`Oud bericht ${ev.titel} verwijderen: ${e.message}`); }
    console.log(`Opnieuw geplaatst (volgorde): ${ev.titel} (${ev.datum})`);
  }
}

// ---------- mededelingen ----------
const SOORT = {
  info:       { label: 'Mededeling',           emoji: '📢', color: 0x22d3ee },
  belangrijk: { label: 'Belangrijke mededeling', emoji: '⚠️', color: 0xf0b24e },
  dringend:   { label: 'Dringende mededeling',  emoji: '🚨', color: 0xef4444 }
};
const ROLE_ID = String(process.env.DISCORD_MEDEDELINGEN_ROLE_ID || '').trim();
// Components V2: [tag] + kader (kleur van de soort) met banner per soort (assets/img/discord/), titel, tekst,
// lijn, wie/wanneer met de knop naar de lobby ernaast
function noticeComponents(n, s, ping) {
  const unix = Math.floor(new Date(n.created_at).getTime() / 1000);
  const soort = SOORT[n.soort] ? n.soort : 'info';
  const box = {
    type: 17, accent_color: s.color, components: [
      { type: 12, items: [{ media: { url: `${SITE_URL}assets/img/discord/mededeling-${soort}.png` }, description: s.label }] },
      { type: 10, content: `# ${n.titel}` },
      { type: 10, content: n.tekst },
      { type: 14, divider: true, spacing: 2 },
      { type: 9,
        components: [{ type: 10, content: `-# Geplaatst door\n**👤 ${n.door || 'Boss'}**\n-# <t:${unix}:f> · <t:${unix}:R>` }],
        accessory: { type: 2, style: 5, label: 'Open de lobby', emoji: { name: '🏠' }, url: `${SITE_URL}#/lobby` } }
    ]
  };
  return ping ? [{ type: 10, content: `🔔 <@&${ROLE_ID}>` }, box] : [box];
}
// wat er in het bericht staat: wijzigt dit (bv. de ondertekening), dan wordt het Discord-bericht bijgewerkt
const noticeSig = n => JSON.stringify([n.titel, n.tekst, n.soort, n.door, !!n.tag]);

async function notices() {
  if (!DISCORD_MEDEDELINGEN_CHANNEL_ID) { console.log('Geen mededelingen-kanaal ingesteld — overgeslagen.'); return; }
  const [list, posts] = await Promise.all([sb('notices?select=*&order=created_at.asc'), sb('notice_discord?select=*')]);
  const ids = new Set(list.map(n => n.id));
  const posted = new Set(posts.map(p => p.notice_id));
  const byId = new Map(list.map(n => [n.id, n]));
  // kolom notice_discord.sig bestaat pas na supabase/update-v2-mededeling-door.sql
  const hasSig = !posts.length || 'sig' in posts[0];

  // gewijzigd op de site (bv. de ondertekening) → bericht bijwerken. Een mededelingbericht wordt NOOIT verwijderd:
  // lukt bijwerken niet (bv. oude opmaak), dan blijft het oude bericht gewoon staan.
  for (const p of hasSig ? posts : []) {
    const n = byId.get(p.notice_id);
    if (!n || p.sig === noticeSig(n)) continue;
    const s = SOORT[n.soort] || SOORT.info;
    const ping = n.tag === true && /^\d+$/.test(ROLE_ID);
    try {
      await discord(`/channels/${p.channel_id}/messages/${p.message_id}`, 'PATCH', { flags: 1 << 15, allowed_mentions: { parse: [] }, components: noticeComponents(n, s, ping) });
      console.log(`Mededeling bijgewerkt in Discord: ${n.titel}`);
    } catch (e) { console.log(`Mededeling ${n.titel} niet bij te werken (blijft staan zoals ze is): ${e.message}`); }
    await sbUpdate('notice_discord', `notice_id=eq.${p.notice_id}`, { sig: noticeSig(n) });
  }

  // verwijderd op de site (uit de lobby) → het bericht in Discord blijft staan; enkel de koppeling opruimen
  for (const p of posts) {
    if (ids.has(p.notice_id)) continue;
    await sbDelete('notice_discord', `notice_id=eq.${p.notice_id}`);
    console.log(`Mededeling uit de lobby gehaald, blijft in Discord: ${p.notice_id}`);
  }

  // nieuw → posten (enkel van de laatste 24u, zodat oude mededelingen er niet ineens allemaal in komen)
  const since = Date.now() - 24 * HOUR;
  for (const n of list) {
    if (posted.has(n.id) || new Date(n.created_at).getTime() < since) continue;
    const s = SOORT[n.soort] || SOORT.info;
    // enkel aangevinkt ("Tag in Discord") tagt de rol @Varrios Los Aztecas (DISCORD_MEDEDELINGEN_ROLE_ID); zonder rol-ID: niemand taggen
    const ping = n.tag === true && /^\d+$/.test(ROLE_ID);
    const sent = await discord(`/channels/${DISCORD_MEDEDELINGEN_CHANNEL_ID}/messages`, 'POST', {
      flags: 1 << 15,   // IS_COMPONENTS_V2: kader met kleur + logo i.p.v. een embed (geen content/embeds toegelaten)
      allowed_mentions: { parse: [], roles: ping ? [ROLE_ID] : [] },
      components: noticeComponents(n, s, ping)
    });
    await sbInsert('notice_discord', { notice_id: n.id, channel_id: DISCORD_MEDEDELINGEN_CHANNEL_ID, message_id: sent.id, ...(hasSig ? { sig: noticeSig(n) } : {}) });
    console.log(`Mededeling gepost: ${n.titel}${ping ? ' (rol getagd)' : ''}`);
  }
}

// ---------- amfi-tickets: melding in het lead-kanaal ----------
// Eén bericht per ticket, dat wordt bijgewerkt als de status verandert. Bijgehouden in amfi_discord.
const AMFI_STATUS = {
  wachtrij:    { label: 'In wachtrij',    emoji: '🕓', color: 0x38bdf8 },
  bezig:       { label: 'In behandeling', emoji: '🛠️', color: 0xf0b24e },
  klaar:       { label: 'Afgerond',       emoji: '✅', color: 0x9be15d },
  geannuleerd: { label: 'Geannuleerd',    emoji: '❌', color: 0x6b7280 }
};
function amfiMessage(t) {
  const s = AMFI_STATUS[t.status] || AMFI_STATUS.wachtrij;
  const aantal = (t.quote && t.quote.amfetamine) || t.keer;
  const door = t.status === 'bezig' ? t.medewerker_naam : t.status === 'klaar' ? (t.afgerond_door_naam || t.medewerker_naam) : null;
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Amfi ticket #${String(t.nr).padStart(3, '0')}`,
      url: `${SITE_URL}#/amfi/${t.id}`,
      description: `**${t.user_name}** heeft een ticket aangemaakt om **${aantal} amfetamine** om te zetten.\n\n**Status:** ${s.emoji} ${s.label}${door ? ` — ${door}` : ''}`,
      color: s.color
    }]
  };
}

async function amfi() {
  if (!DISCORD_AMFI_CHANNEL_ID) { console.log('Geen amfi-kanaal ingesteld — overgeslagen.'); return; }
  let posts;
  try { posts = await sb('amfi_discord?select=*'); }
  catch (e) { console.log('Amfi-meldingen overgeslagen: voer eerst supabase/update-v2-amfi-discord.sql uit in Supabase.'); return; }
  const tickets = await sb('amfi_tickets?select=id,nr,user_name,keer,quote,status,medewerker_naam,afgerond_door_naam,created_at&order=created_at.asc');
  const byTicket = new Map(posts.map(p => [p.ticket_id, p]));
  const since = Date.now() - 24 * HOUR;
  for (const t of tickets) {
    const msg = amfiMessage(t), sig = msg.embeds[0].description, post = byTicket.get(t.id);
    if (!post) {
      // nieuw → posten (enkel van de laatste 24u, zodat oude tickets er niet ineens allemaal in komen)
      if (new Date(t.created_at).getTime() < since) continue;
      const sent = await discord(`/channels/${DISCORD_AMFI_CHANNEL_ID}/messages`, 'POST', msg);
      await sbInsert('amfi_discord', { ticket_id: t.id, channel_id: DISCORD_AMFI_CHANNEL_ID, message_id: sent.id, sig });
      console.log(`Amfi ticket gepost: #${t.nr} (${t.status})`);
    } else if (post.sig !== sig) {
      try {
        await discord(`/channels/${post.channel_id}/messages/${post.message_id}`, 'PATCH', msg);
        await sbUpdate('amfi_discord', `ticket_id=eq.${t.id}`, { sig });
        console.log(`Amfi ticket bijgewerkt: #${t.nr} (${t.status})`);
      } catch (e) {
        // bericht verwijderd in Discord → niet opnieuw proberen
        if (e.status === 404) await sbUpdate('amfi_discord', `ticket_id=eq.${t.id}`, { sig });
        console.log(`Amfi ticket #${t.nr} bijwerken: ${e.message}`);
      }
    }
  }
}

// ---------- leden-lijst: één bericht met alle leden per rang ----------
// Bron = de Ledenlijst op de site (users.rank, volgorde = sort_order). Kanaal: DISCORD_LEDENLIJST_CHANNEL_ID,
// of anders het kanaal met "leden-lijst" in de naam op dezelfde server als de agenda.
// Het bot-bericht wordt teruggevonden in het kanaal (geen tabel nodig) en enkel aangepast als er iets veranderd is.
// Rang-logo's = emoji's van de bot zelf (application emojis, uit .github/assets/rangen/<id>.png), 1× geüpload.
// ⚠️ Volgorde en ids gelijk houden met App.RANKS in assets/js/config.js.
const RANGEN = [
  ['oprichter', 'Fundador', 'Oprichter'], ['kolonel', 'Coronel', 'Kolonel'], ['generaal', 'General', 'Generaal'],
  ['adviseur', 'Asesor', 'Adviseur'], ['kapitein', 'Capitán', 'Kapitein'], ['strateeg', 'Estratega', 'Strateeg'],
  ['coordinator', 'Coordinador', 'Coördinator'], ['veteraan', 'Veterano', 'Veteraan'], ['broeder', 'Hermano', 'Broeder'],
  ['lid', 'Miembro', 'Lid'], ['koerier', 'Mensajero', 'Koerier']
];
const RANK_MIGRATE = { boss: 'oprichter', underboss: 'kolonel', capo: 'kapitein', veterano: 'veteraan', soldado: 'lid', prospect: 'koerier' };
const MAX_LEDEN = 25;
const naamNet = n => String(n || '?').trim().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

async function rangEmojis() {
  const app = await discord('/applications/@me');
  const have = (await discord(`/applications/${app.id}/emojis`)).items || [];
  const out = {};
  const { readFile } = await import('node:fs/promises');
  for (const [id] of RANGEN) {
    const name = `vla_${id}`;
    let e = have.find(x => x.name === name);
    if (!e) {
      try {
        const png = await readFile(new URL(`../assets/rangen/${id}.png`, import.meta.url));
        e = await discord(`/applications/${app.id}/emojis`, 'POST', { name, image: `data:image/png;base64,${png.toString('base64')}` });
        console.log(`Rang-emoji geüpload: ${name}`);
      } catch (err) { console.log(`Rang-emoji ${name}: ${err.message}`); }
    }
    if (e) out[id] = `<:${name}:${e.id}>`;
  }
  return out;
}

// de server (guild) van het agenda-kanaal + al zijn kanalen — 1× per run opgehaald, gedeeld door leden-lijst en afwezigheid
let serverInfo = null;
const server = () => serverInfo || (serverInfo = (async () => {
  const agenda = await discord(`/channels/${DISCORD_AGENDA_CHANNEL_ID}`);
  return { guildId: agenda.guild_id, channels: await discord(`/guilds/${agenda.guild_id}/channels`) };
})());
// kanaal-ID uit een secret, of anders het tekstkanaal waarvan de naam past bij re
async function kanaalOpNaam(envNaam, re) {
  const vast = String(process.env[envNaam] || '').trim();
  if (vast) return vast;
  const c = (await server()).channels.find(ch => ch.type === 0 && re.test(ch.name));
  return c ? c.id : null;
}
const ledenKanaal = () => kanaalOpNaam('DISCORD_LEDENLIJST_CHANNEL_ID', /leden-?lijst/i);

function ledenTekst(users, emo) {
  // alfabetisch binnen elke rang; geen lege regels tussen de blokken (zoals de lijst van Stijn)
  const leden = users.filter(u => String(u.name || '').trim().toLowerCase() !== 'gangpot')
    .map(u => ({ ...u, naam: naamNet(u.name) }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  const rangVan = u => RANK_MIGRATE[u.rank] || u.rank;
  const blokken = RANGEN.map(([id, es, nl]) => {
    const namen = leden.filter(u => rangVan(u) === id).map(u => `- ${u.naam}`);
    return [`## ${emo[id] ? emo[id] + ' ' : ''}\\|\\| ${es} - ${nl}`, ...namen].join('\n');
  });
  const zonder = leden.filter(u => !RANGEN.some(([id]) => id === rangVan(u)));
  if (zonder.length) blokken.push(['## Nog geen rang', ...zonder.map(u => `- ${u.naam}`)].join('\n'));
  return `${blokken.join('\n')}\n\n-# Leden totaal: ${leden.length}/${MAX_LEDEN} · wordt automatisch bijgewerkt vanuit de website`;
}

async function ledenlijst() {
  try { await ledenlijstBijwerken(); }
  catch (e) {
    if (e.status === 403) { console.log('Leden-lijst: de bot mag niet lezen/sturen in het leden-lijst-kanaal — geef hem daar toegang.'); return; }
    throw e;
  }
}
async function ledenlijstBijwerken() {
  const kanaal = await ledenKanaal();
  if (!kanaal) { console.log('Geen leden-lijst-kanaal gevonden — overgeslagen.'); return; }
  const [users, emo, ik, berichten] = await Promise.all([
    sb('users?select=name,rank,sort_order&order=sort_order.asc'),
    rangEmojis(),
    discord('/users/@me'),
    discord(`/channels/${kanaal}/messages?limit=50`)
  ]);
  const content = ledenTekst(users, emo);
  if (content.length > 2000) { console.log(`Leden-lijst te lang (${content.length} tekens) — overgeslagen.`); return; }
  const msg = { content, allowed_mentions: { parse: [] } };
  const mijn = berichten.find(m => m.author && m.author.id === ik.id);
  if (!mijn) {
    await discord(`/channels/${kanaal}/messages`, 'POST', msg);
    console.log('Leden-lijst gepost.');
  } else if (mijn.content !== content) {
    await discord(`/channels/${kanaal}/messages/${mijn.id}`, 'PATCH', msg);
    console.log('Leden-lijst bijgewerkt.');
  }
}

// ---------- afwezigheid: #afwezigheid + rol "Afwezig" ----------
// 1. Onderaan het kanaal staat altijd één bericht met de knop "Afwezigheid melden" (afw:open → Edge Function:
//    reden kiezen → venster van/tot → fn_add_absence → melding in het kanaal).
// 2. Meldingen van de site (laatste 24u) worden ook in het kanaal gezet; status/gegevens gewijzigd → bericht bijgewerkt;
//    melding verwijderd op de site → bericht weg. Bijgehouden in absence_discord (supabase/update-v2-discord-afwezig.sql).
// 3. Rol "Afwezig" (wordt aangemaakt als hij nog niet bestaat): wie vandaag afwezig is (van ≤ vandaag ≤ tot, niet afgekeurd)
//    krijgt hem, anders gaat hij eraf. Bestaat er een rol "Aanwezig", dan krijgt iedereen die NIET afwezig is die rol.
//    Enkel voor profielen met een Discord-ID. De bot heeft "Rollen beheren" nodig en zijn eigen rol moet hoger staan.
// absenceMessage() is een kopie van die in de Edge Function — hou ze gelijk.
const AFW_REDENEN = {
  vakantie: { label: 'Vakantie', emoji: '🏖️' },
  werk: { label: 'Werk / school', emoji: '💼' },
  ziek: { label: 'Ziek', emoji: '🤒' },
  familie: { label: 'Familie', emoji: '❤️' },
  andere: { label: 'Andere', emoji: '✏️' }
};
const AFW_STATUS = {
  aangevraagd: { label: 'Te keuren', emoji: '⏳', color: 0xf0b24e },
  goedgekeurd: { label: 'Goedgekeurd', emoji: '✅', color: 0x9be15d },
  afgekeurd: { label: 'Afgekeurd', emoji: '❌', color: 0xef4444 }
};
const datumBE = d => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
function absenceMessage(a, discordId) {
  const r = AFW_REDENEN[a.reden] || AFW_REDENEN.andere;
  const s = AFW_STATUS[a.status] || AFW_STATUS.aangevraagd;
  const reden = a.reden === 'andere' ? (a.toelichting || 'Andere') : r.label + (a.toelichting ? ` — ${a.toelichting}` : '');
  const lines = [
    `**Naam:** ${discordId ? `<@${discordId}>` : a.user_name}`,
    `**Begindatum:** ${datumBE(a.van)}`,
    `**Einddatum:** ${datumBE(a.tot)}`,
    `**Reden:** ${r.emoji} ${reden}`,
    '',
    `**Status:** ${s.emoji} ${s.label}${a.status !== 'aangevraagd' && a.beoordeeld_door ? ` — ${a.beoordeeld_door}` : ''}`
  ];
  if (a.reactie) lines.push(`💬 ${a.reactie}`);
  return {
    allowed_mentions: { parse: [] },
    embeds: [{ title: `Afwezigheid — ${a.user_name}`, url: `${SITE_URL}#/afwezig`, description: lines.join('\n'), color: s.color }],
    components: a.status === 'aangevraagd' ? [{
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Goedkeuren', emoji: { name: '✅' }, custom_id: `afw:ok:${a.id}` },
        { type: 2, style: 4, label: 'Afkeuren', emoji: { name: '❌' }, custom_id: `afw:nee:${a.id}` }
      ]
    }] : []
  };
}
const absenceSig = m => JSON.stringify([m.embeds[0].description, m.embeds[0].color, m.components.length]);

const afwPanel = () => ({
  allowed_mentions: { parse: [] },
  embeds: [{
    title: '📝 Afwezig melden',
    description: 'Ben je een tijdje afwezig? Klik op **Afwezigheid melden**, kies een reden en vul in **van wanneer tot wanneer**.\n\n' +
      '• Je melding komt hieronder en op de site; de Boss keurt ze goed.\n' +
      '• Zolang je afwezig bent, heb je de rol **Afwezig** — na de einddatum verdwijnt die vanzelf.\n' +
      '• Plannen veranderd? Verwijder je melding op de site.',
    color: 0xf472b6
  }],
  components: [{
    type: 1,
    components: [
      { type: 2, style: 1, label: 'Afwezigheid melden', emoji: { name: '📝' }, custom_id: 'afw:open' },
      { type: 2, style: 5, label: 'Open op de site', url: `${SITE_URL}#/afwezig` }
    ]
  }]
});
const isPanel = (m, botId) => m.author && m.author.id === botId &&
  (m.components || []).some(row => (row.components || []).some(c => c.custom_id === 'afw:open'));

async function afwezigheid() {
  const [absences, users] = await Promise.all([
    sb('absences?select=*&order=created_at.asc'),
    sb('users?select=id,name,discord_id')
  ]);
  const discordVan = new Map(users.map(u => [u.id, u.discord_id || null]));
  const results = await Promise.allSettled([afwKanaal(absences, discordVan), afwRollen(absences, users)]);
  results.forEach(r => { if (r.status === 'rejected') console.log(`Afwezigheid: ${r.reason && r.reason.message}`); });
}

async function afwKanaal(absences, discordVan) {
  const kanaal = await kanaalOpNaam('DISCORD_AFWEZIG_CHANNEL_ID', /afwezig/i);
  if (!kanaal) { console.log('Geen afwezigheid-kanaal gevonden — overgeslagen.'); return; }
  let posts = null;
  try { posts = await sb('absence_discord?select=*'); }
  catch (e) { console.log('Afwezigheid-meldingen overgeslagen: voer eerst supabase/update-v2-discord-afwezig.sql uit in Supabase.'); }

  if (posts) {
    const byId = new Map(posts.map(p => [p.absence_id, p]));
    const bestaat = new Set(absences.map(a => a.id));
    const since = Date.now() - 24 * HOUR;
    for (const a of absences) {
      const msg = absenceMessage(a, discordVan.get(a.user_id)), sig = absenceSig(msg), post = byId.get(a.id);
      if (!post) {
        if (new Date(a.created_at).getTime() < since) continue;   // enkel nieuwe meldingen (van de site)
        const sent = await discord(`/channels/${kanaal}/messages`, 'POST', msg);
        await sbInsert('absence_discord', { absence_id: a.id, channel_id: kanaal, message_id: sent.id, sig });
        console.log(`Afwezigheid gepost: ${a.user_name} ${a.van} → ${a.tot}`);
      } else if (post.sig !== sig) {
        try { await discord(`/channels/${post.channel_id}/messages/${post.message_id}`, 'PATCH', msg); }
        catch (e) { if (e.status !== 404) throw e; }
        await sbUpdate('absence_discord', `absence_id=eq.${a.id}`, { sig });
        console.log(`Afwezigheid bijgewerkt: ${a.user_name} (${a.status})`);
      }
    }
    // verwijderd op de site → bericht weg
    for (const p of posts.filter(p => !bestaat.has(p.absence_id))) {
      try { await discord(`/channels/${p.channel_id}/messages/${p.message_id}`, 'DELETE'); }
      catch (e) { if (e.status !== 404) { console.log(`Afwezigheid-bericht verwijderen: ${e.message}`); continue; } }
      await sbDelete('absence_discord', `absence_id=eq.${p.absence_id}`);
      console.log(`Afwezigheid verwijderd op de site — bericht weg: ${p.absence_id}`);
    }
  }

  // het meld-bericht met de knop staat altijd onderaan: is er iets na gekomen, dan opnieuw posten
  const [ik, berichten] = await Promise.all([discord('/users/@me'), discord(`/channels/${kanaal}/messages?limit=30`)]);
  const panels = berichten.filter(m => isPanel(m, ik.id));
  if (panels.length === 1 && berichten[0].id === panels[0].id) return;
  for (const p of panels) {
    try { await discord(`/channels/${kanaal}/messages/${p.id}`, 'DELETE'); } catch (e) { if (e.status !== 404) throw e; }
  }
  await discord(`/channels/${kanaal}/messages`, 'POST', afwPanel());
  console.log('Afwezigheid: meld-knop (opnieuw) onderaan gezet.');
}

async function afwRollen(absences, users) {
  const { guildId } = await server();
  const rollen = await discord(`/guilds/${guildId}/roles`);
  // op ID (DISCORD_AFWEZIG_ROLE_ID / DISCORD_AANWEZIG_ROLE_ID in de workflow), anders op naam
  const rol = (env, naam) => {
    const id = String(process.env[env] || '').trim();
    return (id && rollen.find(r => r.id === id)) || rollen.find(r => r.name.trim().toLowerCase().includes(naam));
  };
  let afw = rol('DISCORD_AFWEZIG_ROLE_ID', 'afwezig');
  const aanw = rol('DISCORD_AANWEZIG_ROLE_ID', 'aanwezig');
  if (process.env.DISCORD_AANWEZIG_ROLE_ID && !aanw) console.log('Rol "Aanwezig" met dat ID niet gevonden op de server.');
  if (!afw) {
    afw = await discord(`/guilds/${guildId}/roles`, 'POST', { name: 'Afwezig', color: 0x95a5a6, mentionable: false, hoist: false });
    console.log('Rol "Afwezig" aangemaakt.');
  }
  const vandaag = dkey(new Date());
  const nuAfwezig = new Set(absences.filter(a => a.status !== 'afgekeurd' && a.van <= vandaag && a.tot >= vandaag).map(a => a.user_id));
  for (const u of users.filter(x => x.discord_id && String(x.name || '').trim().toLowerCase() !== 'gangpot')) {
    let lid;
    try { lid = await discord(`/guilds/${guildId}/members/${u.discord_id}`); }
    catch (e) { if (e.status === 404) continue; throw e; }   // niet (meer) op de server
    const weg = nuAfwezig.has(u.id);
    const zet = async (rol, aan) => {
      if (!rol || lid.roles.includes(rol.id) === aan) return;
      try {
        await discord(`/guilds/${guildId}/members/${u.discord_id}/roles/${rol.id}`, aan ? 'PUT' : 'DELETE');
        console.log(`Rol ${rol.name} ${aan ? 'gegeven aan' : 'weggehaald bij'} ${u.name}`);
      } catch (e) {
        if (e.status === 403) console.log(`Rol ${rol.name}: de bot mag rollen niet beheren — geef hem "Rollen beheren" en zet zijn rol boven "${rol.name}".`);
        else throw e;
      }
    };
    await zet(afw, weg);
    await zet(aanw, !weg);
  }
}

// agenda, mededelingen, amfi, leden-lijst en afwezigheid los van elkaar: een fout in het ene stopt het andere niet
const results = await Promise.allSettled([main(), notices(), amfi(), ledenlijst(), afwezigheid()]);
results.forEach(r => { if (r.status === 'rejected') console.error(r.reason); });
if (results.some(r => r.status === 'rejected')) process.exit(1);
