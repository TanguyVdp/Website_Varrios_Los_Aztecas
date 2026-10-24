// ============================================================
// Varrios portaal — Discord-bot voor de agenda (periodiek)
//
// Draait mee in .github/workflows/discord-notify.yml (elke ~2 min via cron-job.org).
//  1. Nieuwe activiteit in de agenda → bericht in het agenda-kanaal met knoppen
//     (✅ Aanwezig / 🤔 Misschien / ❌ Afwezig + link naar de site).
//  2. Houdt dat bericht bij: wie wat geantwoord heeft (ook antwoorden via de site).
//  3. Herinnering per DM, 24u en 2u voor de start, aan wie nog niet geantwoord heeft
//     (wie die dag als afwezig gemeld staat, wordt overgeslagen). DM's die niet lukken
//     (DM's uitgeschakeld) → één vermelding in het kanaal.
//  4. Activiteit begonnen → knoppen uit; 12u na de start → bericht weg uit het kanaal. Activiteit verwijderd → bericht op "geannuleerd".
//     Berichten staan in volgorde van de datum: komt er een activiteit tussen, dan worden de latere opnieuw gepost.
//  5. Mededelingen van de Boss → bericht in het mededelingen-kanaal (enkel met het vinkje "Tag in Discord"
//     wordt de rol @Varrios Los Aztecas getagd, via DISCORD_MEDEDELINGEN_ROLE_ID);
//     mededeling gewijzigd → bericht bijgewerkt; verwijderd op de site (uit de lobby) → het bericht BLIJFT in Discord.
// De knoppen zelf worden verwerkt door de Supabase Edge Function supabase/functions/discord-agenda.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN, DISCORD_AGENDA_CHANNEL_ID (+ optioneel SITE_URL,
// DISCORD_MEDEDELINGEN_CHANNEL_ID — zonder dat kanaal worden mededelingen gewoon overgeslagen).
// Ontbreekt er één van de verplichte, dan doet dit script niets (zodat de zakjes-melding gewoon blijft werken).
// buildMessage() is een kopie van die in de Edge Function — hou ze gelijk.
// ============================================================

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN, DISCORD_AGENDA_CHANNEL_ID, DISCORD_MEDEDELINGEN_CHANNEL_ID } = process.env;
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
  { id: 'misschien', label: 'Misschien', emoji: '🤔', style: 2 },
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
        ...RSVP.map(s => {
          const l = mine.filter(r => r.status === s.id).map(r => r.user_name + (r.reden ? ` *(${r.reden})*` : ''));
          return { name: `${s.emoji} ${s.label} (${l.length})`, value: names(l), inline: true };
        }),
        ...(open.length ? columns(`⏳ Geen antwoord (${open.length})`, open) : [{ name: '⏳ Geen antwoord (0)', value: 'Iedereen heeft geantwoord 🎉' }])
      ],
      footer: { text: `${t.label} · geplaatst door ${ev.door || 'Boss'}` }
    }],
    components: [{
      type: 1,
      components: [
        ...RSVP.map(s => ({ type: 2, style: s.style, label: s.label, emoji: { name: s.emoji }, custom_id: `rsvp:${ev.id}:${s.id}`, disabled: closed })),
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
const whenText = ev => `${dayLabel(ev.datum)}${ev.tijd ? ` om ${ev.tijd}` : ''}`;

async function remind(ev, hours, rsvps, members, absences) {
  const answered = new Set(rsvps.filter(r => r.event_id === ev.id).map(r => r.user_id));
  const absent = new Set(absences.filter(a => a.van <= ev.datum && a.tot >= ev.datum).map(a => a.user_id));
  const targets = members.filter(u => u.discord_id && !answered.has(u.id) && !absent.has(u.id));
  const failed = [];
  const msg = buildMessage(ev, rsvps, members);
  const content = `⏰ **Herinnering:** "${ev.titel}" begint ${hours === 24 ? '**morgen**' : '**binnen 2 uur**'} (${whenText(ev)}).\nJe hebt nog niet laten weten of je erbij bent — klik hieronder.`;
  for (const u of targets) {
    try {
      const dm = await discord('/users/@me/channels', 'POST', { recipient_id: u.discord_id });
      await discord(`/channels/${dm.id}/messages`, 'POST', { content, ...msg });
      console.log(`  DM (${hours}u) → ${u.name}`);
    } catch (e) {
      console.log(`  DM (${hours}u) aan ${u.name} lukte niet: ${e.message}`);
      failed.push(u);
    }
  }
  if (failed.length) {
    await discord(`/channels/${DISCORD_AGENDA_CHANNEL_ID}/messages`, 'POST', {
      content: `⏰ ${failed.map(u => `<@${u.discord_id}>`).join(' ')} — "${ev.titel}" begint ${hours === 24 ? 'morgen' : 'binnen 2 uur'} en jullie hebben nog niet geantwoord. Klik op een knop in het bericht hierboven of op de site.`,
      allowed_mentions: { users: failed.map(u => u.discord_id) }
    });
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
  const byEvent = new Map(posts.map(p => [p.event_id, p]));
  const eventIds = new Set(events.map(e => e.id));

  // verwijderde activiteiten → bericht op "geannuleerd"
  for (const p of posts) {
    if (eventIds.has(p.event_id) || p.closed) continue;
    const still = await sb(`events?select=id&id=eq.${p.event_id}`);
    if (still.length) continue;   // bestaat nog, maar is ouder dan gisteren
    try {
      await discord(`/channels/${p.channel_id}/messages/${p.message_id}`, 'PATCH', {
        content: '❌ **Deze activiteit is geannuleerd.**', components: [],
        embeds: [{ title: 'Geannuleerd', description: 'De Boss heeft deze activiteit uit de agenda gehaald.', color: 0x6b7280 }]
      });
    } catch (e) { console.log(`Annuleren bericht ${p.message_id}: ${e.message}`); }
    await sbDelete('agenda_discord', `event_id=eq.${p.event_id}`);
    console.log(`Geannuleerd: ${p.event_id}`);
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
      post = { event_id: ev.id, channel_id: DISCORD_AGENDA_CHANNEL_ID, message_id: sent.id, counts: msgSig(msg),
        // net geplaatst: geen herinnering voor een moment dat al voorbij is
        reminded_24: left < 24 * HOUR, reminded_2: left < 2 * HOUR, closed: false };
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

    // herinneringen
    for (const [key, hours] of [['reminded_24', 24], ['reminded_2', 2]]) {
      if (post[key] || now < start - hours * HOUR) continue;
      await sbUpdate('agenda_discord', `event_id=eq.${ev.id}`, { [key]: true });   // eerst markeren: nooit dubbel
      post[key] = true;
      console.log(`Herinnering ${hours}u: ${ev.titel}`);
      await remind(ev, hours, rsvps, members, absences);
    }
  }

  await reorder(events, rsvps, members, now);
}

// Volgorde in het kanaal = volgorde van de datum. Komt er een activiteit tussen (later aangemaakt, maar vroeger),
// dan worden de activiteiten die erna horen opnieuw gepost (nieuw bericht, oud weg). Antwoorden staan in de database,
// dus er gaat niets verloren; de knoppen werken via event_id. Enkel open (nog niet begonnen) activiteiten.
async function reorder(events, rsvps, members, now) {
  const posts = await sb('agenda_discord?select=*&closed=eq.false');
  const byEvent = new Map(posts.filter(p => p.channel_id === DISCORD_AGENDA_CHANNEL_ID).map(p => [p.event_id, p]));
  const open = events.filter(ev => byEvent.has(ev.id) && now < startOf(ev))
    .sort((a, b) => startOf(a) - startOf(b) || String(a.created_at).localeCompare(String(b.created_at)));
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

// agenda en mededelingen los van elkaar: een fout in het ene stopt het andere niet
const results = await Promise.allSettled([main(), notices()]);
results.forEach(r => { if (r.status === 'rejected') console.error(r.reason); });
if (results.some(r => r.status === 'rejected')) process.exit(1);
