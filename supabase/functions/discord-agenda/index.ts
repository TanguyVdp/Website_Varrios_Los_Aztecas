// ============================================================
// Varrios portaal — Discord-bot voor de agenda: knoppen verwerken
//
// Supabase Edge Function "discord-agenda". Discord stuurt elke klik op een knop
// (✅ Aanwezig / 🤔 Misschien / ❌ Afwezig) naar deze functie (Interactions Endpoint URL).
// De functie zoekt het profiel bij de Discord-ID (users.discord_id), registreert het
// antwoord met fn_set_rsvp (zelfde als op de site) en werkt het agenda-bericht bij.
//
// Secrets (Supabase → Edge Functions → Secrets): DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, SITE_URL
// SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn er automatisch.
// "Verify JWT" moet UIT staan voor deze functie (Discord stuurt geen Supabase-token).
//
// buildMessage() is een kopie van die in .github/scripts/agenda-bot.mjs — hou ze gelijk.
// Ook voor #afwezigheid: knop "Afwezigheid melden" → reden → venster (van/tot) → fn_add_absence,
// en de Boss-knoppen Goedkeuren/Afkeuren. absenceMessage() is ook een kopie uit agenda-bot.mjs.
// ============================================================
import nacl from "npm:tweetnacl@1.0.3";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://tanguyvdp.github.io/Website_Varrios_Los_Aztecas/").replace(/\/?$/, "/");
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API = "https://discord.com/api/v10";

