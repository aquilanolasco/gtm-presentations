// Writes the prospect-specific opening slides of an engagement sales deck with Claude.
// Input: what the scout read on the prospect's site + the rep's notes. Output: the `intro` part of the
// deck spec (see web-deck/app/engage/page.tsx), validated and scrubbed before it is rendered.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";

/* the slide library (a copy of web-deck components/library/library.json): what each master slide says,
   for the deck context a new slide is written against, and the ids a new slide may not take */
const LIB = JSON.parse(fs.readFileSync(new URL("./engage-library.json", import.meta.url), "utf8"));
const LIB_TITLE = {};
for (const d of LIB.decks) for (const s of d.slides) LIB_TITLE[s.sid] = [s.label, `${s.title} (${d.title})`];
const SHORT_PACK = LIB.decks.find((d) => d.id === "shortpack").slides.map((s) => s.sid);

const MODEL = process.env.ENGAGE_MODEL || "claude-opus-5-5";

// Only these Acme facts may appear on a generated slide. They are the Short Pack's own claims.
// sample copy (original content removed): replace each line with your own approved claims, keeping one fact per bullet.
const FACTS = `
ACME FACT SHEET (the only Acme claims you may use; quote them as written, never inflate):
- What Acme is: a purchasing platform for multi-site operators (sample fact).
- The modules, one login: Module A, Module B, Module C, Module D. Covers the main spend categories (sample fact).
- How the service runs: a named team sets up catalogues and suppliers with the customer (sample fact).
- Pricing benefit: a sample percentage saving on purchasing, stated as a range (sample fact).
- Invoices: a sample cost per invoice by hand versus on Acme, and a sample straight-through rate (sample fact).
- Budgets checked before the spend is committed; live stock figures; faster period close (sample fact).
- One sample property's yearly cost of manual handling (sample fact).
- Time to value: a sample payback period and a sample go-live time; a sample support score (sample fact).
- Proof: one short customer quote, attributed by role only (sample fact).
- Integrations commonly cited: POS, ERP and accounting systems; an API. Only mention an integration if the prospect's notes or site make it relevant.
- Multi-site groups get one shared product master, approvals by site or amount, role-based access (sample fact).
`;

