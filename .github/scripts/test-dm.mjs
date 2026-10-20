// ============================================================
// Varrios portaal — test: de agenda-bot stuurt één privébericht (DM) naar een lid.
// Wordt enkel handmatig gestart: GitHub → Actions → "Test: DM van de bot" → Run workflow.
// Zoekt de Discord-ID van het profiel (users.discord_id) op naam en stuurt het bericht.
// ============================================================

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN } = process.env;
const NAAM = (process.env.NAAM || 'Bob V.').trim();
const BERICHT = (process.env.BERICHT || 'Test').trim().slice(0, 1900);
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !DISCORD_BOT_TOKEN) {
  console.error('Secrets ontbreken (SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN).');
  process.exit(1);
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/users?select=name,discord_id&name=ilike.${encodeURIComponent(NAAM)}`, {
  headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
});
if (!res.ok) { console.error(`Supabase: ${res.status} ${await res.text()}`); process.exit(1); }
const [user] = await res.json();
if (!user) { console.error(`Geen profiel gevonden met de naam "${NAAM}".`); process.exit(1); }
if (!user.discord_id) { console.error(`${user.name} heeft nog geen Discord-ID (Boss menu → Ledenlijst → Discord).`); process.exit(1); }

const discord = async (path, body) => {
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
};

try {
  const dm = await discord('/users/@me/channels', { recipient_id: user.discord_id });
  await discord(`/channels/${dm.id}/messages`, { content: BERICHT });
  console.log(`✅ DM verstuurd naar ${user.name} (${user.discord_id}): "${BERICHT}"`);
} catch (e) {
  console.error(`❌ DM naar ${user.name} lukte niet: ${e.message}`);
  if (e.message.includes('50007')) console.error('   → Deze persoon laat geen privéberichten toe van leden van de server (Discord-instellingen → Privacy).');
  process.exit(1);
}