// ---------- agenda-bericht (kopie van agenda-bot.mjs) ----------
const RSVP = [
  { id: "aanwezig", label: "Aanwezig", emoji: "✅", style: 3 },
  { id: "misschien", label: "Misschien", emoji: "🤔", style: 2, old: true },   // geen knop meer; oude antwoorden blijven zichtbaar
  { id: "afwezig", label: "Afwezig", emoji: "❌", style: 4 },
];
const TYPES: Record<string, { label: string; emoji: string; color: number }> = {
  vergadering: { label: "Vergadering", emoji: "👥", color: 0x8b7cf6 },
  actie: { label: "Actie", emoji: "🔥", color: 0xef4444 },
  deal: { label: "Deal", emoji: "🤝", color: 0x9be15d },
  feest: { label: "Feest", emoji: "👑", color: 0xf4b41a },
  andere: { label: "Andere", emoji: "📌", color: 0x22d3ee },
};
const dayLabel = (datum: string) => {
  const s = new Date(datum + "T12:00:00Z").toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// één naam per regel, met een bolletje; leeg = streepje
const names = (list: string[]) => (list.length ? list.map((n) => `• ${n}`).join("\n") : "—").slice(0, 1024);
// "nog niet geantwoord" verdeeld over 3 kolommen (de 2e en 3e kolom hebben een onzichtbare titel)
const columns = (title: string, list: string[]) => {
  const per = Math.max(1, Math.ceil(list.length / 3));
  return [0, 1, 2].map((i) => ({ name: i === 0 ? title : "​", value: names(list.slice(i * per, (i + 1) * per)).replace(/^—$/, i === 0 ? "—" : "​"), inline: true }));
};

// één veld per antwoord ("misschien" enkel als iemand dat vroeger koos), aangevuld tot een volle rij van 3
// deno-lint-ignore no-explicit-any
const rsvpFields = (mine: any[]) => {
  const f = RSVP.map((s) => {
    const l = mine.filter((r) => r.status === s.id).map((r) => r.user_name + (r.reden ? ` *(${r.reden})*` : ""));
    return s.old && !l.length ? null : { name: `${s.emoji} ${s.label} (${l.length})`, value: names(l), inline: true };
  }).filter(Boolean);
  while (f.length % 3) f.push({ name: "​", value: "​", inline: true });
  return f;
};

// deno-lint-ignore no-explicit-any
function buildMessage(ev: any, rsvps: any[], members: any[], closed = false) {
  const t = TYPES[ev.type] || TYPES.andere;
  const mine = rsvps.filter((r) => r.event_id === ev.id);
  const answered = new Set(mine.map((r) => r.user_id));
  const open = members.filter((u) => !answered.has(u.id)).map((u) => u.name);
  const lines = [`🗓️ **${dayLabel(ev.datum)}**${ev.tijd ? ` om **${ev.tijd}**` : ""}`];
  if (ev.plaats) lines.push(`📍 ${ev.plaats}`);
  if (ev.info) lines.push("", ev.info);
  lines.push("", closed ? "🔒 Aanmelden is gesloten." : "Ben jij erbij? Klik hieronder — je kan je antwoord altijd nog wijzigen.");
  return {
    embeds: [{
      title: `${t.emoji} ${ev.titel}`,
      url: `${SITE_URL}#/agenda/${ev.id}`,
      description: lines.join("\n"),
      color: t.color,
      fields: [
        ...rsvpFields(mine),
        ...(open.length ? columns(`⏳ Geen antwoord (${open.length})`, open) : [{ name: "⏳ Geen antwoord (0)", value: "Iedereen heeft geantwoord 🎉" }]),
      ],
      footer: { text: `${t.label} · geplaatst door ${ev.door || "Boss"}` },
    }],
    components: [{
      type: 1,
      components: [
        ...RSVP.filter((s) => !s.old).map((s) => ({ type: 2, style: s.style, label: s.label, emoji: { name: s.emoji }, custom_id: `rsvp:${ev.id}:${s.id}`, disabled: closed })),
        { type: 2, style: 5, label: "Open op de site", url: `${SITE_URL}#/agenda/${ev.id}` },
      ],
    }],
  };
}

// redenen bij "afwezig" — zelfde lijst als App.AGENDA.AFWEZIG in assets/js/config.js (labels moeten gelijk zijn)
const REDENEN = [
  { id: "werk", label: "Werk", emoji: "💼" },
  { id: "school", label: "School", emoji: "📚" },
  { id: "prive", label: "Privé", emoji: "🏠" },
  { id: "ziek", label: "Ziek", emoji: "🤒" },
  { id: "familie", label: "Familie", emoji: "❤️" },
  { id: "vakantie", label: "Vakantie", emoji: "🏖️" },
  { id: "andere", label: "Andere (zelf typen)", emoji: "✏️" },
];

// ---------- afwezigheid (kopie van absenceMessage in agenda-bot.mjs — hou ze gelijk) ----------
// redenen = App.ABSENCE.REASONS in assets/js/config.js (ids moeten gelijk zijn, de database controleert ze)
const AFW_REDENEN: Record<string, { label: string; emoji: string }> = {
  vakantie: { label: "Vakantie", emoji: "🏖️" },
  werk: { label: "Werk / school", emoji: "💼" },
  ziek: { label: "Ziek", emoji: "🤒" },
  familie: { label: "Familie", emoji: "❤️" },
  andere: { label: "Andere", emoji: "✏️" },
};
const AFW_STATUS: Record<string, { label: string; emoji: string; color: number }> = {
  aangevraagd: { label: "Te keuren", emoji: "⏳", color: 0xf0b24e },
  goedgekeurd: { label: "Goedgekeurd", emoji: "✅", color: 0x9be15d },
  afgekeurd: { label: "Afgekeurd", emoji: "❌", color: 0xef4444 },
};
const datumBE = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// deno-lint-ignore no-explicit-any
function absenceMessage(a: any, discordId: string | null) {
  const r = AFW_REDENEN[a.reden] || AFW_REDENEN.andere;
  const s = AFW_STATUS[a.status] || AFW_STATUS.aangevraagd;
  const reden = a.reden === "andere" ? (a.toelichting || "Andere") : r.label + (a.toelichting ? ` — ${a.toelichting}` : "");
  const lines = [
    `**Naam:** ${discordId ? `<@${discordId}>` : a.user_name}`,
    `**Begindatum:** ${datumBE(a.van)}`,
    `**Einddatum:** ${datumBE(a.tot)}`,
    `**Reden:** ${r.emoji} ${reden}`,
    "",
    `**Status:** ${s.emoji} ${s.label}${a.status !== "aangevraagd" && a.beoordeeld_door ? ` — ${a.beoordeeld_door}` : ""}`,
  ];
  if (a.reactie) lines.push(`💬 ${a.reactie}`);
  return {
    allowed_mentions: { parse: [] },
    embeds: [{ title: `Afwezigheid — ${a.user_name}`, url: `${SITE_URL}#/afwezig`, description: lines.join("\n"), color: s.color }],
    components: a.status === "aangevraagd" ? [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Goedkeuren", emoji: { name: "✅" }, custom_id: `afw:ok:${a.id}` },
        { type: 2, style: 4, label: "Afkeuren", emoji: { name: "❌" }, custom_id: `afw:nee:${a.id}` },
      ],
    }] : [],
  };
}
// deno-lint-ignore no-explicit-any
const absenceSig = (m: any) => JSON.stringify([m.embeds[0].description, m.embeds[0].color, m.components.length]);