const SYSTEM = `You write the prospect-specific OPENING slides of an Acme sales deck. The deck already contains the fixed Acme master slides (the cost of manual procurement, the modules, order-to-payment flow, today vs Acme, proof, go-live, closing). Your slides come first and must make the prospect feel the deck was written for them: their estate, their operation, their priorities, then why Acme fits.

VOICE
- Sentence fragments for headlines. Specifics over adjectives. Active voice, present tense. Audience-first, positive framing.
- Never use an em dash or en dash. Use a comma, a full stop, a colon or parentheses instead. No emojis. No "leverage", "synergy", "unlock", "world-class", "cutting-edge", "seamless".
- Spell the prospect's name exactly as their site does.
- Facts about the PROSPECT come only from the material provided (their site copy and the rep's notes). Never invent property counts, room counts, locations, revenues, people or awards. If a number is not in the material, do not state one. You may describe what is evident (e.g. "a regional group of mid-size hotels with restaurants and event space").
- Facts about ACME come only from the fact sheet.
- If the rep's notes contain commercial terms (discounts, term length, fees, pilot scope), put them on a "terms" slide. Otherwise do not produce a terms slide.
- If the rep's notes name competitors or an incumbent system, produce a "checklist" slide comparing Acme with them (Acme column first, every Acme cell 1; competitor cells 1 only where the capability is clearly standard for that product, otherwise 0). Otherwise do not produce a checklist slide.

OUTPUT: one JSON object, no prose, no markdown fences:
{
  "client": "exact prospect name",
  "short": "short form used mid-sentence, e.g. Example",
  "eyebrow": "4 to 6 word strap, e.g. Procurement strategy for a growing estate",
  "subtitle": "one sentence, 18 to 30 words, what this deck proposes for THIS prospect",
  "chips": ["Prepared for <client>", "<second chip, 3 to 6 words, their world or the scope>"],
  "intro": [
    { "type": "cards", "id": "strategy", "label": "The strategy", "eyebrow": "The strategy", "title": "headline with the gradient phrase in [[double brackets]]",
      "cards": [
        { "h": "<Client> operational profile", "items": ["3 or 4 bullets about their estate and operation, from the material"] },
        { "h": "Procurement opportunity", "items": ["3 bullets: where manual procurement is costing them, tied to their kind of operation, using fact-sheet numbers only"] },
        { "h": "Why Acme fits", "items": ["3 bullets matching their needs to modules / managed service / integrations"] }
      ],
      "rows": [
        { "k": "Core platform", "items": [ { "b": "bold lead", "t": " rest of the sentence." }, {..}, {..} ] },
        { "k": "Service commitments", "items": [ {..}, {..}, {..} ] }
      ] },
    { "type": "tints", "id": "value", "label": "<2 or 3 word nav label>", "eyebrow": "<eyebrow>", "title": "headline with [[gradient phrase]]",
      "cards": [ { "k": "small caps label", "h": "card heading", "p": "two sentences, 25 to 40 words" }, {..}, {..} ] },
    { "type": "terms", "id": "terms", "label": "Commercial terms", "eyebrow": "Commercial terms & agreement overview", "title": "...",
      "cards": [ { "k": "label", "big": "15% off", "h": "heading", "p": "one sentence", "items": ["2 or 3 bullets"] }, {..} ] },
    { "type": "checklist", "id": "checklist", "label": "Feature checklist", "eyebrow": "Platform feature checklist", "title": "...",
      "columns": ["Competitor A", "Competitor B"], "rows": [ { "label": "capability", "cells": [1, 1, 0] } ], "note": "one line caveat" }
  ]
}
RULES FOR THE JSON
- "intro" always contains the "cards" slide first and the "tints" slide second. Add "terms" and/or "checklist" only when the notes justify them, in that order.
- Every title contains exactly one [[gradient phrase]] of 2 to 4 words. Titles are 5 to 10 words in total.
- Bullets are 6 to 14 words. Card paragraphs 25 to 40 words. Rows: each "t" starts with a space and finishes the sentence begun by "b".
- The tints slide is about value for THEIR properties or operation (e.g. supplier access, purchasing power, procurement technology; or F&B cost control if food and beverage leads their business).
- ids must be lowercase letters only and must not be any of: cover, cost, modules, flow, compare, proof, golive, close.
- Use the prospect's own terms (hotels, pubs, venues, residences, clubs, restaurants) rather than generic "properties" where the material shows them.`;

export function scrub(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/\s*[—–]\s*/g, ", ")                  // em / en dash
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")  // emoji
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}
function deepScrub(v) {
  if (Array.isArray(v)) return v.map(deepScrub);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = deepScrub(v[k]); return o; }
  return scrub(v);
}

