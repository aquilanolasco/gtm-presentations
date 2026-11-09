/* Vision QA pass (Gamma mode): screenshot every slide of a built deck, let the model critique each
   against the brand rules, apply fixes to deck.json and re-render. Local bench tool; the live relay
   does not call this. Usage: node qa-pass.mjs --work <dir> [--title "..."] [--cover master]
   Expects <work>/deck (with deck.json) + <work>/assets. Rewrites deck in place. */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const RUI = process.env.EXPORT_DIR || path.join(os.homedir(), "presentation-agent", "export");
const { chromium } = createRequire(path.join(RUI, "package.json"))("playwright-core");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const WORK = arg("work"); const TITLE = arg("title", "Presentation"); const COVER = arg("cover", "master");
const KEY = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
let MODEL = process.env.GEN_MODEL || "claude-opus-4-8";
if (MODEL.includes("/")) MODEL = MODEL.split("/").pop();
MODEL = MODEL.replace(/(\d)\.(\d)/g, "$1-$2");
if (!WORK || !KEY) { console.error("need --work and ANTHROPIC_API_KEY"); process.exit(1); }
const deckDir = path.join(WORK, "deck");
const deckPath = path.join(deckDir, "deck.json");
const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));

function toAnthropic(messages) {
  let system = ""; const msgs = [];
  for (const m of messages) {
    if (m.role === "system") { system += (system ? "\n\n" : "") + (typeof m.content === "string" ? m.content : ""); continue; }
    let content;
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.content)) content = m.content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      if (part.type === "image_url") {
        const url = part.image_url?.url || ""; const mm = /^data:(image\/[a-z.+-]+);base64,(.*)$/i.exec(url);
        return mm ? { type: "image", source: { type: "base64", media_type: mm[1], data: mm[2] } } : { type: "image", source: { type: "url", url } };
      }
      return part;
    });
    else content = "";
    msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content });
  }
  return { system, messages: msgs };
}

async function call(messages) {
  const { system, messages: amsgs } = toAnthropic(messages);
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, ...(system ? { system } : {}), messages: amsgs }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`Anthropic ${res.status}`);
      const j = JSON.parse(raw);
      const c = Array.isArray(j?.content) ? j.content.filter((b) => b.type === "text").map((b) => b.text).join("") : "";
      if (!c) throw new Error("no content");
      if (j.usage) { QTOK.in += j.usage.input_tokens || 0; QTOK.out += j.usage.output_tokens || 0; }
      return c;
    } catch (e) { if (a === 3) throw e; await new Promise((r) => setTimeout(r, 1500 * a)); }
  }
}
const QTOK = { in: 0, out: 0 };
const grabJSON = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));