// vandaag in België als 'YYYY-MM-DD'
const vandaag = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
// "24/11", "24-11", "24/11/2026" of "24/11/26" → 'YYYY-MM-DD' (zonder jaar: dit jaar, of volgend jaar als het al > 30 dagen voorbij is)
function parseDag(txt: string): string | null {
  const m = String(txt || "").trim().match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  const today = vandaag();
  let y = m[3] ? +m[3] : +today.slice(0, 4);
  if (y < 100) y += 2000;
  const k = (yy: number) => `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const ok = (yy: number) => { const t = new Date(Date.UTC(yy, mo - 1, d)); return t.getUTCFullYear() === yy && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d; };
  if (!ok(y)) return null;
  if (!m[3]) {
    const verschil = (Date.parse(today) - Date.parse(k(y))) / 86400000;
    if (verschil > 30 && ok(y + 1)) y += 1;
  }
  return k(y);
}
const AFW_FOUT: Record<string, string> = {
  EINDE_VOOR_START: "De einddatum ligt vóór de begindatum.",
  DATUM_VERLEDEN: "Die periode is al voorbij.",
  AFWEZIG_OVERLAP: "Je hebt in die periode al een afwezigheid gemeld. Bekijk of verwijder ze op de site.",
  TOELICHTING_NODIG: "Schrijf erbij waarom je afwezig bent.",
  GEEN_REDEN: "Kies een reden.",
};

// ---------- hulp ----------
const hex =(s: string) => new Uint8Array((s.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ephemeral = (content: string) => json({ type: 4, data: { content, flags: 64 } });
const discord = (path: string, method: string, body: unknown) => fetch(`${API}${path}`, {
  method, headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}).catch(() => null);

async function loadForEvent(eventId: string) {
  const [{ data: ev }, { data: rsvps }, { data: members }] = await Promise.all([
    sb.from("events").select("*").eq("id", eventId).maybeSingle(),
    sb.from("event_rsvps").select("*").eq("event_id", eventId),
    // alle profielen (behalve gangpot), ook wie nog nooit ingelogd heeft — zelfde lijst als in agenda-bot.mjs
    sb.from("users").select("id,name,sort_order").order("sort_order"),
  ]);
  return { ev, rsvps: rsvps ?? [], members: (members ?? []).filter((u) => u.name.trim().toLowerCase() !== "gangpot") };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Varrios agenda-bot");
  const sig = req.headers.get("X-Signature-Ed25519") ?? "";
  const ts = req.headers.get("X-Signature-Timestamp") ?? "";
  const body = await req.text();
  let ok = false;
  try { ok = nacl.sign.detached.verify(new TextEncoder().encode(ts + body), hex(sig), hex(PUBLIC_KEY)); } catch { ok = false; }
  if (!ok) return new Response("ongeldige handtekening", { status: 401 });

  const i = JSON.parse(body);
  if (i.type === 1) return json({ type: 1 });               // PING van Discord bij het instellen
  if (i.type !== 3 && i.type !== 5) return ephemeral("Onbekende actie.");   // 3 = knop/keuzelijst, 5 = ingevuld venster

  // custom_id: rsvp:<event>:<status> (knop) · reden:<event>[:<dm-bericht>] (keuzelijst) · redentxt:<event>[:<dm-bericht>] (venster)
  const [kind, eventId, arg] = String(i.data?.custom_id ?? "").split(":");
  const dm = !i.guild_id;

  const discordId = i.member?.user?.id ?? i.user?.id;
  const { data: user } = await sb.from("users").select("id,name,perm_boss,is_owner").eq("discord_id", discordId).limit(1).maybeSingle();
  if (!user) return ephemeral("Je Discord is nog niet gekoppeld aan een profiel op de site. Vraag de Boss om je Discord-ID in te stellen (Boss menu → Ledenlijst).");

  // ---------- afwezigheid melden (#afwezigheid) ----------
  // custom_id: afw:open (knop) · afw:reden (keuzelijst) · afw:form:<reden> (venster) · afw:ok:<id> / afw:nee:<id> (Boss)
  if (kind === "afw") {
    const sub = eventId;
    // 1. knop → reden kiezen (enkel zichtbaar voor wie klikte)
    if (sub === "open") {
      return json({ type: 4, data: { flags: 64, content: "📝 **Afwezigheid melden** — waarom ben je afwezig?", components: [{
        type: 1, components: [{ type: 3, custom_id: "afw:reden", placeholder: "Kies een reden…",
          options: Object.entries(AFW_REDENEN).map(([id, r]) => ({ label: r.label, value: id, emoji: { name: r.emoji } })) }],
      }] } });
    }
    // 2. reden gekozen → venster met de datums
    if (sub === "reden") {
      const v = i.data?.values?.[0];
      const r = AFW_REDENEN[v];
      if (!r) return json({ type: 7, data: { content: "Onbekende reden.", components: [] } });
      const nu = vandaag();
      const input = (id: string, label: string, placeholder: string, style = 1, required = true, max = 10) =>
        ({ type: 1, components: [{ type: 4, custom_id: id, label, style, required, max_length: max, placeholder }] });
      return json({ type: 9, data: { custom_id: `afw:form:${v}`, title: `Afwezig — ${r.label}`, components: [
        input("van", "Vanaf (dag/maand)", `bv. ${datumBE(nu).slice(0, 5)}`),
        input("tot", "Tot en met (dag/maand)", `bv. ${datumBE(nu).slice(0, 5)}`),
        input("toelichting", v === "andere" ? "Waarom ben je afwezig?" : "Toelichting (mag leeg)", "bv. examens, op reis, …", 2, v === "andere", 140),
      ] } });
    }
    // 3. venster ingevuld → opslaan (zelfde als op de site), bericht in het kanaal posten
    if (sub === "form") {
      const reden = arg;
      // deno-lint-ignore no-explicit-any
      const val = (id: string) => String((i.data?.components ?? []).flatMap((r: any) => r.components ?? []).find((c: any) => c.custom_id === id)?.value ?? "").trim();
      const van = parseDag(val("van")), tot = parseDag(val("tot"));
      const fout = (m: string) => json({ type: 7, data: { content: `⚠️ ${m}\nKlik opnieuw op **Afwezigheid melden** om het nog eens te proberen.`, components: [] } });
      if (!van || !tot) return fout("Ik begrijp de datum niet. Schrijf ze als dag/maand, bv. 24/11.");
      const { data: id, error } = await sb.rpc("fn_add_absence", { p_user_id: user.id, p_van: van, p_tot: tot, p_reden: reden, p_toelichting: val("toelichting") || null });
      if (error) {
        const code = Object.keys(AFW_FOUT).find((k) => error.message.includes(k));
        return fout(code ? AFW_FOUT[code] : "Er ging iets mis: " + error.message);
      }
      const { data: a } = await sb.from("absences").select("*").eq("id", id).maybeSingle();
      if (a && BOT_TOKEN && i.channel_id) {
        const msg = absenceMessage(a, discordId);
        const res = await discord(`/channels/${i.channel_id}/messages`, "POST", msg);
        const sent = res && res.ok ? await res.json() : null;
        if (sent) await sb.from("absence_discord").insert({ absence_id: a.id, channel_id: i.channel_id, message_id: sent.id, sig: absenceSig(msg) });
      }
      const nu = vandaag();
      return json({ type: 7, data: { components: [], content:
        `✅ Bedankt, ${user.name}! Je afwezigheid van **${datumBE(van)}** tot en met **${datumBE(tot)}** is gemeld en staat ook op de site.\n` +
        (van <= nu ? "Je krijgt binnen een paar minuten de rol **Afwezig**." : `Vanaf ${datumBE(van)} krijg je automatisch de rol **Afwezig**.`) +
        " Na de einddatum verdwijnt die vanzelf." } });
    }
    // 4. Boss keurt goed / af
    if (sub === "ok" || sub === "nee") {
      if (!user.perm_boss && !user.is_owner) return ephemeral("Enkel wie het Boss menu heeft, kan een afwezigheid goed- of afkeuren.");
      const status = sub === "ok" ? "goedgekeurd" : "afgekeurd";
      const { data: a, error } = await sb.from("absences")
        .update({ status, beoordeeld_door: `Boss (${user.name})`, beoordeeld_at: new Date().toISOString() })
        .eq("id", arg).select("*").maybeSingle();
      if (error || !a) return ephemeral("Deze afwezigheid bestaat niet meer.");
      const { data: wie } = await sb.from("users").select("discord_id").eq("id", a.user_id).maybeSingle();
      const msg = absenceMessage(a, wie?.discord_id ?? null);
      await sb.from("absence_discord").update({ sig: absenceSig(msg) }).eq("absence_id", a.id);
      return json({ type: 7, data: msg });   // het bericht zelf bijwerken
    }
    return ephemeral("Onbekende knop.");
  }

  // antwoord opslaan, het kanaalbericht (en eventueel de DM) bijwerken, en de bedanking teruggeven
  async function save(status: string, reden: string | null, how: "button" | "update", dmMessageId?: string) {
    const { error } = await sb.rpc("fn_set_rsvp", { p_event_id: eventId, p_user_id: user!.id, p_status: status, p_reden: reden });
    if (error) {
      const m = error.message.includes("EVENT_VOORBIJ") ? "Deze activiteit is al voorbij."
        : error.message.includes("REDEN_NODIG") ? "Kies een reden waarom je er niet bij bent."
        : error.message.includes("NIET_GEVONDEN") ? "Deze activiteit bestaat niet meer."
        : "Er ging iets mis: " + error.message;
      return how === "update" ? json({ type: 7, data: { content: m, components: [] } }) : ephemeral(m);
    }
    const { ev, rsvps, members } = await loadForEvent(eventId);
    const msg = ev ? buildMessage(ev, rsvps, members) : null;
    const { data: post } = await sb.from("agenda_discord").select("*").eq("event_id", eventId).maybeSingle();
    if (msg && post && BOT_TOKEN) await discord(`/channels/${post.channel_id}/messages/${post.message_id}`, "PATCH", msg);

    const s = RSVP.find((x) => x.id === status)!;
    const wat = `**${s.label.toLowerCase()}**${reden ? ` (${reden})` : ""}`;
    const thanks = `${s.emoji} Bedankt, ${user!.name}! Je antwoord ${wat}${ev ? ` voor **${ev.titel}**` : ""} is opgeslagen.\nVan gedacht veranderd? Klik gewoon op een andere knop.`;
    // afwezig via een DM: ook het herinneringsbericht zelf bijwerken
    if (msg && dmMessageId && BOT_TOKEN) await discord(`/channels/${i.channel_id}/messages/${dmMessageId}`, "PATCH", { content: thanks, ...msg });
    if (how === "update") return json({ type: 7, data: { content: thanks, components: [] } });   // de keuzelijst vervangen
    if (dm && msg) return json({ type: 7, data: { content: thanks, ...msg } });                    // het DM-bericht zelf
    return ephemeral(thanks);                                                                       // enkel zichtbaar voor wie klikte
  }

  // 1. knop
  if (kind === "rsvp") {
    if (arg === "misschien") return ephemeral("\"Misschien\" kan niet meer — kies ✅ Aanwezig of ❌ Afwezig.");
    if (!RSVP.some((s) => s.id === arg && !s.old)) return ephemeral("Onbekende knop.");
    if (arg !== "afwezig") return await save(arg, null, "button");
    // afwezig → eerst een reden kiezen (keuzelijst, enkel zichtbaar voor wie klikte)
    const ref = dm ? `:${i.message?.id ?? ""}` : "";
    return json({ type: 4, data: { flags: 64, content: "❌ Jammer! Waarom ben je er niet bij?", components: [{
      type: 1, components: [{ type: 3, custom_id: `reden:${eventId}${ref}`, placeholder: "Kies een reden…",
        options: REDENEN.map((r) => ({ label: r.label, value: r.id, emoji: { name: r.emoji } })) }],
    }] } });
  }

  // 2. reden gekozen in de keuzelijst
  if (kind === "reden") {
    const v = i.data?.values?.[0];
    if (v === "andere") {
      return json({ type: 9, data: { custom_id: `redentxt:${eventId}${arg ? `:${arg}` : ""}`, title: "Waarom ben je er niet bij?", components: [{
        type: 1, components: [{ type: 4, custom_id: "txt", label: "Reden", style: 1, min_length: 2, max_length: 120, required: true, placeholder: "bv. moet die avond werken" }],
      }] } });
    }
    const r = REDENEN.find((x) => x.id === v);
    if (!r) return json({ type: 7, data: { content: "Onbekende reden.", components: [] } });
    return await save("afwezig", r.label, "update", arg || undefined);
  }

  // 3. zelf getypte reden (venster)
  if (kind === "redentxt") {
    const txt = String(i.data?.components?.[0]?.components?.[0]?.value ?? "").trim().slice(0, 120);
    return await save("afwezig", txt || null, "update", arg || undefined);
  }

  return ephemeral("Onbekende knop.");
});