const RESERVED = new Set(["cover", "close", ...Object.keys(LIB_TITLE)]);
const str = (v, max = 400) => (typeof v === "string" ? scrub(v).slice(0, max) : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const oneGrad = (t, fallback) => {
  let s = str(t, 140);
  const n = (s.match(/\[\[/g) || []).length;
  if (n === 0) { const words = s.split(" "); if (words.length >= 3) { const tail = words.splice(-2).join(" "); s = `${words.join(" ")} [[${tail}]]`; } }
  if (n > 1) { let first = true; s = s.replace(/\[\[(.+?)\]\]/g, (m, g) => { if (first) { first = false; return m; } return g; }); }
  return s || fallback;
};

// Shape-check the model's JSON into exactly what the template renders. Drops anything malformed.
export function validateSpec(raw, client) {
  const out = {
    client: str(raw.client, 80) || client,
    short: str(raw.short, 40) || str(raw.client, 40) || client,
    eyebrow: str(raw.eyebrow, 80) || "Partnership proposal",
    subtitle: str(raw.subtitle, 320) || `A proposal for ${client}, run from one platform.`,
    chips: arr(raw.chips).map((c) => str(c, 70)).filter(Boolean).slice(0, 3),
    intro: [],
  };
  if (!out.chips.length) out.chips = [`Prepared for ${out.client}`, "Sample scope chip"];
  const used = new Set();
  for (const s of arr(raw.intro)) {
    if (!s || typeof s !== "object") continue;
    let id = String(s.id || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 24) || s.type;
    if (RESERVED.has(id) || used.has(id)) id = id + "x";
    const base = { id, label: str(s.label, 28) || "Intro", eyebrow: str(s.eyebrow, 80), title: oneGrad(s.title, `For [[${out.short}]]`) };
    if (s.type === "cards") {
      const cards = arr(s.cards).map((c) => ({ h: str(c.h, 70), items: arr(c.items).map((i) => str(i, 140)).filter(Boolean).slice(0, 5) })).filter((c) => c.h && c.items.length).slice(0, 4);
      if (cards.length < 2) continue;
      const rows = arr(s.rows).map((r) => ({ k: str(r.k, 40), items: arr(r.items).map((i) => ({ b: str(i.b, 50), t: str(i.t, 120) })).filter((i) => i.b).slice(0, 4) })).filter((r) => r.k && r.items.length).slice(0, 2);
      out.intro.push({ type: "cards", ...base, cards, rows });
    } else if (s.type === "tints") {
      const cards = arr(s.cards).map((c) => ({ k: str(c.k, 40), h: str(c.h, 70), p: str(c.p, 320) })).filter((c) => c.h && c.p).slice(0, 4);
      if (cards.length < 2) continue;
      out.intro.push({ type: "tints", ...base, cards });
    } else if (s.type === "terms") {
      const cards = arr(s.cards).map((c) => ({ k: str(c.k, 40), big: str(c.big, 16), h: str(c.h, 70), p: str(c.p, 260), items: arr(c.items).map((i) => str(i, 120)).filter(Boolean).slice(0, 4) })).filter((c) => c.big && c.h).slice(0, 3);
      if (!cards.length) continue;
      out.intro.push({ type: "terms", ...base, cards });
    } else if (s.type === "checklist") {
      const columns = arr(s.columns).map((c) => str(c, 24)).filter(Boolean).slice(0, 4);
      const rows = arr(s.rows).map((r) => ({ label: str(r.label, 70), cells: [1, ...columns.map((_, i) => (arr(r.cells)[i + 1] ? 1 : 0))] })).filter((r) => r.label).slice(0, 8);
      if (!columns.length || rows.length < 3) continue;
      out.intro.push({ type: "checklist", ...base, columns, rows, note: str(s.note, 200) });
    } else continue;
    used.add(id);
  }
  if (!out.intro.length) throw new Error("the writer returned no usable intro slides");
  return deepScrub(out);
}

export function buildBrief(scout, brief) {
  const parts = [];
  parts.push(`PROSPECT WEBSITE: ${scout.url || brief.url}`);
  parts.push(`NAME ON SITE: ${brief.client || scout.name}`);
  if (scout.description) parts.push(`SITE DESCRIPTION: ${scout.description}`);
  if (scout.text) parts.push(`HOME PAGE COPY:\n${scout.text.slice(0, 7000)}`);
  for (const p of (scout.pages || []).slice(0, 3)) if (p.text) parts.push(`PAGE ${p.url}${p.title ? ` (${p.title})` : ""}:\n${p.text.slice(0, 3500)}`);
  parts.push(`REP'S NOTES (highest authority; may include commercial terms, competitors, priorities, people met):\n${brief.notes && brief.notes.trim() ? brief.notes.trim() : "(none)"}`);
  parts.push(`PRESENTED BY: ${brief.presenter?.name || "an Acme commercial director"}${brief.presenter?.title ? `, ${brief.presenter.title}` : ""}.`);
  parts.push(`Write the JSON now.`);
  return parts.join("\n\n");
}

export async function writeIntro(scout, brief, { log = () => {} } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: key });
  const user = buildBrief(scout, brief);
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`Writing the opening slides with ${MODEL}${attempt > 1 ? " (retry)" : ""}…`);
    const res = await client.messages.create({
      model: MODEL, max_tokens: 4500,
      system: SYSTEM + "\n" + FACTS,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    try {
      if (!m) throw new Error("no JSON in reply");
      const spec = validateSpec(JSON.parse(m[0]), brief.client || scout.name);
      spec.usage = { model: MODEL, input: res.usage?.input_tokens, output: res.usage?.output_tokens };
      return spec;
    } catch (e) { lastErr = e; log(`Writer output was not valid (${String(e).slice(0, 80)})`); }
  }
  throw lastErr || new Error("writer failed");
}

/* ───────────────────────────── Slide Editor: one extra slide ─────────────────────────────
   The rep presses + in the deck's left list, says what the slide should carry (and / or attaches a
   document), and the worker writes ONE slide inside the template's own slide types, renders it, checks
   the screenshot, and rewrites it when the check finds a problem. */
const VOICE = `VOICE
- Sentence fragments for headlines. Specifics over adjectives. Active voice, present tense. Audience-first, positive framing.
- Never use an em dash or en dash. Use a comma, a full stop, a colon or parentheses instead. No emojis. No "leverage", "synergy", "unlock", "world-class", "cutting-edge", "seamless".
- Facts about the PROSPECT come only from the material provided (the deck's own slides, the rep's request, the attached document). Never invent property counts, room counts, locations, revenues, people or awards. If a number is not in the material, do not state one.
- Facts about ACME come only from the fact sheet.`;

const SLIDE_SYSTEM = `You write ONE additional slide for an existing Acme sales deck. The deck's other slides are already written and designed; yours must read like one of them and fit on one screen.

${VOICE}

SLIDE TYPES (pick the one that carries the content best; these are the JSON shapes):
1. "cards": 2 to 4 cards, each a heading and 3 or 4 bullets of 6 to 14 words. Optional "rows" (2 at most) of 3 short bold-lead items. Best for a profile, areas side by side, a plan in parallel streams.
   { "type": "cards", "label": "...", "eyebrow": "...", "title": "...", "cards": [ { "h": "...", "items": ["...", "...", "..."] } ], "rows": [ { "k": "...", "items": [ { "b": "bold lead", "t": " rest of the sentence." } ] } ] }
2. "tints": 2 to 4 tinted cards, each a small label, a heading and a paragraph of 25 to 40 words. Best for value themes, benefits, a story in three beats.
   { "type": "tints", "label": "...", "eyebrow": "...", "title": "...", "cards": [ { "k": "label", "h": "...", "p": "..." } ] }
3. "terms": 2 or 3 cards led by a big figure. Best for commercial terms, the numbers that matter, milestones.
   { "type": "terms", "label": "...", "eyebrow": "...", "title": "...", "cards": [ { "k": "label", "big": "45 days", "h": "...", "p": "one sentence", "items": ["2 or 3 bullets"] } ] }
4. "checklist": a capability table with Acme first. Best for a comparison with named competitors or an incumbent system.
   { "type": "checklist", "label": "...", "eyebrow": "...", "title": "...", "columns": ["Competitor"], "rows": [ { "label": "capability", "cells": [1, 0] } ], "note": "one line" }

RULES
- "label" is the slide's name in the deck's left menu: 1 to 3 words, 24 characters at most, not a name already used in the deck.
- "eyebrow": 3 to 7 words. "title": 5 to 10 words with exactly one [[gradient phrase]] of 2 to 4 words in double brackets.
- Less is more. The slide must fit one screen: when in doubt, three cards with three bullets each.
- Output one JSON object, no prose, no markdown fences.`;

const CHECK_SYSTEM = `You check one slide of an Acme sales deck before it is shown to a prospect. Report only real layout problems: text cut off or running outside its card or the slide; elements overlapping; text so small it is hard to read at a glance; one card carrying far more text than its neighbours; an empty or lopsided slide; a single orphan word alone on the last line of the title; anything that looks broken. Style preferences are not problems. Reply with one JSON object only: {"ok": true, "issues": []} or {"ok": false, "issues": ["short, specific problem", "..."]}.`;

/* One slide, shape-checked into exactly what the template renders (the same limits as validateSpec). */
export function validateSlide(raw, short, used = new Set()) {
  if (!raw || typeof raw !== "object") throw new Error("the writer returned no slide");
  const s = raw;
  const base = { label: str(s.label, 24) || "New slide", eyebrow: str(s.eyebrow, 80), title: oneGrad(s.title, `For [[${short}]]`) };
  if (used.has(base.label.toLowerCase())) base.label = str(base.label.slice(0, 21), 21) + " 2";
  let out;
  if (s.type === "cards") {
    const cards = arr(s.cards).map((c) => ({ h: str(c.h, 70), items: arr(c.items).map((i) => str(i, 140)).filter(Boolean).slice(0, 4) })).filter((c) => c.h && c.items.length).slice(0, 4);
    if (cards.length < 2) throw new Error("a cards slide needs at least two cards");
    const rows = arr(s.rows).map((r) => ({ k: str(r.k, 40), items: arr(r.items).map((i) => ({ b: str(i.b, 50), t: str(i.t, 120) })).filter((i) => i.b).slice(0, 4) })).filter((r) => r.k && r.items.length).slice(0, 2);
    out = { type: "cards", ...base, cards, rows };
  } else if (s.type === "tints") {
    const cards = arr(s.cards).map((c) => ({ k: str(c.k, 40), h: str(c.h, 70), p: str(c.p, 320) })).filter((c) => c.h && c.p).slice(0, 4);
    if (cards.length < 2) throw new Error("a tints slide needs at least two cards");
    out = { type: "tints", ...base, cards };
  } else if (s.type === "terms") {
    const cards = arr(s.cards).map((c) => ({ k: str(c.k, 40), big: str(c.big, 16), h: str(c.h, 70), p: str(c.p, 260), items: arr(c.items).map((i) => str(i, 120)).filter(Boolean).slice(0, 4) })).filter((c) => c.big && c.h).slice(0, 3);
    if (!cards.length) throw new Error("a terms slide needs a card with a figure");
    out = { type: "terms", ...base, cards };
  } else if (s.type === "checklist") {
    const columns = arr(s.columns).map((c) => str(c, 24)).filter(Boolean).slice(0, 4);
    const rows = arr(s.rows).map((r) => ({ label: str(r.label, 70), cells: [1, ...columns.map((_, i) => (arr(r.cells)[i + 1] ? 1 : 0))] })).filter((r) => r.label).slice(0, 8);
    if (!columns.length || rows.length < 3) throw new Error("a checklist needs a column and three rows");
    out = { type: "checklist", ...base, columns, rows, note: str(s.note, 200) };
  } else throw new Error(`unknown slide type ${String(s.type).slice(0, 20)}`);
  return deepScrub(out);
}

function deckContext(spec, afterLabel) {
  const seq = [["Overview", `Acme & ${spec.client}: ${spec.subtitle || ""}`]];
  for (const s of spec.intro || []) seq.push([s.label, s.title]);
  for (const x of spec.extra || []) seq.push([x.slide.label, x.slide.title]);
  for (const b of (Array.isArray(spec.body) && spec.body.length ? spec.body : SHORT_PACK)) {
    const t = LIB_TITLE[String(b).split("~")[0]]; // "<sid>~<savedId>" = a Saved slide, named by the rep
    if (t) seq.push([(spec.bodyLabels && spec.bodyLabels[b]) || t[0], t[1]]);
  }
  seq.push(["Get in touch", "closing page"]);
  return `DECK: Acme & ${spec.client} (short form: ${spec.short || spec.client}). Slides in order:\n${seq.map(([l, t]) => `- ${l}: ${String(t).replace(/\[\[|\]\]/g, "")}`).join("\n")}\n\nTHE NEW SLIDE GOES AFTER: "${afterLabel}".`;
}

/* Write (or, with `previous` + `issues`, rewrite) one slide. `material` is { text } or { image: { data, media_type } }. */
export async function writeSlide({ spec, afterLabel, prompt, material, previous, issues, log = () => {} }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: key });
  const used = new Set([...(spec.intro || []).map((s) => s.label), ...(spec.extra || []).map((x) => x.slide.label)].map((l) => String(l).toLowerCase()));
  if (previous && previous.label) used.delete(String(previous.label).toLowerCase()); // a rewrite may keep its own name
  const content = [];
  let text = deckContext(spec, afterLabel) + "\n\n";
  text += `WHAT THE REP WANTS ON THE SLIDE: ${prompt && prompt.trim() ? prompt.trim() : "(whatever the attached material says; summarise it as one slide)"}\n\n`;
  if (material && material.text) text += `ATTACHED MATERIAL${material.name ? ` (${material.name})` : ""}:\n${material.text.slice(0, 14000)}\n\n`;
  if (previous && issues && issues.length) {
    text += `PREVIOUS VERSION OF THE SLIDE (JSON):\n${JSON.stringify(previous)}\n\nPROBLEMS FOUND WHEN IT WAS RENDERED ON SCREEN:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nRewrite the slide so these problems disappear: shorter sentences, fewer bullets, or one card less. Keep the same type unless another fits better. Output the full JSON.\n`;
  } else text += "Write the JSON now.";
  if (material && material.image) content.push({ type: "image", source: { type: "base64", media_type: material.image.media_type, data: material.image.data } });
  content.push({ type: "text", text });
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`${previous ? "Rewriting" : "Writing"} the slide with ${MODEL}${attempt > 1 ? " (retry)" : ""}…`);
    const res = await client.messages.create({ model: MODEL, max_tokens: 2500, system: SLIDE_SYSTEM + "\n" + FACTS, messages: [{ role: "user", content }] });
    const reply = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const m = reply.match(/\{[\s\S]*\}/);
    try {
      if (!m) throw new Error("no JSON in reply");
      const slide = validateSlide(JSON.parse(m[0]), spec.short || spec.client, used);
      return slide;
    } catch (e) { lastErr = e; log(`Writer output was not valid (${String(e).slice(0, 80)})`); }
  }
  throw lastErr || new Error("writer failed");
}

/* Claude looks at the rendered slide (PNG) and says whether anything is broken. Never blocks on its own failure. */
export async function checkSlide({ png, slide, log = () => {} }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: true, issues: [] };
  try {
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(png).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: MODEL, max_tokens: 500, system: CHECK_SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.toString("base64") } },
        { type: "text", text: `This is the slide as it renders. Its content, for reference: ${JSON.stringify(slide).slice(0, 3000)}\nIs it ready to show?` },
      ] }],
    });
    const reply = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return { ok: true, issues: [] };
    const j = JSON.parse(m[0]);
    return { ok: j.ok !== false, issues: Array.isArray(j.issues) ? j.issues.map((x) => scrub(String(x)).slice(0, 160)).filter(Boolean).slice(0, 6) : [] };
  } catch (e) { log(`Visual check skipped: ${String(e).slice(0, 80)}`); return { ok: true, issues: [] }; }
}