// serve the deck + screenshot each slide
async function shootAll(dir) {
  const MIME = { ".html": "text/html", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".json": "application/json" };
  const srv = createServer((rq, rs) => {
    let u = decodeURIComponent((rq.url || "/").split("?")[0]);
    let f = path.join(dir, u === "/" ? "index.html" : u);
    if (!fs.existsSync(f)) { rs.writeHead(404).end(); return; }
    rs.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await (await b.newContext({ viewport: { width: 1633, height: 1020 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1000);
  const shots = [];
  const n = await p.evaluate(() => document.querySelectorAll(".pp-slide").length);
  const outDir = path.join(WORK, "qa-shots"); fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < n; i++) {
    await p.evaluate((k) => { document.querySelectorAll(".pp-slide")[k].scrollIntoView(); }, i);
    await p.waitForTimeout(420);
    const f = path.join(outDir, `s${String(i + 1).padStart(2, "0")}.png`);
    await p.screenshot({ path: f });
    shots.push(f);
  }
  await b.close(); srv.close();
  return shots;
}

const V5 = process.env.GEN_V5 === "1";
const V5_CHECKS = !V5 ? "" : `
Additionally enforce these measurable rules (power-design):
- 3 to 5 visual chunks per slide, never more than 7 (a chunk = a card, a bullet, a stat, an image).
- At least ~40% of the slide should be whitespace; flag cramped slides.
- Nothing may touch or cross the slide edges (5% safe zone all around).
- ONE accent color per slide; flag slides fighting between multiple loud accents.
- Line length in paragraphs max ~60 characters; flag long unbroken lines.
- Contrast: body text must be clearly readable on its background (4.5:1); flag pale-on-pale or dark-on-dark.
- Headline and key visual must read FIRST; flag slides where decoration dominates the message.`;
const QA_SYS = `You are the design QA reviewer for Acme decks. You get ONE slide: its JSON spec and a SCREENSHOT of how it actually rendered. Judge the RENDER against these rules:
- Nothing cut off / overflowing the viewport; no text overlapping other elements; no empty broken zones.
- No wall of text: a bullets slide with 5+ long bullets and nothing else is a FAIL; prefer restructuring into a richer type (features cards, split, steps, kpi, table, columns) using the SAME content.
- No orphaned single words on their own line in headings; CTA pills must be one line.
- Brand: purple/blue gradient accents, white background (except section/cta), generous whitespace.
- Content must stay EXACTLY the same facts; you may restructure, never invent.
When restructuring, use EXACTLY these shapes (field names matter, wrong names render EMPTY):
 {"type":"bullets","title":string,"points":string[]}
 {"type":"split","title":string,"points":string[],"asideHeading":string,"asideText":string}
 {"type":"features","title":string,"cards":[{"heading":string,"text":string,"icon":"global|team|enterprise|ai|ops|growth|target|shield|spark|phone|chat|mail"}]}
 {"type":"steps","title":string,"steps":[{"heading":string,"text":string}]}
 {"type":"kpi","title":string,"stats":[{"value":string,"label":string}]}
 {"type":"table","title":string,"headers":string[],"rows":string[][]}
 {"type":"columns","title":string,"columns":[{"heading":string,"total":string,"items":[{"label":string}]}]}
 {"type":"chips","title":string,"items":string[]}
 {"type":"quote","quote":string,"author":string}
 {"type":"proof","quote":string,"author":string,"stats":[{"value":string,"label":string}]}
 {"type":"agenda","title":string,"items":string[]}
Reply ONLY JSON: {"ok":true} if the slide renders well, or {"ok":false,"reason":"...","fix":{<full corrected slide JSON>}}. The fix must be a complete slide object (same title unless broken). Never use em-dashes.${V5_CHECKS}`;

// reject fixes that would render empty (wrong/missing content fields)
const validFix = (f) => {
  if (!f || typeof f !== "object" || !f.type) return false;
  const has = (k, min = 1) => Array.isArray(f[k]) && f[k].length >= min;
  switch (f.type) {
    case "bullets": case "split": return has("points");
    case "features": return has("cards") && f.cards.every((c) => c && (c.heading || c.text));
    case "steps": return has("steps");
    case "kpi": return has("stats");
    case "table": return has("rows");
    case "columns": return has("columns");
    case "chips": case "agenda": return has("items");
    case "quote": return !!f.quote;
    case "proof": return !!f.quote || has("stats");
    default: return false;
  }
};

const b64 = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;

const shots = await shootAll(deckDir);
console.log(`QA: reviewing ${shots.length} slides…`);
let fixed = 0;
const results = [];
// review all slides in parallel batches of 4
for (let i = 0; i < deck.slides.length && i < shots.length; i += 4) {
  const batch = [];
  for (let k = i; k < Math.min(i + 4, deck.slides.length, shots.length); k++) {
    const slide = deck.slides[k];
    // only review content-density-risky types (walls of text, overflow, AI-authored HTML). Deterministic
    // visual templates (people, celebration, teamgrid, map, deals, awards, announcements, staffsat, quote,
    // proof, timeline, chips, showcase, image, cover, section, cta) are reliably fine, so skip them to cut cost.
    const RISKY = new Set(["bullets", "features", "focus", "split", "kpi", "metrics", "columns", "suppliers", "agenda", "steps", "mission", "textimage", "table", "novel", "servicemetrics"]);
    if (!RISKY.has(slide.type)) { results[k] = { ok: true }; continue; }
    batch.push((async () => {
      try {
        const out = grabJSON(await call([
          { role: "system", content: QA_SYS },
          { role: "user", content: [
            { type: "text", text: `Slide ${k + 1} JSON:\n${JSON.stringify(slide)}\n\nScreenshot below. Verdict?` },
            { type: "image_url", image_url: { url: b64(shots[k]) } },
          ] },
        ]));
        results[k] = out;
        if (out && out.ok === false && validFix(out.fix)) {
          deck.slides[k] = out.fix; fixed++;
          console.log(`QA: slide ${k + 1} fixed (${String(out.reason || "").slice(0, 90)})`);
        } else if (out && out.ok === false) {
          console.log(`QA: slide ${k + 1} flagged but fix invalid, kept original (${String(out.reason || "").slice(0, 70)})`);
        } else {
          console.log(`QA: slide ${k + 1} ok`);
        }
      } catch (e) { console.log(`QA: slide ${k + 1} review failed, kept (${String(e).slice(0, 60)})`); results[k] = { ok: true }; }
    })());
  }
  await Promise.all(batch);
}
fs.writeFileSync(path.join(WORK, "qa-report.json"), JSON.stringify(results, null, 1));
if (fixed) {
  console.log(`QA: re-rendering with ${fixed} fixed slide${fixed > 1 ? "s" : ""}…`);
  fs.writeFileSync(deckPath, JSON.stringify(deck, null, 1));
  const r = spawnSync("node", [path.join(__dir, "generate.mjs"), "--deckjson", deckPath, "--assets", path.join(WORK, "assets"), "--title", TITLE, "--out", deckDir, "--cover", COVER], { stdio: "inherit", env: process.env });
  if (r.status !== 0) { console.error("re-render failed"); process.exit(1); }
}
try {
  const tf = path.join(deckDir, "tokens.json");
  let prev = { in: 0, out: 0, calls: 0 };
  if (fs.existsSync(tf)) { try { prev = JSON.parse(fs.readFileSync(tf, "utf8")); } catch {} }
  fs.writeFileSync(tf, JSON.stringify({ in: prev.in + QTOK.in, out: prev.out + QTOK.out, calls: prev.calls || 0 }));
} catch {}
console.log(`@@LOG TOKENS qa in=${QTOK.in} out=${QTOK.out}`);
console.log(`QA DONE: ${fixed} slide(s) improved, report at ${path.join(WORK, "qa-report.json")}`);
