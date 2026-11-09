/* Generate an Acme-branded deck from ingested content.
   AI (Claude, Anthropic API) structures the extracted content into a validated slide array;
   a DETERMINISTIC renderer turns it into a self-contained branded HTML deck (so the output
   can never be "broken" — the model only emits structured JSON, never HTML). Images and
   hyperlinks from the source are carried through.
   Usage: node generate.mjs --ingest ing.json --assets <dir> --title "..." --out <deckDir> */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const ING = arg("ingest"), ASSETS = arg("assets"), TITLE = arg("title", "Presentation"), OUT = arg("out");
// "master" = the real intro-deck cover (3D emblem + headline), locked in as the default.
const COVER = ["gradient", "light", "dark", "master", "device", "hybrid"].includes(arg("cover")) ? arg("cover") : "device";
const BRAND = process.env.BRAND_ASSETS_DIR || path.join(os.homedir(), "presentation-agent", "web-deck", "public");
// short brand line shown as the eyebrow on cover / CTA slides
const TAGLINE = process.env.BRAND_TAGLINE || "Acme platform";
const INGEST_PY = process.env.INGEST_PY || "python3";
const SLUG = arg("slug", "");
// Direct Anthropic (Claude) API.
const KEY = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
// Normalise a prefixed id ("anthropic/claude-opus-4.8") to an Anthropic id ("claude-opus-4-8").
let MODEL = process.env.CREATE_MODEL || "claude-opus-4-8";
if (MODEL.includes("/")) MODEL = MODEL.split("/").pop();
MODEL = MODEL.replace(/(\d)\.(\d)/g, "$1-$2");

const RENDER_ONLY = process.argv.includes("--deckjson") || process.argv.includes("--editdeck");
const ingest = RENDER_ONLY ? { pages: [] } : JSON.parse(fs.readFileSync(ING, "utf8"));
// compact the content for the model (cap text length per page). Few-page sources (a pasted note,
// a transcript, a docx) get a much larger cap so nothing is lost; multi-page PDFs stay capped per page.
const perCap = ingest.pages.length <= 2 ? 24000 : 2600;
// drop tiny icons/bullets/decorations so the model only sees real, usable images (and to save tokens).
// keep w/h so the model can tell a portrait PHOTO (headshot) from a wide LOGO strip.
const usableImg = (im) => Math.min(im.w || 0, im.h || 0) >= 110;
const brief = ingest.pages.map((p) => ({
  page: p.index + 1,
  text: (p.text || "").slice(0, perCap),
  images: (p.images || []).filter(usableImg).slice(0, 8).map((im) => ({ file: im.file, w: im.w, h: im.h, x: im.x, y: im.y, fullpage: im.fullpage })),
  links: p.links,
  page_image: p.page_image,
  page_clean: p.page_clean,
}));
// read the rendered page images as data URLs for vision (bounded so the request stays sane)
const VISION = process.env.CREATE_VISION !== "0";
const pageImg = (p) => {
  if (!VISION || !p.page_image) return null;
  try { return `data:image/jpeg;base64,${fs.readFileSync(path.join(ASSETS, p.page_image)).toString("base64")}`; } catch { return null; }
};

const SYS = `You are the presentation designer for Acme (a B2B software company; replace with your one-line company description).
Your job: take the SOURCE deck and REBRAND it into Acme's style, keeping it faithful. This is a rebrand,
not a redesign: reproduce each source slide's content and layout, but in our colours and style. The body of a
slide should follow the SOURCE slide, it does NOT need to look like our master product decks. The global frame
(left nav, side rail, logo) is added automatically, so you never build chrome. Above all: KEEP THE CONTENT
ACCURATE, do not drop or change facts, names, numbers, or the order of slides. Output ONLY: {"title": string, "slides": Slide[]}

You are shown, for each source page, its extracted text, its image files, its links, AND a PICTURE of the page.
In the picture, every extracted image is OUTLINED and LABELLED with its filename (e.g. "img026") in small red
text at its top-left corner. To use an image, READ the label printed on the thing you want in the picture and use
that exact filename. So to put a person's real face on a slide, find their photo in the picture, read the label on
it, and use that file. Use the picture to: reproduce the layout, read text baked into graphics (e.g. a person's
NAME printed on their photo, which is NOT in the extracted text), and pick the correct image files by their labels.
The extracted text is ground truth for wording; the page picture is ground truth for layout, labels, and baked-in text.

Choose the layout that best fits each idea (this is what makes it look designed, not a text dump):
 {"type":"cover","title":string,"subtitle"?:string}                                  // opening slide ONLY
 {"type":"section","label"?:string,"title":string}                                   // topic divider: one big line
 {"type":"agenda","title":string,"items":string[]}                                   // what's ahead (3-6 items)
 {"type":"bullets","title":string,"points":string[]}                                 // a short list (3-6 points)
 {"type":"kpi","title":string,"stats":[{"value":string,"label":string}]}             // 2-4 headline numbers / results
 Any content slide may add "theme":"dark" for a deep-navy slide (use on 2-4 per deck for rhythm: quotes, key metrics, pivotal statements).
 {"type":"metrics","title":string,"stats":[{"value":string,"label":string,"sub"?:string,"icon"?:string}],"chart"?:{"name"?:string,"series":number[],"target"?:number,"labels":string[]}}  // metric highlight cards + a line chart under them (use for KPI-vs-target trends, e.g. NPS over months)
 {"type":"focus","title":string,"items":string[],"subheading"?:string,"lead"?:string,"points":string[],"table":{"rows":string[][]}}  // focus-areas composite: tick items across the top, subheading + dotted timeline of priorities left, a tinted priority table right
 {"type":"textimage","title":string,"points":string[],"image":string}                 // text left + one large framed image right (with hover zoom loupe)
 {"type":"servicemetrics","title":string,"speedHeading"?:string,"channels":[{"label":string,"value":string,"unit"?:string,"kpi"?:string,"icon"?:string,"up"?:boolean}],"resolution":{"label":string,"value":string,"kpi":string,"pct":number},"csat":{"value":string,"label":string},"verbatims":[{"text":string,"stars"?:number}]}  // service KPI dashboard: channel speed cards + resolution bar left, CSAT + customer verbatims right
 {"type":"deals","title":string,"items":string[],"image"?:string}                     // wins/deals: up to 5 pin callouts around a central illustration
 {"type":"suppliers","title":string,"groups":[{"heading":string,"items":string[]}],"image"?:string}  // regional panels of names + an illustration
 {"type":"announcements","title":string,"items":string[]}                             // hub-and-spoke: 6 announcement boxes around a centre megaphone
 {"type":"staffsat","title":string,"heading"?:string,"lines":string[],"images"?:string[]}  // one wide highlight card: heading + stat lines left, a circle cluster of real staff photos right
 {"type":"bento","title":string,"hero":{"value"?:string,"heading":string,"text":string},"cards":[{"value"?:string,"heading":string,"text":string}]}  // ONE big point + 2-3 supporting cards
 {"type":"steps","title":string,"steps":[{"heading":string,"text":string}]}          // a process / how it works (3-4)
 {"type":"features","title":string,"cards":[{"heading":string,"text":string}]}       // capabilities / offerings (2-4)
 {"type":"split","title":string,"points":string[],"asideHeading"?:string,"asideText"?:string}  // a claim + points, with a highlighted aside card
 {"type":"proof","quote":string,"author"?:string,"stats"?:[{"value":string,"label":string}]}   // testimonial / result, optional 1-2 stats
 {"type":"quote","quote":string,"author"?:string}                                    // one strong statement
 {"type":"chips","title":string,"items":string[]}                                    // a set of short labels / tags
 {"type":"showcase","title":string,"points"?:string[],"text"?:string,"screen":string} // text left + a REAL Acme app screenshot in a device panel, right
 {"type":"image","title"?:string,"image":string,"caption"?:string}                   // a source image (use given filename)
 {"type":"people","title":string,"people":[{"name":string,"role":string,"note"?:string,"image"?:string,"facebox"?:[number,number,number,number]}],"videoUrl"?:string}  // team / leadership grid (use PORTRAIT source photos, one per person, in order). If a person's photo is baked into the page picture (no separate file), give their "facebox":[x,y,w,h] percent bounding box and we crop it. If the SAME page also has a video, put its url in videoUrl (keep it ONE slide, do NOT make a separate video slide)
 {"type":"celebration","name":string,"role"?:string,"message"?:string,"image"?:string,"facebox"?:[number,number,number,number],"eyebrow"?:string}  // a promotion, award, new starter or individual recognition (town-hall staple): ONE person. name + short message. If the page has a SEPARATE labelled photo file of the person, set image to it. If the person's photo is baked into the page picture (no separate file), instead give "facebox":[x,y,w,h] = the photo's bounding box as PERCENT of the page (x,y = top-left corner, w,h = width/height); we crop it for you. Prefer facebox when there is no separate photo file.
 {"type":"vision","title":string,"subtitle"?:string,"points":[{"heading":string,"text"?:string,"icon"?:string}]}  // a vision / strategy / pillars slide: brand target in the centre, 3-6 points flanking with icons. icon is one of: global, team, enterprise, ai, ops, growth, target, shield, spark
 {"type":"mission","title"?:string,"eyebrow"?:string,"statement":string,"cards":[{"heading":string,"text"?:string,"icon"?:string}]}  // a mission / purpose / "who we are" slide: ONE dominant statement in a hero card + 2-4 supporting icon cards. icon keys as for vision
 {"type":"awards","title":string,"subtitle"?:string,"items":[{"name":string,"note"?:string,"by"?:string}]}  // recognition / peak-performance / shout-outs: a celebratory grid of nominees (name, reason, who nominated them)
 {"type":"teamgrid","title":string,"people":[{"name":string,"role"?:string,"image"?:string,"facebox"?:[number,number,number,number]}]}  // a department / product / service team: grid of members, each name + role + round photo. If a member's photo is baked into the page picture (no separate file), give their "facebox":[x,y,w,h] percent bounding box and we crop their headshot for you.
 {"type":"video","title"?:string,"url":string,"caption"?:string}                     // a page whose main content IS a Vimeo/YouTube video (use the exact url from the page's links)
 {"type":"timeline","title":string,"events":[{"year"?:string,"label":string,"note"?:string}]}  // a journey / milestones along a line (up to ~7)
 // ── DIAGRAM types (use these to REBUILD source diagrams in clean HTML, never as a flat image): ──
 {"type":"hub","title":string,"center":{"label"?:string},"nodes":[{"label":string,"note"?:string}]}  // a HUB-AND-SPOKE / radial diagram: one centre (Acme) with 4-12 things around it — a tech/integration stack, a set of product modules, or many items mapping to one. center.label defaults to Acme.
 {"type":"flow","title":string,"stages":[{"heading"?:string,"items":string[]}],"note"?:string}  // a left-to-right PROCESS / PIPELINE of 2-5 stages joined by arrows (e.g. suppliers -> processing -> buyers). Each stage is a titled box of items.
 {"type":"ring","title":string,"groups":[{"heading"?:string,"items":(string|{"label":string,"color"?:string})[]}]}  // a CONSTELLATION of labelled colour circles in 1-2 rows (e.g. 5 focus areas over 4 "already in place"). Give the second/"in place" group items a soft blue color "#a9c7ff".
 {"type":"venn","title":string,"left":{"heading":string,"items":string[]},"right":{"heading":string,"items":string[]},"overlap"?:{"heading"?:string,"items":string[]}}  // TWO overlapping circles (e.g. our responsibilities vs theirs) with a shared middle. Keep each list to <=6 short items.
 {"type":"gantt","title":string,"monthCount"?:number,"months"?:string[],"rows":[{"label":string,"bars":[{"start":number,"span":number,"text"?:string}]}]}  // a GANTT / schedule: workstream rows across months. start=first month (1-based), span=number of months. Use monthCount for a plain 1..N axis.
 {"type":"roadmap","title":string,"stages":[{"n"?:number,"heading":string,"text"?:string}],"themes"?:{"heading"?:string,"items":string[]}}  // a ROADMAP / staged journey: numbered stages along a path, plus an optional side "what matters" themes card.
 {"type":"map","title":string,"legendTitle"?:string,"legendTitleB"?:string,"markers":[{"place":string,"label":string,"kind":"a"|"b"}]}  // pins on an auto-zooming map. place = a CITY or region key: phuket, bangkok, rayong, singapore, bali, adelaide, melbourne, sydney, brisbane, perth, auckland, fiji, hong-kong, tokyo, london, new-york, dubai, or a region (australia, asia, uk, europe, north-america, pacific). label = the site/deal name. kind "a"=first group (e.g. customers), "b"=second (e.g. partners)
 {"type":"columns","title":string,"columns":[{"heading":string,"total"?:string,"items":[{"label":string,"note"?:string}]}]}  // 2-3 comparison lists side by side (e.g. Current vs Proposed)
 {"type":"table","title":string,"headers":string[],"rows":string[][]}                // a data table (pricing, specs, tiers). Use for any tabular / grid-of-values source slide
 {"type":"cta","title":string,"subtitle"?:string,"chips"?:string[]}                  // closing slide

"screen" (for showcase) is one of the real product screens, pick the closest to the content:
  "home" (dashboard overview), "invoices" (billing), "purchase-orders" (ordering),
  "catalog" (product catalog / pricing), "inventory" (stock), "budgets" (budgeting/financials),
  "suppliers" (vendor management), "reports" (reporting/analytics).

You are the Acme deck designer. You KNOW the master templates (intro deck, sales deck, short pack):
they open with a branded cover, use section dividers between topics, lead with big numbers (kpi/bento),
show the PRODUCT with real app screenshots (showcase), prove value (proof), and close with a CTA.

Each image is given as {file, w, h, x, y} where x,y is its centre on the page in percent. ALWAYS pick images by
matching x,y to what you SEE in the page picture, never by guessing from the filename or aspect ratio. A real
PHOTOGRAPH of a person can be square or portrait, and is usually one of the LARGER images (>=200px). Very wide
short images (e.g. 269x96) are logos, skip them.
On a "people" slide: in the page picture, find each person's real photo (their face), which sits right next to
their name/role text. Read the filename LABEL printed on that photo and use it. IGNORE small cartoon/illustrated
figures or repeated decorative characters (often a band across the top or side of the page), they are graphics,
NOT the people. Read each person's NAME from the page picture (it is often printed on the photo and missing from
the extracted text). Use the labelled filenames verbatim.

Design rules (this is a REBRAND, keep it simple and robust):
- ONE SOURCE PAGE = ONE SLIDE. Output EXACTLY one slide per source page, in the SAME order. Do NOT add slides
  (no extra section dividers, no title cards), do NOT split one page into two, do NOT merge two pages into one.
  The slide count MUST equal the number of source pages. A page that is itself a section divider becomes a
  "section" slide; a page with a team AND a video becomes ONE "people" slide with videoUrl set.
- EVERY slide MUST have a non-empty "title" taken from that page's heading (or a 2-4 word summary if the page has
  no heading). Never output a slide with no title.
- Pick the closest TEMPLATE for each page: a promotion / award / new starter / individual recognition -> celebration
  (one person, ALWAYS attach their photo by reading the label off the page picture, do NOT flatten it into bullets);
  a vision / strategy / pillars page -> vision (give each point an icon key); a mission / purpose / "who we are"
  page -> mission (one dominant statement + icon cards); a recognition / peak-performance / shout-outs page ->
  awards; a department / product / service team page -> teamgrid (attach each member's photo from the page picture);
  a small leadership group -> people; a video page -> video; a journey/dates -> timeline;
  a slide about deals / wins / expansions / new sites / customers tied to specific CITIES or venues (e.g. new sites in Singapore and Melbourne, partners in London) -> map (one marker per place, put the CITY in "place" and the venue/deal name in "label"); counts by region with no cities -> map or table; two lists compared -> columns; a data/pricing table -> table; numbers/results ->
  kpi or bento; a process/phases -> steps; capabilities -> features; a claim + points -> split; a short list ->
  bullets; a testimonial -> proof; tags -> chips; an Acme product screen with no source image -> showcase.
- If a page's layout does NOT match any template (a bespoke diagram, flowchart, or infographic), DO NOT try to
  redraw it. Just rebrand it simply: use "bullets" (or "split"/"table") to carry its title and key text on-brand.
  A clean, simple branded slide is REQUIRED, a broken custom diagram is NOT acceptable. Never invent connectors,
  arrows, or absolutely-positioned boxes.
- USE THE SOURCE'S OWN PHOTOS (read the filename labels off the page picture). Carry meaningful links as [label](url).
- KEEP EACH SLIDE LIGHT: short fragments, not sentences. Keep the content ACCURATE, never invent facts/names/numbers.
- NEVER use em-dashes or en-dashes (— or –); use a comma, period, or parentheses.
Output ONLY the JSON object.`;

// AUTHORING prompt: when the source is prose / notes / a transcript / a short doc (<=2 pages) there is NO
// existing deck to rebrand, so "one page = one slide" would collapse everything into a single slide. This
// prompt instead CREATES a full, structured deck from the raw material. It reuses SYS's slide-type catalogue
// verbatim (sliced out) so every layout stays available, and swaps the rebrand rules for authoring rules.
const CATALOG = SYS.slice(SYS.indexOf("Choose the layout"), SYS.indexOf("Each image is given as")).trim();
const SYS_AUTHOR = `You are the presentation designer for Acme (a B2B software company; replace with your one-line company description). You are AUTHORING a brand-new deck from the raw material the user provides (notes, prose, an outline, a document, or a voice-memo transcript). This is CREATION, not a rebrand: organise and EXPAND the material into a compelling, well-structured deck. The global frame (left nav, side rail, logo) is added automatically, so never build chrome. Output ONLY: {"title": string, "slides": Slide[]}

${CATALOG}

AUTHORING RULES (follow all):
- Build a COMPLETE narrative deck of about 8 to 16 slides. NEVER 1 to 3 slides. If the material is short, expand it into a proper deck; if long, group and structure it.
- Shape the story: open with a "cover"; use "section" dividers between topics; lead with numbers ("kpi"/"bento"/"metrics"); show the product with "showcase" (real app screens, pick the closest screen key); prove value with "proof"/"quote"; close with "cta".
- ONE idea per slide. Break dense paragraphs into several slides; turn loose points into "features"/"steps"/"columns" cards. Never dump everything onto one slide.
- Vary layouts aggressively: never two "bullets" slides in a row. Reach for the richest fitting type (features, steps, kpi, vision, mission, hub, flow, split, table, showcase) so it looks designed, not a text dump.
- Set "theme":"dark" on 2 to 4 pivotal slides (a quote, the headline metrics, a section) for rhythm. Never two dark slides in a row.
- Keep every fact, name and number ACCURATE. Never invent statistics. Short fragments, not sentences. Never use em-dashes or en-dashes.
- EVERY slide MUST have a non-empty "title". Do NOT include a "sourcePage" field.
Output ONLY the JSON object.`;

// hard guarantee no em/en dashes survive (brand rule), whatever the model does
const scrub = (o) => typeof o === "string" ? o.replace(/\s*[—–]\s*/g, ", ")
  : Array.isArray(o) ? o.map(scrub)
  : (o && typeof o === "object") ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, scrub(v)])) : o;

const TOK = { in: 0, out: 0, calls: 0 };
// Convert OpenAI-style chat messages (role system/user/assistant, content string or
// [{type:"text"},{type:"image_url",image_url:{url:"data:image/jpeg;base64,..."}}]) into the
// Anthropic Messages API shape (system hoisted out; images as base64 source blocks).
function toAnthropic(messages) {
  let system = "";
  const msgs = [];
  for (const m of messages) {
    if (m.role === "system") { system += (system ? "\n\n" : "") + (typeof m.content === "string" ? m.content : ""); continue; }
    let content;
    if (typeof m.content === "string") { content = m.content; }
    else if (Array.isArray(m.content)) {
      content = m.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image_url") {
          const url = part.image_url?.url || "";
          const mm = /^data:(image\/[a-z.+-]+);base64,(.*)$/i.exec(url);
          if (mm) return { type: "image", source: { type: "base64", media_type: mm[1], data: mm[2] } };
          return { type: "image", source: { type: "url", url } };
        }
        return part;
      });
    } else { content = ""; }
    msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content });
  }
  return { system, messages: msgs };
}

async function call(messages) {
  // heavy vision requests occasionally return an empty/partial body; retry a few times with backoff
  let lastErr;
  const { system, messages: amsgs } = toAnthropic(messages);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 32000, ...(system ? { system } : {}), messages: amsgs }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${raw.slice(0, 300)}`);
      if (!raw.trim()) throw new Error("empty response body");
      const json = JSON.parse(raw);
      const content = Array.isArray(json?.content) ? json.content.filter((b) => b.type === "text").map((b) => b.text).join("") : "";
      if (!content) throw new Error(`no content: ${raw.slice(0, 200)}`);
      if (json.usage) { TOK.in += json.usage.input_tokens || 0; TOK.out += json.usage.output_tokens || 0; TOK.calls++; }
      return content;
    } catch (e) {
      lastErr = e;
      if (attempt < 4) { console.log(`@@LOG Model call retry ${attempt} (${String(e).slice(0, 80)})`); await new Promise((r) => setTimeout(r, 2000 * attempt)); }
    }
  }
  throw lastErr;
}
const grabJSON = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));

// render-only mode: skip the AI and render a provided deck.json (used to build the template gallery)
// Gamma mode (bench-only, opt-in): GEN_NOVEL=1 lets the model flag pages that fit NO template as
// {"type":"novel"} instead of flattening them, then a focused second pass designs that one slide
// as a brand-styled HTML fragment. The live relay never sets this, so production is unchanged.
const NOVEL = process.env.GEN_NOVEL === "1";
// GEN_STYLE2=1 (bench): balanced Brand-Kit palette (deep ink titles, rotating violet/azure/teal/rose
// accents, gradient reserved for hero moments) + a hard "use every meaningful source asset" rule.
const STYLE2 = process.env.GEN_STYLE2 === "1";
// GEN_V5=1 (bench "best"): inject the Acme brand file + the power-design 20 slide rules
// into generation, the bespoke pass, and QA. Purely additive prompt guidance.
const V5 = process.env.GEN_V5 === "1";
const BRANDFILE = (() => { try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "brand", "acme-brand.md"), "utf8"); } catch { return ""; } })();
const PRINCIPLES = `SLIDE DESIGN RULES (power-design, follow all): 1 one idea per slide; 2 glanceable in 3 seconds; 3 three to five visual chunks, never more than seven; 4 at least 40% whitespace; 5 keep a 5% safe zone at every edge, nothing touches edges; 6 type sizes on a modular scale; 7 max 4 type sizes per slide; 8 body text large, titles dominant; 9 tight display line-height, relaxed body line-height; 10 line length max 60 characters; 11 contrast 4.5:1 minimum; 12 60-30-10 color split; 13 ONE accent color per slide; 14 never encode meaning by hue alone; 15 spacing on an 8pt grid; 16 align everything to one grid; 17 related items close, unrelated far apart; 18 no chart junk, data-ink first; 19 headline and key visual read first; 20 pick one visual mode per deck and stay consistent.`;
const DECKJSON = arg("deckjson");
// edit mode: load an existing deck.json, optionally run an AI edit on ONE slide (assistant prompt / regenerate),
// then render. Powers the live builder's per-slide regenerate + prompt-edit (text-edit + template-switch just
// pass an already-edited deck.json and need no AI, so they come through --deckjson).
const EDITDECK = arg("editdeck");
const QUICK = process.argv.includes("--quick");
const EDIT_SLIDE = arg("slide");
const EDIT_INSTR = arg("instruction");
// --outline mode: cheap text-only pass proposing one slide per page (type + title), for user approval
const OUTLINE_MODE = process.argv.includes("--outline");
if (OUTLINE_MODE) {
  const osys = `You plan an Acme deck. For EVERY source page, propose exactly one slide: its template type and a short title. Types: cover, mission, vision, features, section, kpi, metrics, focus, textimage, servicemetrics, deals, suppliers, announcements, staffsat, celebration, teamgrid, people, awards, table, bullets, split, steps, columns, chips, map, timeline, quote, proof, agenda, showcase, image, video, novel, cta. Reply ONLY JSON: {"outline":[{"page":n,"type":"...","title":"..."}]}. One entry per page, same order.`;
  const otext = brief.map((p2) => `PAGE ${p2.page}: ${(p2.text || "").slice(0, 600)}`).join("\n\n");
  const oj = grabJSON(await call([{ role: "system", content: osys }, { role: "user", content: `Source title: ${TITLE}\n${otext}\n\nJSON now.` }]));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "outline.json"), JSON.stringify(oj, null, 1));
  try { fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify({ in: TOK.in, out: TOK.out, calls: TOK.calls })); } catch {}
  console.log(`@@LOG TOKENS outline in=${TOK.in} out=${TOK.out}`);
  console.log(`@@LOG Outline proposed (${(oj.outline || []).length} slides)`);
  process.exit(0);
}
// --outlinehint <file>: an approved outline constrains the full generation
const OUTLINEHINT = arg("outlinehint");
let deck;
if (EDITDECK) {
  deck = JSON.parse(fs.readFileSync(EDITDECK, "utf8"));
  if (EDIT_INSTR && EDIT_SLIDE != null && deck.slides?.[+EDIT_SLIDE]) {
    const i = +EDIT_SLIDE, cur = deck.slides[i];
    console.log(`@@LOG Updating slide ${i + 1}…`);
    const sys = `You edit exactly ONE slide of an Acme deck. You get the slide as JSON and an instruction. Return ONLY the updated slide JSON, same shape. Keep the same "type" unless the instruction clearly asks for a different layout. Keep it on-brand and LESS wordy (short fragments, not sentences). Never invent facts, names or numbers. Never use em-dashes.`;
    const usr = `Slide JSON:\n\`\`\`json\n${JSON.stringify(cur)}\n\`\`\`\nInstruction: ${EDIT_INSTR}\nReturn only the updated slide JSON object.`;
    try { deck.slides[i] = scrub(grabJSON(await call([{ role: "system", content: sys }, { role: "user", content: usr }]))); }
    catch (e) { console.log("@@LOG slide edit failed, keeping original:", String(e).slice(0, 80)); }
  }
} else if (DECKJSON) {
  deck = JSON.parse(fs.readFileSync(DECKJSON, "utf8"));
} else if (arg("bespoketest")) {
  // PROOF MODE: bespoke-reconstruct only the given source pages (no main structuring call). Cheap test.
  const pages = arg("bespoketest").split(",").map((n) => +n.trim()).filter(Boolean);
  deck = { title: TITLE, slides: pages.map((n) => {
    const pg = brief.find((b) => b.page === n) || {};
    const first = (pg.text || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || `Slide ${n}`;
    return { type: "novel", title: first.slice(0, 40), brief: "Reconstruct this original slide faithfully and improve it.", sourcePage: n };
  }) };
} else if (ingest.pages.length <= 2 && !QUICK) {
  // AUTHOR MODE: prose / notes / transcript / short doc -> create a full structured deck (not 1 slide per page).
  console.log("@@LOG Writing your slides with Claude, authoring a full deck…");
  const rawText = brief.map((p) => (p.text || "").trim()).filter(Boolean).join("\n\n").slice(0, 40000) || TITLE;
  const brandGuide = V5 ? `\n\n${PRINCIPLES}\n\nBRAND FILE (authoritative):\n${BRANDFILE.slice(0, 2600)}` : "";
  const sysA = SYS_AUTHOR + brandGuide;
  const usrA = `Source title: ${TITLE}\n\nRAW MATERIAL to turn into a full Acme deck:\n\n${rawText}\n\nDesign the complete deck JSON now: about 8 to 16 slides, one idea per slide, opening with a cover and closing with a cta.`;
  let text = await call([{ role: "system", content: sysA }, { role: "user", content: usrA }]);
  try { deck = grabJSON(text); } catch {
    text = await call([{ role: "system", content: sysA }, { role: "user", content: usrA }, { role: "assistant", content: text }, { role: "user", content: "Output ONLY the JSON object." }]);
    deck = grabJSON(text);
  }
  console.log(`@@LOG Authored ${deck?.slides?.length || 0} slides`);
} else {
  const anyVision = VISION && brief.some((p) => p.page_image);
  console.log(anyVision ? "@@LOG Reading each page (vision) and writing your slides…" : "@@LOG Writing your slides with AI (Claude Opus 4.8)…");
  // TOWN HALL detection: town halls recur monthly and are ~70% the same. When we recognise one, steer the model
  // to the consistent town-hall template set so the stable slides come out the same every month and only the
  // month's content (people, promotions, awards, metrics, announcements) changes.
  const townHall = /town\s*hall/i.test(TITLE) || brief.slice(0, 4).some((p) => /town\s*hall/i.test(p.text || ""));
  // reuse the approved town-hall MASTER when we have one: keep the stable slides verbatim, refresh only this month's content
  const masterPath = path.join(BRAND, "gen", "townhall-master.json");
  const master = townHall && fs.existsSync(masterPath) ? (() => { try { return JSON.parse(fs.readFileSync(masterPath, "utf8")); } catch { return null; } })() : null;
  if (townHall) console.log(master ? "@@LOG Town Hall recognised — reusing the approved master, updating only this month's content" : "@@LOG Recognised a Town Hall — using the town-hall template set");
  const townNote = !townHall ? "" : master
    ? `\n\nTHIS IS A MONTHLY TOWN HALL and we have an APPROVED MASTER from last month (below). REPRODUCE the master deck, in the same ORDER and slide TYPES. Keep the STABLE slides EXACTLY as in the master (cover, section dividers, mission, vision, and any evergreen wording) — do not reword them. Only UPDATE the slides whose content changes each month, using THIS month's source pages: celebration (promotions/new starters/awards — one person each, attach their photo), awards (peak-performance shout-outs), teamgrid (team changes), kpi/bento (this month's metrics), and any new deals / suppliers / announcements. If the source has a new person or item with no slot in the master, add a slide of the matching template in the right section. Output the FULL deck JSON.\n\nAPPROVED MASTER (reuse stable slides verbatim):\n\`\`\`json\n${JSON.stringify(master)}\n\`\`\``
    : `\n\nTHIS IS A MONTHLY TOWN HALL. Use the recurring town-hall template set CONSISTENTLY so it looks the same every month; only the month's content changes. Map the sections: Our Mission -> mission; Vision -> vision; objectives/goals/results/metrics -> kpi or bento; a product/release update -> showcase or features; a department / product / service team -> teamgrid (attach each member's photo); an individual promotion, new starter, award or recognition -> celebration (ALWAYS attach that person's photo, one slide per person); peak performance / shout-outs / nominations -> awards; topic breaks -> section; the close -> cta. Keep the Mission and Vision wording faithful to the source. Never flatten people or promotions into plain bullets.`;
  // multimodal message: for each source page, the extracted text/images/links THEN a picture of the page,
  // so the model reproduces the layout faithfully and reads text baked into graphics (e.g. names on photos).
  const styleNote = !STYLE2 ? "" : `\n\nSTYLE DIRECTIVES (Brand Kit, balanced palette):
- USE EVERY meaningful image from each source page on its slide (photos, charts, screenshots, illustrations >=200px). Choose a layout that carries them (image, textimage, split, showcase, celebration, teamgrid, people). Tiny icons/logos are exempt. NEVER silently drop a chart or photo.
- Vary layouts aggressively: never two consecutive "bullets" slides; restructure lists into features cards, steps, kpi, split, columns or table whenever the content allows.
- Accent variety: think purple gradient FIRST for hero moments, but rotate supporting accents across the deck (violet, azure, teal, rose); the renderer handles the exact colors.
- RHYTHM: set "theme":"dark" on 2-4 content slides (a quote, the headline metrics, a pivotal statement) so the deck alternates light and deep-navy like the master decks. Never two dark slides in a row.
- EVERY headline number or percentage MUST carry a short label saying what it measures (e.g. "75%" -> label "of customers onboarded"). NEVER a bare "75%" / "95%" with no label. If the source gives no meaning for a number, do not invent a lone stat card.`
  + (V5 ? `\n\n${PRINCIPLES}\n\nBRAND FILE (authoritative):\n${BRANDFILE.slice(0, 2600)}` : "");
let outlineNote = "";
  if (OUTLINEHINT) { try { const oh = JSON.parse(fs.readFileSync(OUTLINEHINT, "utf8")); outlineNote = `\n\nAPPROVED OUTLINE (the user approved this; follow the slide ORDER, TYPES and TITLES exactly, one slide per entry):\n${JSON.stringify(oh.outline || oh)}`; } catch {} }
  const content = [{ type: "text", text: `Source title: ${TITLE}${townNote}${styleNote}${outlineNote}\nBelow is every source page: its extracted text, its image files (file, width w, height h, and centre position x,y in percent), its links, and then a PICTURE of the page. Rebrand each page into an Acme slide, keep the content accurate, and produce the deck JSON at the end.` }];
  for (const p of brief) {
    content.push({ type: "text", text: `\n===== PAGE ${p.page} =====\ntext: ${p.text}\nimages: ${JSON.stringify(p.images)}\nlinks: ${JSON.stringify(p.links)}` });
    const img = pageImg(p);
    if (img) content.push({ type: "image_url", image_url: { url: img } });
  }
  content.push({ type: "text", text: "\nEvery slide object MUST include a \"sourcePage\" field = the source page number it is based on.\nProduce the deck JSON now." });
  const userContent = anyVision ? content : content.map((c) => c.type === "text" ? c.text : "").join("");
  const FLATTEN_RULE = `- If a page's layout does NOT match any template (a bespoke diagram, flowchart, or infographic), DO NOT try to
  redraw it. Just rebrand it simply: use "bullets" (or "split"/"table") to carry its title and key text on-brand.
  A clean, simple branded slide is REQUIRED, a broken custom diagram is NOT acceptable. Never invent connectors,
  arrows, or absolutely-positioned boxes.`;
  const NOVEL_RULE = `- REBUILD EVERY DIAGRAM IN CLEAN HTML using a structured DIAGRAM type — never keep a flat image, never
  dump it to bullets. Match the source diagram to the right type and fill its DATA (the engine draws it
  perfectly):
  * hub-and-spoke / radial / a tech or integration stack / product modules / many things mapping to ONE centre
    -> "hub" (center + nodes).
  * a left-to-right process / pipeline / supplier->processing->buyer flow / matching flow -> "flow" (stages).
  * a constellation of labelled colour circles / bubbles / badges (e.g. 5 focus areas over 4 "in place") -> "ring".
  * two overlapping circles / shared-vs-owned responsibilities -> "venn".
  * a Gantt / schedule / month-grid / implementation-or-migration timeline with bars -> "gantt".
  * a roadmap / staged journey / winding road / numbered stages -> "roadmap".
  * a dated milestone timeline (years across a line) -> "timeline". a centre target with flanking pillars -> "vision".
    boxes around a centre hub -> "announcements" or "hub". two lists compared -> "columns".
  Reproduce ALL the source's items, numbers and labels in the chosen type's data — do not simplify. A rich
  timeline with big numbers keeps every number as an event note; a 5+4 circle infographic becomes a "ring"
  with all 9 labels; a supplier network becomes a "hub".
- Only if a page is a genuinely bespoke composition that NONE of the types above can express, emit
  {"type":"novel","title":string,"brief":string,"sourcePage":number}: "brief" describes the content AND the
  layout (zones, emphasis) in 2-4 sentences; a dedicated design pass builds it on-brand. Use "novel" for AT
  MOST ~15% of the deck. Never emit "novel" for something a diagram type above already covers.`;
  // QUICK BUILD (Method A): read the content (vision) but lay it into SIMPLE templates only — never reconstruct
  // a diagram, never rephrase. Faithful "frame it as-is". FULL BUILD keeps the diagram/reconstruction rules.
  const QUICK_RULE = `\n\nQUICK MODE (IMPORTANT): This is a FAST FRAME, not a redesign. Use ONLY these simple templates:
cover, section, agenda, bullets, kpi, metrics, table, columns, chips, people, celebration, teamgrid, awards,
textimage, showcase, image, quote, proof, split, features, cta. Do NOT use hub, flow, ring, venn, gantt,
roadmap, timeline, vision, mission, announcements, deals, suppliers, staffsat, servicemetrics, bento, focus,
novel. Represent any diagram/flow/roadmap/chart as a "bullets" (or "table"/"columns") slide carrying its text.
Keep the wording as close to the source as possible: do not rewrite sentences, only trim to short fragments.
Preserve every fact, name and number. One slide per source page.`;
  const SYS2 = (NOVEL ? SYS.replace(FLATTEN_RULE, NOVEL_RULE) : SYS) + (QUICK ? QUICK_RULE : "");
  let text = await call([{ role: "system", content: SYS2 }, { role: "user", content: userContent }]);
  try { deck = grabJSON(text); } catch {
    text = await call([{ role: "system", content: SYS2 }, { role: "user", content: userContent }, { role: "assistant", content: text }, { role: "user", content: "Output ONLY the JSON object." }]);
    deck = grabJSON(text);
  }
}
if (!deck?.slides?.length) throw new Error("no slides produced");
deck = scrub(deck);
// FULL-HTML rebuild: every slide is real HTML (no kept page images). Post-process only to (a) map slides to
// their source page, and (b) handle FLATTENED sources — where every "extracted image" is the whole slide, so it
// must NOT be dropped into a photo circle. Celebration photos are supplied separately as cropped headshots.
if (!DECKJSON && !EDITDECK) {
  if (deck.slides.length === brief.length) deck.slides.forEach((s, i) => { if (s.sourcePage == null) s.sourcePage = brief[i].page; });
  const fullpageOf = (sp, file) => { const pg = brief.find((b) => b.page === +sp); return !!pg?.images?.find((im) => im.file === file && im.fullpage); };
  // crop a square headshot from the clean page render at a percent bounding box; returns the asset filename
  const cropFace = (sp, facebox, name) => {
    if (!Array.isArray(facebox) || facebox.length !== 4 || !sp) return null;
    const pg = brief.find((b) => b.page === +sp);
    const src = pg?.page_clean && fs.existsSync(path.join(ASSETS, pg.page_clean)) ? pg.page_clean : null;
    if (!src) return null;
    const cr = `crop-${name}.png`, [x, y, w, h] = facebox.map(Number);
    try {
      execFileSync("arch", ["-arm64", INGEST_PY, "-c",
        // square-crop the face, then inset ~9% so the ORIGINAL photo's circular ring/border is cropped away
        // (otherwise our own gradient ring sits outside it and you get a ring-inside-a-ring)
        "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGB');W,Hh=im.size;x,y,w,h=[float(a) for a in sys.argv[3:7]];" +
        "l,t,r,b=int(W*x/100),int(Hh*y/100),int(W*(x+w)/100),int(Hh*(y+h)/100);l=max(0,l);t=max(0,t);r=min(W,r);b=min(Hh,b);" +
        "s=max(1,min(r-l,b-t));cx,cy=(l+r)//2,(t+b)//2;s2=int(s*0.82);l2=max(0,cx-s2//2);t2=max(0,cy-s2//2);im.crop((l2,t2,l2+s2,t2+s2)).save(sys.argv[2])",
        path.join(ASSETS, src), path.join(ASSETS, cr), String(x), String(y), String(w), String(h)],
        { stdio: "ignore" });
      return fs.existsSync(path.join(ASSETS, cr)) ? cr : null;
    } catch { return null; }
  };
  for (const s of deck.slides) {
    // drop whole-slide images the model mistook for a photo (they bleed the whole slide into a circle)
    if (s.image && fullpageOf(s.sourcePage, s.image) && (s.type === "celebration" || s.type === "textimage" || s.type === "image" || s.type === "showcase")) s.image = null;
    if ((s.type === "people" || s.type === "teamgrid") && Array.isArray(s.people)) {
      s.people.forEach((p, k) => {
        if (p.image && fullpageOf(s.sourcePage, p.image)) p.image = null;
        // crop each member's real headshot from the flattened page when the model supplies a facebox
        if (!p.image && Array.isArray(p.facebox)) { const cr = cropFace(s.sourcePage, p.facebox, `${String(s.sourcePage).padStart(3, "0")}-${k}`); if (cr) p.image = cr; }
      });
    }
    // FLATTENED celebration photo: crop the real headshot from the clean render (not the whole slide)
    if (s.type === "celebration" && !s.image && Array.isArray(s.facebox)) {
      const cr = cropFace(s.sourcePage, s.facebox, String(s.sourcePage).padStart(3, "0")); if (cr) s.image = cr;
    }
  }
}
// Gamma mode pass 2: design each flagged novel slide as a brand-styled HTML fragment
const sanitizeHTML = (h) => String(h || "")
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/\son\w+\s*=\s*"[^"]*"/gi, "").replace(/\son\w+\s*=\s*'[^']*'/gi, "")
  .replace(/javascript:/gi, "");
if (NOVEL && !DECKJSON && !EDITDECK) {
  const allNovels = deck.slides.filter((x) => x.type === "novel" && !x.html);
  // safety cap: never bespoke-design more than ~40% of the deck (protects speed + cost + consistency);
  // excess novel slides fall back to a clean bullets slide from their own page text.
  const NCAP = Math.max(6, Math.ceil(deck.slides.length * 0.4));
  if (allNovels.length > NCAP) {
    for (const ns of allNovels.slice(NCAP)) {
      const pg = brief.find((b) => b.page === +ns.sourcePage) || {};
      ns.type = "bullets"; ns.points = (pg.text || ns.brief || "").split(/\n+/).map((t) => t.trim()).filter(Boolean).slice(0, 6);
    }
    console.log(`@@LOG Capped bespoke slides at ${NCAP} (model proposed ${allNovels.length})`);
  }
  const novels = allNovels.slice(0, NCAP);
  if (novels.length) console.log(`@@LOG Designing ${novels.length} bespoke slide${novels.length > 1 ? "s" : ""}…`);
  const BK = path.join(BRAND, "gen", "brandkit");
  const BK_LIST = (() => { try { return fs.readdirSync(BK).filter((f) => f.endsWith(".png")); } catch { return []; } })();
  // sample manifest copy (original content removed): describe your own brand-kit files by slug prefix
  const BK_MANIFEST = !BK_LIST.length ? "" : `\nACME BRAND-KIT ASSETS — use as <img src="assets/NAME"> where they fit (they are ON-BRAND illustrations):
- Big narrative moments: scene-* (full illustrated scenes).
- Product / platform / "what it looks like": screen-art* (REAL product UI screenshots), device-* (device mockups) for mobile slides.
- Metrics: card-* (ready dashboard cards).
Available now: ${BK_LIST.join(", ")}.`;
  const CHEAT = `You RECONSTRUCT one slide of an Acme HTML deck as an HTML fragment (injected into <div class="in"> of a 16:9 slide). You are given a SCREENSHOT of the ORIGINAL slide. Your job: rebuild THAT slide's layout FAITHFULLY in clean HTML/CSS and make it look BETTER (sharper type, better spacing, on-brand colour), NEVER simpler.
CORE RULES:
- MATCH the original's structure and ALL its information: same items, same counts, same relationships. If the original shows 5 things, show 5. Do NOT reduce a rich slide to a couple of cards or a bullet list.
- If the original is a DIAGRAM (network, flow, roadmap, timeline, matrix), reproduce it: draw real connectors with an inline <svg> (lines/arrows/curved paths) or CSS, correct topology. A timeline gets a real line with dated nodes + icons; a network gets a hub with lines fanning to each node; a roadmap can be a winding path.
- USE THE REAL LOGOS/IMAGES FROM THE SOURCE: the source page's own images are provided (with positions) as assets/imgNNN.png — place the actual brand logos, product screenshots and photos, do NOT replace a logo with a text pill.${BK_MANIFEST}
- NEVER use a "+" glyph or an initials text circle to mean Acme. Use the real emblem asset (assets/emblem.png) or logo (assets/logo.png).
BRAND: gradient var(--grad) = linear-gradient(90deg,#8b5cf6,#8b5cf6,#3b82f6); ink #0f172a; body #333d52; accents violet #7c3aed / azure #0ea5e9 / teal #14b8a6 / rose #f43f5e (rotate; do NOT gradient everything); light tints #f5edff, #eaf1ff; font inherited (Inter), mono var(--mono).
BRAND: gradient var(--grad) = linear-gradient(90deg,#8b5cf6,#8b5cf6,#3b82f6); purple #8b5cf6; blue #3b82f6; ink #111827; body #4b5563; light tints #f5edff (purple) and #eaf1ff (blue); font is inherited (Inter), mono via var(--mono).
${V5 ? PRINCIPLES + "\n" + BRANDFILE.slice(0, 2200) + "\n" : ""}DESIGN PRINCIPLES (make it look art-directed, not AI-generated): one clear focal point per slide; strong grid with generous negative space; editorial type contrast (one oversized element, everything else quiet); big numbers big, labels small and muted; asymmetric layouts beat centered stacks; a deep-navy slide (background: radial-gradient(130% 130% at 80% 10%, #2a1e56, #0f172a 55%, #0d0a24)) with white text is welcome for dramatic moments; rotate accent colors (violet #7c3aed, azure #0ea5e9, teal #14b8a6, rose #f43f5e) instead of gradient-on-everything.
REUSABLE CLASSES you may use: <h2> slide title (auto gradient); <span class="eyebrow">; <p class="lead">; <ul><li> (gradient dot bullets); .ft-grid.ft-n4 + .ft-card (gradient-border cards, h3 + p inside); .mx-cards + .mx-card[.fill] (stat cards: .mx-ic icon circle, .mx-lbl, .mx-val, .mx-pill); .cfo-band>div (gradient stat tiles: .v value, .l label); .chiprow + .chip (pill tags); .steps4 + .step (.k number, h3); .tbl (table, gradient header); .an-box (bordered callout box).
RULES: gradient-border card pattern = style="background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:2.5px solid transparent;border-radius:22px;padding:1.8rem". Inline styles allowed (flex/grid layouts encouraged). NO <script>, NO event handlers, NO external URLs (images ONLY from the provided assets list as <img src="assets/FILE">).
CRITICAL LAYOUT: the slide auto-scales, so design FLUID. NEVER put a fixed pixel width or height on any layout container (no width:1144px, no width:560px, no height:640px). Use only %, fr, flex, vh/vw and rem. The root fills the slide; use width:100% and flex/grid with gap. Columns = flex:1 (never fixed px). Images: max-width:100%. Everything must fit ONE viewport (~90vh, ~92vw) with generous whitespace, no horizontal scroll. text-wrap:balance on headings. Never use em-dashes. Output ONLY JSON: {"html":"<fragment>"}.`;
  const designOne = async (ns) => {
    const pg = brief.find((b) => b.page === +ns.sourcePage) || brief[Math.max(0, (+ns.sourcePage || 1) - 1)] || {};
    const srcImgs = (Array.isArray(pg.images) ? pg.images : []).map((im) => ({ file: im.file, w: im.w, h: im.h, x: im.x, y: im.y }));
    const msg = [{ type: "text", text: `Slide title (keep it SHORT, 1-3 words): ${ns.title}
Design brief: ${ns.brief || ""}
Source page text (carry ALL of it, keep facts exact):
${(pg.text || "").slice(0, 3500)}
REAL SOURCE IMAGES on this page (place the actual logos/screenshots/photos, x,y = centre % on the page): ${JSON.stringify(srcImgs)}
The screenshot below IS the original slide — reconstruct its layout faithfully and improve it. Design the fragment now.` }];
    const pim = pageImg(pg);
    if (pim) msg.push({ type: "image_url", image_url: { url: pim } });
    try {
      const out = grabJSON(await call([{ role: "system", content: CHEAT }, { role: "user", content: pim ? msg : msg[0].text }]));
      ns.html = sanitizeHTML(scrub(out.html || ""));
      console.log(`@@LOG Bespoke slide "${String(ns.title).slice(0, 40)}" designed`);
    } catch (e) {
      console.log(`@@LOG Bespoke design failed for "${String(ns.title).slice(0, 30)}", falling back to bullets`);
      ns.type = "bullets"; ns.points = (pg.text || ns.brief || "").split(/\n+/).filter(Boolean).slice(0, 6);
    }
  };
  // design bespoke slides CONCURRENTLY (was sequential, which crawled on image-heavy decks)
  const CONC = 5;
  for (let i = 0; i < novels.length; i += CONC) await Promise.all(novels.slice(i, i + CONC).map(designOne));
}
console.log(`@@SLIDES ${deck.slides.length}`);
console.log(`@@LOG Structured into ${deck.slides.length} slides. Designing…`);

// ---------- deterministic branded renderer ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mdLinks = (s) => esc(s).replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
const imgTag = (f) => (f && fs.existsSync(path.join(ASSETS, f)) ? `<img src="assets/${esc(f)}" alt="">` : "");

// a source Vimeo/YouTube url -> an embedded player frame (or a link button if not recognised)
function videoEmbed(url) {
  const u = String(url || "");
  const vim = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);
  // Always render a branded gradient poster card with a play button (never a raw iframe): a bare Vimeo/
  // YouTube iframe shows a BLACK loading box in static exports (PDF/PPTX) and screenshots. The card opens
  // the real video on click in the live HTML deck, and looks clean everywhere.
  return u
    ? `<div class="vid-frame vid-link"><a href="${esc(u)}" target="_blank" rel="noopener"><span class="vid-play">&#9658;</span><span>Watch the video</span></a></div>`
    : "";
}

// pick the last word of the cover title to accent with the brand gradient (light cover only)
const gradLast = (t) => { const w = String(t).trim().split(/\s+/); if (w.length < 2) return `<span class="gt">${esc(t)}</span>`; const last = w.pop(); return `${esc(w.join(" "))} <span class="gt">${esc(last)}</span>`; };
// cover sub-headline: a short date/tag (e.g. "Q3 Review 2026") renders as a small refined chip; a full
// sentence renders as a clean sub-headline paragraph. Never the old bold gradient-filled box.
const coverSub = (sub) => { const t = String(sub || "").trim(); if (!t) return ""; const isTag = t.length <= 26 && !/[.!?,]/.test(t); return isTag ? `<span class="cd-tag">${esc(t)}</span>` : `<p class="cd-lead">${mdLinks(t)}</p>`; };

const H = (t) => `<h2>${mdLinks(t)}</h2>`;
// a short 1-3 word brand title (kept-diagram headers): the framed original already carries its full title,
// so our header just needs a concise, on-brand label (honours the short-titles rule).
const HEAD_STOP = /^(to|of|and|the|a|an|for|with|that|about|or|is|in|on|at|by|your|our)$/i;
const shortHead = (t) => {
  let w = String(t ?? "").replace(/\s*[:.].*$/, "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
  while (w.length > 1 && HEAD_STOP.test(w[w.length - 1])) w.pop();
  return w.join(" ");
};
const arr = (x) => Array.isArray(x) ? x : [];
const SCREENS = ["home", "invoices", "purchase-orders", "catalog", "inventory", "budgets", "suppliers", "reports"];
// brand line-icons (no emoji), keyed for vision/mission points. stroke inherits currentColor.
const SVG = (b) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
const ICON = {
  global: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/>'),
  team: SVG('<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 6M20.5 20a5.5 5.5 0 0 0-4.5-5.4"/>'),
  enterprise: SVG('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  ai: SVG('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  ops: SVG('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'),
  growth: SVG('<path d="M3 17l6-6 4 4 7-7"/><path d="M17 7h4v4"/>'),
  target: SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  spark: SVG('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  shield: SVG('<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>'),
  phone: SVG('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/>'),
  chat: SVG('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  mail: SVG('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>'),
};
const icon = (k) => ICON[String(k || "").toLowerCase()] || ICON.spark;
const TARGET = `<svg class="vt-tgt" viewBox="0 0 200 210"><defs><radialGradient id="tgO" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#9179ff"/><stop offset="1" stop-color="#6a49ee"/></radialGradient><radialGradient id="tgM" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#c07dff"/><stop offset="1" stop-color="#9b4dff"/></radialGradient></defs><ellipse cx="100" cy="190" rx="72" ry="11" fill="#6a49ee" opacity=".13"/><circle cx="100" cy="100" r="90" fill="url(#tgO)"/><circle cx="100" cy="100" r="67" fill="#fff"/><circle cx="100" cy="100" r="46" fill="url(#tgM)"/><circle cx="100" cy="100" r="25" fill="#fff"/><circle cx="100" cy="100" r="11" fill="#6f4ff0"/><path d="M30 44 L96 96" stroke="#2f5bfd" stroke-width="8.5" stroke-linecap="round"/><path d="M107 107 L84 99 L99 84 Z" fill="#2f5bfd"/></svg>`;

function slideHTML(s, i) {
  const isCover = s.type === "cover" || s.type === "title";
  const dark = s.type === "section" || s.type === "cta" || (isCover && COVER !== "light" && COVER !== "master" && COVER !== "device" && COVER !== "hybrid");
  const inner = (() => {
    switch (s.type) {
      case "page":
        // HYBRID diagram: a crisp original of an intricate connected diagram, framed on-brand with an
        // eyebrow + short title so it reads as a deliberate, designed slide (not a bare copy).
        if (s.diagram) {
          const t = (s.title || "").trim();
          // "bare" = the kept original already carries its own title (e.g. a celebration slide) — frame it with
          // just the card + brand bar, no duplicate header.
          const head = (s.bare || !t) ? "" : `<div class="pg-dia-head"><h2 class="pg-dia-title">${esc(shortHead(t))}</h2></div>`;
          return `<div class="pg-dia${s.bare || !t ? " pg-dia-bare" : ""}">${head}<div class="pg-dia-card"><img src="assets/${esc(s.image)}" alt="${esc(t)}"></div><div class="pg-dia-bar"></div></div>`;
        }
        // COPY MODE: a faithful full-bleed image of the original source page, inside our deck shell.
        return `<img class="pg-full" src="assets/${esc(s.image)}" alt="${esc(s.title || "")}">`;
      case "cover": case "title":
        if (COVER === "hybrid")
          // hybrid cover: floating 3D emblem (intro deck) + the ACTUAL short-pack device cluster (captured tablet + iPhone)
          return `<img class="ch-bgmark" src="assets/emblem.png" alt="" aria-hidden="true"><div class="cm-split ch-split"><div class="cm-copy"><span class="eyebrow">${esc(TAGLINE)}</span><h1>${gradLast(s.title)}</h1>${coverSub(s.subtitle)}</div><div class="ch-art"><div class="ch-glow"></div><img class="ch-devices" src="assets/cover-devices3.png" alt="Acme on tablet and mobile"></div></div>`;
        if (COVER === "device")
          // master-deck style cover: headline + sub-headline left, live app UI in a device frame right
          return `<div class="cm-split cd-split"><div class="cm-copy"><span class="eyebrow">${esc(TAGLINE)}</span><h1>${gradLast(s.title)}</h1>${coverSub(s.subtitle)}</div><div class="cd-device"><div class="cd-frame"><div class="cd-bar"><i></i><i></i><i></i></div><img src="assets/screen-home.webp" alt="Acme"></div></div></div>`;
        if (COVER === "master")
          return `<div class="cm-split"><div class="cm-copy"><span class="eyebrow">${esc(TAGLINE)}</span><h1>${gradLast(s.title)}</h1>${s.subtitle ? `<p class="lead">${mdLinks(s.subtitle)}</p>` : ""}</div><div class="cm-art"><div class="cm-glow"></div><img src="assets/emblem.png" alt="Acme"></div></div>`;
        return `<span class="eyebrow">${esc(TAGLINE)}</span><h1>${COVER === "light" ? gradLast(s.title) : mdLinks(s.title)}</h1>${s.subtitle ? `<p class="lead">${mdLinks(s.subtitle)}</p>` : ""}`;
      case "section":
        return `${s.label ? `<span class="eyebrow">${esc(s.label)}</span>` : ""}<h2 class="big">${mdLinks(s.title)}</h2>`;
      case "agenda":
        return `${H(s.title)}<div class="steps4">${arr(s.items).slice(0, 6).map((it, n) => `<div class="step"><div class="k">${String(n + 1).padStart(2, "0")}</div><h3>${mdLinks(it)}</h3></div>`).join("")}</div>`;
      case "bullets":
        return `${H(s.title)}<ul>${arr(s.points).map((p) => `<li>${mdLinks(p)}</li>`).join("")}</ul>`;
      case "kpi":
        return `${H(s.title)}<div class="cfo-band">${arr(s.stats).slice(0, 4).map((x) => `<div><div class="v">${esc(x.value)}</div><div class="l">${mdLinks(x.label)}</div></div>`).join("")}</div>`;
      case "metrics": {
        // stat highlight cards over a line chart (town-hall Product Metrics look; 21st statistics-card + line-chart style)
        const st = arr(s.stats).slice(0, 4);
        const cards = st.map((x, n) => `<div class="mx-card${n % 2 ? " fill" : ""}"><span class="mx-ic">${icon(x.icon || ["ops", "team", "growth", "enterprise"][n % 4])}</span><div class="mx-lbl">${esc(x.label || "")}</div><div class="mx-val">${esc(x.value || "")}</div>${x.sub ? `<span class="mx-pill">${esc(x.sub)}</span>` : ""}</div>`).join("");
        // deterministic smooth line chart: series + flat target, dashed grid, gradient area fade
        const ch = s.chart || {};
        const series = arr(ch.series && ch.series.length ? ch.series : [-3, -1, 25, 19, 48, 43]).map(Number);
        const labels = arr(ch.labels && ch.labels.length ? ch.labels : ["Jan", "Feb", "March", "April", "May", "June"]);
        const target = Number.isFinite(+ch.target) ? +ch.target : 65;
        const lo = Math.min(...series, target, 0), hi = Math.max(...series, target);
        const pad = (hi - lo) * 0.18 || 10;
        const yMin = lo - pad, yMax = hi + pad;
        const W = 1040, Hh = 300, mL = 46, mR = 16, mT = 14, mB = 34;
        const px = (i) => mL + (i * (W - mL - mR)) / Math.max(1, series.length - 1);
        const py = (v) => mT + (1 - (v - yMin) / (yMax - yMin)) * (Hh - mT - mB);
        const pts = series.map((v, i) => [px(i), py(v)]);
        // catmull-rom -> bezier smooth path
        let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
          const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
          const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
          d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
        }
        const area = `${d}L${pts[pts.length - 1][0].toFixed(1)},${Hh - mB}L${pts[0][0].toFixed(1)},${Hh - mB}Z`;
        // dashed horizontal grid at ~5 ticks
        const ticks = 5; let grid = "", yl = "";
        for (let t = 0; t <= ticks; t++) {
          const v = yMin + ((yMax - yMin) * t) / ticks, y = py(v);
          grid += `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W - mR}" y2="${y.toFixed(1)}" stroke="#e7e5f3" stroke-width="1" stroke-dasharray="4 12"/>`;
          yl += `<text x="${mL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="#9aa0b0">${Math.round(v)}</text>`;
        }
        const xl = labels.map((m, i) => `<text x="${px(i).toFixed(1)}" y="${Hh - 10}" text-anchor="middle" font-size="14" fill="#4b5563">${esc(m)}</text>`).join("");
        const ty = py(target);
        const dots = `<circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="6" fill="#8b5cf6" stroke="#fff" stroke-width="2.5"/>`;
        const leg = `<div class="mx-legend"><span><i style="background:#8b5cf6"></i>${esc(ch.name || "Series")}</span><span><i style="background:#c4b5fd"></i>Target</span></div>`;
        const svg = `<svg class="mx-svg" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="mxg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".15"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></linearGradient></defs>${grid}${yl}${xl}<line x1="${mL}" y1="${ty.toFixed(1)}" x2="${W - mR}" y2="${ty.toFixed(1)}" stroke="#c4b5fd" stroke-width="2.5"/><path d="${area}" fill="url(#mxg)"/><path d="${d}" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-linecap="round"/>${dots}</svg>`;
        return `${H(s.title)}<div class="mx-cards">${cards}</div><div class="mx-chart">${leg}${svg}</div>`;
      }
      case "focus": {
        // focus-areas composite (tick items, dotted priority timeline, tinted table) — town-hall "Key Focus Areas"
        const ticks = arr(s.items).slice(0, 4);
        const fpts = arr(s.points).slice(0, 5);
        const frows = arr(s.table && s.table.rows).slice(0, 8);
        return `${H(s.title)}<div class="fk-ticks">${ticks.map((t) => `<div class="fk-tick"><span></span><p>${mdLinks(t)}</p></div>`).join("")}</div><div class="fk-body"><div class="fk-left">${s.subheading ? `<h3 class="fk-sub">${mdLinks(s.subheading)}</h3>` : ""}${s.lead ? `<p class="fk-lead">${mdLinks(s.lead)}</p>` : ""}<div class="fk-pts">${fpts.map((p2) => `<div class="fk-pt"><i></i><span>${mdLinks(p2)}</span></div>`).join("")}</div></div><div class="fk-right"><table class="tbl fk-tbl"><tbody>${frows.map((r) => { const tot = String((arr(r)[0] || "")).replace(/<[^>]*>/g, "").trim().toLowerCase() === "total"; return `<tr${tot ? ' class="fk-total"' : ""}>${arr(r).map((c, ci) => `<td${ci === 0 ? ' class="tbl-h"' : ""}>${mdLinks(c)}</td>`).join("")}</tr>`; }).join("")}</tbody></table></div></div>`;
      }
      case "textimage": {
        // text + image: bullets left, one large gradient-framed image right, hover opens a circular zoom loupe
        const hasTI = s.image && fs.existsSync(path.join(ASSETS, s.image));
        const tiList = `<ul>${arr(s.points).map((p2) => `<li>${mdLinks(p2)}</li>`).join("")}</ul>`;
        // no image (e.g. the source "photo" was a whole-slide thumbnail we removed) -> clean full-width bullets,
        // never an empty framed box
        if (!hasTI) return `${H(s.title)}${tiList}`;
        return `${H(s.title)}<div class="ti-wrap"><div class="ti-copy">${tiList}</div><div class="ti-frame"><img class="ti-img" src="assets/${esc(s.image)}" alt=""><div class="ti-loupe"><div class="ti-lens"></div></div></div></div>`;
      }
      case "servicemetrics": {
        // service KPI dashboard: speed cards + resolution bar left, CSAT + verbatims right
        const chs = arr(s.channels).slice(0, 3);
        const res = s.resolution || {};
        const verbs = arr(s.verbatims).slice(0, 5);
        const USR = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
        const stars = (n) => `<span class="sv-stars">${"&#9733;".repeat(Math.max(1, Math.min(5, +n || 5)))}</span>`;
        return `${H(s.title)}<div class="sv-wrap"><div class="sv-left"><div class="sv-lhead"><span class="sv-lic">${icon("growth")}</span><span>${esc(s.speedHeading || "Average speed of answer")}</span></div><div class="sv-cards">${chs.map((c) => `<div class="sv-card"><span class="sv-cic">${icon(c.icon || "phone")}</span><div class="sv-clabel">${esc(c.label || "")}</div><div class="sv-val">${esc(c.value || "")}<small>${esc(c.unit || "")}</small>${c.up ? '<b class="sv-up">&#8593;</b>' : ""}</div>${c.kpi ? `<span class="sv-pill">${esc(c.kpi)}</span>` : ""}</div>`).join("")}</div><div class="sv-res"><span class="sv-ric">${icon("target")}</span><div class="sv-rmain"><div class="sv-rlabel">${esc(res.label || "First interaction resolution:")}</div><div class="sv-rval">${esc(res.value || "")}</div></div><div class="sv-kpi"><span>${esc(res.kpi || "")}</span><div class="sv-bar"><i style="width:${Math.max(4, Math.min(100, +res.pct || 0))}%"></i></div></div></div></div><div class="sv-right"><div class="sv-csat"><span class="sv-cv">${esc((s.csat && s.csat.value) || "")}</span><b class="sv-up big">&#8593;</b><span class="sv-cl">${esc((s.csat && s.csat.label) || "Customer Satisfaction")}</span></div><div class="sv-vhead"><span class="sv-q">&#10077;&#10078;</span><span>Verbatims</span></div><div class="sv-verbs">${verbs.map((v, n) => `<div class="sv-verb${n % 2 ? " alt" : ""}"><span class="sv-av${n % 2 ? " alt" : ""}">${USR}</span><p>${mdLinks(v.text || String(v))}</p>${stars(v.stars)}</div>`).join("")}</div></div></div>`;
      }
      case "deals": {
        // wins around a central illustration, each with a gradient pin dot
        const dits = arr(s.items).slice(0, 5);
        const hasD = s.image && fs.existsSync(path.join(ASSETS, s.image));
        const pin = (t) => t ? `<div class="dl-pin"><span class="dl-dot"><i></i></span><p>${mdLinks(t)}</p></div>` : "";
        return `<div class="dl">${H(s.title)}<div class="dl-grid"><div class="dl-col">${pin(dits[0])}${pin(dits[1])}</div><div class="dl-mid">${pin(dits[2])}${hasD ? `<img class="dl-img" src="assets/${esc(s.image)}" alt="">` : ""}</div><div class="dl-col">${pin(dits[3])}${pin(dits[4])}</div></div></div>`;
      }
      case "suppliers": {
        // regional gradient-border panels with dotted lists + illustration
        const gps = arr(s.groups).slice(0, 4);
        const hasS = s.image && fs.existsSync(path.join(ASSETS, s.image));
        return `${H(s.title)}<div class="sp2"><div class="sp2-panels">${gps.map((g, n) => `<div class="sp2-panel${n === 0 ? " tall" : ""}"><h3>${esc(g.heading || "")}</h3><div class="sp2-items">${arr(g.items).map((it) => `<div class="sp2-it"><i></i><span>${mdLinks(it)}</span></div>`).join("")}</div></div>`).join("")}</div>${hasS ? `<div class="sp2-illo"><img src="assets/${esc(s.image)}" alt=""></div>` : ""}</div>`;
      }
      case "announcements": {
        // hub-and-spoke: six boxes around a centre gradient megaphone
        const aits = arr(s.items).slice(0, 6);
        const mega = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4a1 1 0 0 0 1 1h2l3.2 5.2a1 1 0 0 0 1.8-.5V15h.4L19 19V5l-7.6 4H4a1 1 0 0 0-1 1z"/><path d="M20.5 9.2a3.6 3.6 0 0 1 0 5.6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>';
        const box = (t) => `<div class="an-box"><p>${mdLinks(t)}</p></div>`;
        return `<div class="an">${H(s.title)}<div class="an-grid"><div class="an-col l">${aits.slice(0, 3).map(box).join("")}</div><div class="an-mid"><span class="an-mega">${mega}</span></div><div class="an-col r">${aits.slice(3).map(box).join("")}</div></div></div>`;
      }
      case "staffsat": {
        // one wide gradient-border highlight card: heading + stat lines left, circle cluster of real staff photos right
        const ims = arr(s.images).filter((f) => f && fs.existsSync(path.join(ASSETS, f))).slice(0, 7);
        return `${H(s.title)}<div class="ss-card"><div class="ss-copy"><h3 class="ss-h">${esc(s.heading || "People")}</h3><span class="ss-rule"></span>${arr(s.lines).map((l) => `<p class="ss-line">${mdLinks(l)}</p>`).join("")}</div><div class="ss-circle">${ims.map((f, n) => `<img class="ss-av ss-av${n}" src="assets/${esc(f)}" alt="">`).join("")}</div></div>`;
      }
      case "novel": {
        // Gamma-mode bespoke slide: pre-sanitized brand-styled fragment. The fragment usually includes
        // its own <h2> title, so only prepend the deck title when it doesn't (avoids a doubled heading).
        const h = String(s.html || "");
        return `${/<h[12]/i.test(h) ? "" : H(s.title)}<div class="novel">${h}</div>`;
      }
      case "bento": {
        const h = s.hero || {};
        // drop blank cards (no heading, no text) so we never render an empty tile
        const cards = arr(s.cards).filter((c) => (c.heading && String(c.heading).trim()) || (c.text && String(c.text).trim())).slice(0, 3);
        return `${H(s.title)}<div class="solve-grid"><div class="solve-hero">${h.value ? `<div class="big">${esc(h.value)}</div>` : ""}<h3>${mdLinks(h.heading || "")}</h3><p>${mdLinks(h.text || "")}</p></div>${cards.map((c) => `<div class="solve-card">${c.value ? `<div class="n">${esc(c.value)}</div>` : ""}<h3>${mdLinks(c.heading || "")}</h3><p>${mdLinks(c.text || "")}</p></div>`).join("")}</div>`;
      }
      case "steps": {
        const st = arr(s.steps).slice(0, 4);
        return `${H(s.title)}<div class="steps${st.length > 3 ? "4" : "6"}">${st.map((x, n) => `<div class="step"><div class="k">STEP ${n + 1}</div><h3>${mdLinks(x.heading || "")}</h3><p>${mdLinks(x.text || "")}</p></div>`).join("")}</div>`;
      }
      case "features": {
        // icon-card grid (21st-style features section): each card = icon tile + title + description,
        // gradient border, fixed grid (4 -> 2x2) matching the town-hall "What's Here" slide
        const cs = arr(s.cards).slice(0, 6);
        const dico = ["spark", "growth", "shield", "ai", "global", "team"];
        return `${H(s.title)}<div class="ft-grid ft-n${cs.length}">${cs.map((c, n) => { const dup = c.text && c.text.trim().toLowerCase() === String(c.heading || "").trim().toLowerCase(); return `<div class="ft-card"><span class="ft-ic">${icon(c.icon || dico[n % dico.length])}</span><h3>${mdLinks(c.heading || "")}</h3>${c.text && !dup ? `<p>${mdLinks(c.text)}</p>` : ""}</div>`; }).join("")}</div>`;
      }
      case "split":
        return `${H(s.title)}<div class="split2"><ul>${arr(s.points).map((p) => `<li>${mdLinks(p)}</li>`).join("")}</ul>${(s.asideHeading || s.asideText) ? `<div class="solve-hero">${s.asideHeading ? `<h3>${mdLinks(s.asideHeading)}</h3>` : ""}${s.asideText ? `<p>${mdLinks(s.asideText)}</p>` : ""}</div>` : ""}</div>`;
      case "proof":
        return `<div class="res-row"><div class="res-quote"><blockquote>${mdLinks(s.quote)}</blockquote>${s.author ? `<cite><b>${esc(s.author)}</b></cite>` : ""}</div>${arr(s.stats).length ? `<div class="res-side">${arr(s.stats).slice(0, 2).map((x) => `<div class="res-mini"><div class="v">${esc(x.value)}</div><div class="l">${mdLinks(x.label)}</div></div>`).join("")}</div>` : ""}</div>`;
      case "quote":
        return `<blockquote>${mdLinks(s.quote)}</blockquote>${s.author ? `<cite>${esc(s.author)}</cite>` : ""}`;
      case "chips":
        return `${H(s.title)}<div class="chiprow chiprow-l">${arr(s.items).map((it) => `<span class="chip">${esc(it)}</span>`).join("")}</div>`;
      case "showcase": {
        const scr = SCREENS.includes(s.screen) ? s.screen : "home";
        const body = arr(s.points).length ? `<ul>${arr(s.points).map((p) => `<li>${mdLinks(p)}</li>`).join("")}</ul>` : s.text ? `<p class="lead">${mdLinks(s.text)}</p>` : "";
        return `<div class="sw-split"><div class="sw-copy">${H(s.title)}${body}</div><div class="sw-panel"><img src="assets/screen-${scr}.webp" alt="Acme"></div></div>`;
      }
      case "image":
        return `${s.title ? H(s.title) : ""}<div class="media wide">${imgTag(s.image)}</div>${s.caption ? `<p class="cap">${mdLinks(s.caption)}</p>` : ""}`;
      case "people": {
        const ppl = arr(s.people).slice(0, 8);
        const grid = `<div class="ppl-grid${ppl.length > 4 ? " four" : ""}">${ppl.map((p) => `<div class="ppl-card"><div class="ppl-photo">${p.image && fs.existsSync(path.join(ASSETS, p.image)) ? `<img src="assets/${esc(p.image)}" alt="${esc(p.name || "")}">` : `<span class="ppl-init">${esc((p.name || "?").trim()[0] || "?")}</span>`}</div><div class="ppl-meta"><div class="ppl-name">${esc(p.name || "")}</div>${p.role ? `<div class="ppl-role">${esc(p.role)}</div>` : ""}${p.note ? `<div class="ppl-note">${mdLinks(p.note)}</div>` : ""}</div></div>`).join("")}</div>`;
        // same source page had a video too -> keep it on ONE slide (team + video side by side)
        return s.videoUrl ? `${H(s.title)}<div class="ppl-vid">${grid}<div class="ppl-vid-r">${videoEmbed(s.videoUrl)}</div></div>` : `${H(s.title)}${grid}`;
      }
      case "celebration": {
        // one person — promotion / new starter / recognition: name (left) + bio + role pill, ringed circular photo (right)
        const has = s.image && fs.existsSync(path.join(ASSETS, s.image));
        const photo = has ? `<img src="assets/${esc(s.image)}" alt="${esc(s.name || "")}">` : `<span class="cel-init">${esc((s.name || "?").trim()[0] || "?")}</span>`;
        return `<div class="cel"><div class="cel-body"><h1 class="cel-name">${esc(s.name || "")}</h1><span class="cel-eyebrow">${esc(s.eyebrow || "Congratulations")}</span><span class="cel-rule"></span>${s.message ? `<p class="cel-msg">${mdLinks(s.message)}</p>` : ""}${s.role ? `<span class="cel-pill">${esc(s.role)}</span>` : ""}</div><div class="cel-figure"><div class="cel-photo">${photo}</div></div></div>`;
      }
      case "vision": {
        // master-deck Vision look: title + subtitle, a brand target in the centre, points flanking left/right with icons
        const pts = arr(s.points).slice(0, 6);
        const half = Math.ceil(pts.length / 2);
        const pt = (p, right) => `<div class="vt-pt${right ? " r" : ""}"><span class="vt-ic">${icon(p.icon)}</span><div class="vt-pt-b"><div class="vt-pt-h">${mdLinks(p.heading || "")}</div>${p.text ? `<div class="vt-pt-t">${mdLinks(p.text)}</div>` : ""}</div></div>`;
        return `<div class="vt"><div class="vt-head"><span class="eyebrow">${esc(s.subtitle || "Where Acme is going")}</span>${H(s.title)}</div><div class="vt-body"><div class="vt-col">${pts.slice(0, half).map((p) => pt(p, false)).join("")}</div><div class="vt-tgt-wrap"><img class="vt-tgt" src="assets/target3d.png" alt=""></div><div class="vt-col">${pts.slice(half).map((p) => pt(p, true)).join("")}</div></div></div>`;
      }
      case "mission": {
        // hierarchy: a dominant mission statement in a gradient hero card + supporting icon cards (master-deck look)
        const cs = arr(s.cards).slice(0, 4);
        return `${s.title ? H(s.title) : ""}<div class="mn2"><div class="mn2-hero"><span class="eyebrow">${esc(s.eyebrow || "Our mission")}</span><p class="mn2-stmt">${mdLinks(s.statement || "")}</p></div><div class="mn2-cards">${cs.map((c) => `<div class="mn2-card"><span class="mn2-ic">${icon(c.icon)}</span><div><div class="mn2-h">${mdLinks(c.heading || "")}</div>${c.text ? `<div class="mn2-t">${mdLinks(c.text)}</div>` : ""}</div></div>`).join("")}</div></div>`;
      }
      case "awards": {
        // recognition / peak-performance: a celebratory grid of nominees (name, reason, nominated-by)
        const items = arr(s.items).slice(0, 8);
        return `${H(s.title)}${s.subtitle ? `<p class="lead">${mdLinks(s.subtitle)}</p>` : ""}<div class="aw-grid">${items.map((a) => `<div class="aw-card"><span class="aw-ic">${icon("spark")}</span><div class="aw-b"><div class="aw-name">${esc(a.name || "")}</div>${a.note ? `<div class="aw-note">${mdLinks(a.note)}</div>` : ""}${a.by ? `<span class="aw-by">Nominated by ${esc(a.by)}</span>` : ""}</div></div>`).join("")}</div>`;
      }
      case "teamgrid": {
        // department / product team, master-deck style: name + purple underline + role, circular photo below
        const ppl = arr(s.people).slice(0, 8);
        return `${H(s.title)}<div class="tg-grid">${ppl.map((p) => `<div class="tg-m"><div class="tg-name">${esc(p.name || "")}</div><div class="tg-line"></div>${p.role ? `<div class="tg-role">${mdLinks(p.role)}</div>` : ""}<div class="tg-ph">${p.image && fs.existsSync(path.join(ASSETS, p.image)) ? `<img src="assets/${esc(p.image)}" alt="${esc(p.name || "")}">` : `<span class="tg-init">${esc((p.name || "?").trim()[0] || "?")}</span>`}</div></div>`).join("")}</div>`;
      }
      case "video":
        return `${s.title ? H(s.title) : ""}${videoEmbed(s.url)}${s.caption ? `<p class="cap"><a href="${esc(String(s.url))}" target="_blank" rel="noopener">${mdLinks(s.caption)}</a></p>` : `<p class="cap"><a href="${esc(String(s.url))}" target="_blank" rel="noopener">${esc(String(s.url))}</a></p>`}`;
      case "timeline": {
        const ev = arr(s.events).slice(0, 7);
        return `${H(s.title)}<div class="tl"><div class="tl-line"></div><div class="tl-nodes">${ev.map((e, n) => `<div class="tl-node"><div class="tl-card tl-${n % 2 ? "below" : "above"}">${e.year ? `<div class="tl-year">${esc(e.year)}</div>` : ""}<div class="tl-label">${mdLinks(e.label || "")}</div>${e.note ? `<div class="tl-note">${mdLinks(e.note)}</div>` : ""}</div><div class="tl-dot"></div></div>`).join("")}</div></div>`;
      }
      case "map": {
        // city-level pins on an auto-zooming map: the viewport crops to the region the pins occupy
        const COORD = {
          phuket: [74.8, 46], bangkok: [75.8, 43], rayong: [76.4, 44], thailand: [75.8, 43],
          singapore: [75.8, 49.5], "kuala-lumpur": [75.2, 47.5], bali: [79, 55], jakarta: [77.8, 53],
          adelaide: [84.3, 72.6], melbourne: [85.8, 73.9], sydney: [87.3, 71.8], brisbane: [88.2, 68.6], perth: [79.5, 71.4], australia: [85, 70],
          auckland: [93.8, 72.8], "new-zealand": [93.8, 72.8], fiji: [96.5, 62], pacific: [96.5, 62],
          "hong-kong": [78.7, 37.2], tokyo: [85.2, 29.5], asia: [78, 40],
          london: [45.5, 16.5], uk: [45.5, 16.5], europe: [48.5, 17],
          "new-york": [26, 27], "north-america": [24, 26], usa: [23, 29],
          "south-america": [31, 62], africa: [52, 52], dubai: [62.5, 37], "middle-east": [62.5, 37],
        };
        const mk = arr(s.markers).slice(0, 12).map((m) => {
          const key = String(m.place || m.region || "").toLowerCase().replace(/\s+/g, "-");
          return { ...m, _c: COORD[key] || COORD[Object.keys(COORD).find((k) => key.includes(k)) || ""] || [50, 50] };
        });
        const xs = mk.map((m) => m._c[0]), ys = mk.map((m) => m._c[1]);
        let cx0 = Math.min(...xs), cx1 = Math.max(...xs), cy0 = Math.min(...ys), cy1 = Math.max(...ys);
        const padX = Math.max(7, (cx1 - cx0) * 0.32), padY = Math.max(7, (cy1 - cy0) * 0.32);
        cx0 -= padX; cx1 += padX; cy0 -= padY; cy1 += padY;
        let cw = Math.max(24, cx1 - cx0), chh = Math.max(20, cy1 - cy0);
        if (cw > 62 || chh > 55) { cx0 = 0; cw = 100; cy0 = 0; chh = 100; }
        cx0 = Math.max(0, Math.min(100 - cw, cx0)); cy0 = Math.max(0, Math.min(100 - chh, cy0));
        const MAPW = 4378.13, MAPH = 2434.94;
        const aspect = ((MAPW * cw) / (MAPH * chh)).toFixed(3);
        const pos = (m) => `left:${(((m._c[0] - cx0) / cw) * 100).toFixed(2)}%;top:${(((m._c[1] - cy0) / chh) * 100).toFixed(2)}%`;
        const pins = mk.map((m, n) => {
          const isB = m.kind === "b";
          const lbl = m.label || m.value || "";
          return `<div class="map-pin ${isB ? "b" : "a"}" style="${pos(m)}"><i></i><span class="map-pin-lbl${n % 2 ? " below" : ""}">${esc(lbl)}</span></div>`;
        }).join("");
        const groupA = mk.filter((m) => m.kind !== "b"), groupB = mk.filter((m) => m.kind === "b");
        const legRow = (m) => `<div class="map-leg-item">${esc(m.label || m.value || m.place || m.region || "")}</div>`;
        const legend = `${groupA.length ? `<div class="map-leg-grp"><div class="map-leg-title"><span class="map-leg-dot a"></span>${esc(s.legendTitle || "Customers")}</div>${groupA.map(legRow).join("")}</div>` : ""}${groupB.length ? `<div class="map-leg-grp"><div class="map-leg-title"><span class="map-leg-dot b"></span>${esc(s.legendTitleB || "Partners")}</div>${groupB.map(legRow).join("")}</div>` : ""}`;
        return `${H(s.title)}<div class="map-wrap"><div class="map-legend">${legend}</div><div class="map-viewport" style="aspect-ratio:${aspect}"><img src="assets/worldmap.svg" alt="" class="map-zoom" style="width:${(10000 / cw).toFixed(2)}%;left:-${((cx0 * 100) / cw).toFixed(2)}%;top:-${((cy0 * 100) / chh).toFixed(2)}%">${pins}</div></div>`;
      }
      case "columns": {
        const cols = arr(s.columns).slice(0, 3);
        return `${H(s.title)}<div class="cmp-grid" style="grid-template-columns:repeat(${cols.length || 1},1fr)">${cols.map((c) => `<div class="cmp-col"><div class="cmp-head">${mdLinks(c.heading || "")}</div><div class="cmp-items">${arr(c.items).map((it) => `<div class="cmp-item"><span class="cmp-dot"></span><div><div class="cmp-label">${mdLinks(it.label || "")}</div>${it.note ? `<div class="cmp-note">${mdLinks(it.note)}</div>` : ""}</div></div>`).join("")}</div>${c.total ? `<div class="cmp-total">${esc(c.total)}</div>` : ""}</div>`).join("")}</div>`;
      }
      case "table": {
        const heads = arr(s.headers), rows = arr(s.rows).slice(0, 10);
        return `${H(s.title)}<div class="tbl-wrap"><table class="tbl">${heads.length ? `<thead><tr>${heads.map((h) => `<th>${mdLinks(h)}</th>`).join("")}</tr></thead>` : ""}<tbody>${rows.map((r) => `<tr>${arr(r).map((c, ci) => `<td${ci === 0 ? ' class="tbl-h"' : ""}>${mdLinks(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
      // ── DETERMINISTIC DIAGRAM RENDERERS (engine-drawn, reliable full-HTML rebuilds of source diagrams) ──
      case "hub": {
        // centre node + radiating spokes (product modules, integration/tech stacks, matching to one code)
        const nodes = arr(s.nodes).slice(0, 12), N = nodes.length || 1, cen = s.center || {};
        const P = nodes.map((_, i) => { const a = (-90 + i * 360 / N) * Math.PI / 180; return { x: 50 + Math.cos(a) * 41, y: 50 + Math.sin(a) * 40 }; });
        const lines = P.map((p) => `<line x1="50" y1="50" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`).join("");
        const cImg = cen.logo && fs.existsSync(path.join(ASSETS, cen.logo)) ? `<img src="assets/${esc(cen.logo)}" alt="">` : `<img src="assets/emblem.png" alt="">`;
        const nodeEls = nodes.map((nd, i) => {
          const hasLogo = nd.logo && fs.existsSync(path.join(ASSETS, nd.logo));
          const inner = hasLogo ? `<img src="assets/${esc(nd.logo)}" alt="${esc(nd.label || "")}">` : `<span class="hub-wm">${mdLinks(nd.label || "")}</span>`;
          return `<div class="hub-node" style="left:${P[i].x}%;top:${P[i].y}%">${inner}${hasLogo && nd.label ? `<span class="hub-lbl">${esc(nd.label)}</span>` : ""}</div>`;
        }).join("");
        return `${H(s.title)}<div class="hub"><svg class="hub-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg><div class="hub-center">${cImg}${cen.label ? `<span>${esc(cen.label)}</span>` : ""}</div>${nodeEls}</div>`;
      }
      case "flow": {
        // left-to-right pipeline of stages joined by arrows (supplier -> processing -> buyer, etc.)
        const stages = arr(s.stages).slice(0, 5);
        const arrow = `<div class="flow-arrow"><svg viewBox="0 0 24 24"><path d="M3 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
        const cards = stages.map((st, i) => `<div class="flow-stage">${st.heading ? `<div class="flow-h">${mdLinks(st.heading)}</div>` : ""}<div class="flow-items">${arr(st.items).map((it) => `<div class="flow-it">${mdLinks(typeof it === "string" ? it : it.label || "")}</div>`).join("")}</div></div>`).join(arrow);
        return `${H(s.title)}<div class="flow-wrap"><div class="flow-row">${cards}</div>${s.note ? `<p class="flow-note">${mdLinks(s.note)}</p>` : ""}</div>`;
      }
      case "ring": {
        // rows of labelled colour circles (key areas / pillars constellation)
        const groups = arr(s.groups).slice(0, 3);
        const PAL = ["#3b82f6", "#7c3aed", "#0f172a", "#14b8a6", "#f43f5e", "#0ea5e9", "#8b5cf6"];
        const norm = (t) => String(t || "").trim().toLowerCase();
        return `${H(s.title)}<div class="ring">${groups.map((g) => `${g.heading && norm(g.heading) !== norm(s.title) ? `<div class="ring-h">${mdLinks(g.heading)}</div>` : ""}<div class="ring-row">${arr(g.items).map((it, i) => { const label = typeof it === "string" ? it : it.label || ""; const col = (typeof it === "object" && it.color) || PAL[i % PAL.length]; return `<div class="ring-c" style="background:${esc(col)}"><span>${mdLinks(label)}</span></div>`; }).join("")}</div>`).join("")}</div>`;
      }
      case "venn": {
        // two overlapping circles with a list each + optional shared-overlap label
        const L = s.left || {}, R = s.right || {}, O = s.overlap || {};
        const list = (o) => arr(o.items).map((x) => `<div>${mdLinks(typeof x === "string" ? x : x.label || "")}</div>`).join("");
        return `${H(s.title)}<div class="venn"><div class="venn-c venn-l"></div><div class="venn-c venn-r"></div><div class="venn-txt venn-tl"><div class="venn-ch">${esc(L.heading || "")}</div>${list(L)}</div><div class="venn-txt venn-tr"><div class="venn-ch">${esc(R.heading || "")}</div>${list(R)}</div>${(O.heading || arr(O.items).length) ? `<div class="venn-txt venn-tm"><div class="venn-ch">${esc(O.heading || "Shared")}</div>${list(O)}</div>` : ""}</div>`;
      }
      case "gantt": {
        // workstream rows x month columns with duration bars (implementation / migration schedule)
        const months = Array.isArray(s.months) && s.months.length ? s.months : Array.from({ length: +s.monthCount || 12 }, (_, i) => String(i + 1));
        const M = months.length, rows = arr(s.rows).slice(0, 10);
        const PAL = ["#8b5cf6", "#3b82f6", "#14b8a6", "#f43f5e", "#7c3aed", "#0ea5e9", "#8b5cf6", "#0f172a"];
        const head = `<div class="gantt-row gantt-head"><div class="gantt-lbl"></div><div class="gantt-cells" style="grid-template-columns:repeat(${M},1fr)">${months.map((m) => `<span class="gantt-mh">${esc(m)}</span>`).join("")}</div></div>`;
        const body = rows.map((r, ri) => `<div class="gantt-row"><div class="gantt-lbl">${mdLinks(r.label || "")}</div><div class="gantt-cells" style="grid-template-columns:repeat(${M},1fr)">${arr(r.bars).map((b) => { const start = Math.min(M, Math.max(1, +b.start || 1)); const span = Math.max(1, Math.min(M - start + 1, +b.span || 1)); return `<span class="gantt-bar" style="grid-column:${start}/${start + span};background:${esc(b.color || PAL[ri % PAL.length])}">${b.text ? esc(b.text) : ""}</span>`; }).join("")}</div></div>`).join("");
        return `${H(s.title)}<div class="gantt-wrap"><div class="gantt">${head}${body}</div></div>`;
      }
      case "roadmap": {
        // numbered stages on a connected path (number circles in a row, cards hanging BELOW so nothing ever
        // collides with the title) + optional side "what matters" themes card
        const st = arr(s.stages).slice(0, 6), themes = s.themes;
        const track = `<div class="rm-track"><div class="rm-line"></div>${st.map((x, i) => `<div class="rm-stage"><div class="rm-num">${esc(String(x.n || i + 1))}</div><div class="rm-card"><div class="rm-h">${mdLinks(x.heading || "")}</div>${x.text ? `<div class="rm-t">${mdLinks(x.text)}</div>` : ""}</div></div>`).join("")}</div>`;
        return `${H(s.title)}<div class="rm">${track}${themes ? `<div class="rm-themes"><div class="rm-th-h">${mdLinks(themes.heading || "What matters")}</div>${arr(themes.items).map((t) => `<div class="rm-th-i">${mdLinks(typeof t === "string" ? t : t.label || "")}</div>`).join("")}</div>` : ""}</div>`;
      }
      case "cta":
        return `<span class="eyebrow">${esc(TAGLINE)}</span><h2 class="big">${mdLinks(s.title)}</h2>${s.subtitle ? `<p class="lead">${mdLinks(s.subtitle)}</p>` : ""}${arr(s.chips).length ? `<div class="chiprow chiprow-l">${arr(s.chips).map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}`;
      default:
        return `${H(s.title || "")}<p class="body">${mdLinks(s.body || "")}</p>`;
    }
  })();
  const darkTheme = s.theme === "dark" && !isCover && s.type !== "section" && s.type !== "cta";
  const coverCls = isCover ? ` cover cover-${COVER}` : darkTheme ? " dkx" : "";
  return `<section class="sl pp-slide ${dark || darkTheme ? "dk" : "lt"}${coverCls}" id="s${i}"><div class="in">${inner}</div></section>`;
}

// Brand system taken verbatim from the master decks (.pp tokens + brand display font).
// Generated decks must read as part of the same family: same font, palette, gradient, type scale,
// left-aligned composition, text-wrap:balance everywhere.
const CSS = `:root{--ink:#0f1424;--body:#4b5563;--muted:#9aa0b0;--purple:#8b5cf6;--magenta:#8b5cf6;--blue:#3b82f6;--border:#ecebf5;
--teal:#14b8a6;--rose:#f43f5e;--violet:#7c3aed;--azure:#0ea5e9;--amber:#f6b83c;--teal-soft:#dff9fa;--rose-soft:#ffe7ee;
--grad:linear-gradient(135deg,#8b5cf6 0%,#8b5cf6 50%,#3b82f6 100%);--grad-soft:linear-gradient(135deg,#f7f1ff 0%,#eef3ff 100%);
--grad-deep:linear-gradient(140deg,#8b5cf6 0%,#3b82f6 100%);--shadow:0 30px 80px #8b5cf62e;--shadow-sm:0 14px 40px #0f142417;
--disp:Inter,system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace}
@font-face{font-family:"Inter";src:url("fonts/Inter-Light.ttf") format("truetype");font-weight:344;font-style:normal;font-display:swap}
@font-face{font-family:"Inter";src:url("fonts/Inter-Medium.ttf") format("truetype");font-weight:500;font-style:normal;font-display:swap}
*{box-sizing:border-box}html,body{margin:0}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--body);background:#fff}
.deck{scroll-snap-type:y mandatory;overflow-y:auto;height:100vh}
.sl{scroll-snap-align:start;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:clamp(3rem,7.5vw,8rem);position:relative;overflow:hidden}
.sl .in{width:100%;max-width:1180px;position:relative;z-index:1}
.sl.lt{background:#fff;color:var(--body)}
.sl.dk{background:var(--grad);color:#fff}
.sl.dk::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 90% at 85% 15%,rgba(255,255,255,.18),transparent 55%);pointer-events:none}
h1,h2,h3,.disp{font-family:var(--disp);color:var(--ink);letter-spacing:-.02em;line-height:1.02;font-weight:344;text-wrap:balance}
.dk h1,.dk h2,.dk h3{color:#fff}
h1{font-size:clamp(2.8rem,6.2vw,5.4rem);margin:0}
h2{font-size:clamp(2.1rem,4vw,3.6rem);margin:0 0 1.1rem}
.lt .in>h2{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content;max-width:100%}
h2.big{font-size:clamp(2.8rem,5.6vw,4.8rem)}
p{text-wrap:balance}
.eyebrow{font-family:var(--mono);font-size:.95rem;letter-spacing:.18em;text-transform:uppercase;color:var(--purple);font-weight:600;display:inline-block;margin-bottom:1.3rem}
.dk .eyebrow{color:rgba(255,255,255,.88)}
.lead{font-size:clamp(1.15rem,1.55vw,1.6rem);line-height:1.5;margin-top:1.3rem;max-width:46ch;color:var(--body)}
.dk .lead{color:rgba(255,255,255,.92)}
.row{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(2rem,4vw,4.5rem);align-items:center}
.row .media img{width:100%;border-radius:18px;box-shadow:0 30px 80px -30px rgba(139,92,246,.45)}
ul{margin:1.3rem 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1rem}
li{position:relative;padding-left:1.7rem;font-size:clamp(1.02rem,1.25vw,1.3rem);line-height:1.45;color:inherit}
li:before{content:"";position:absolute;left:0;top:.5em;width:.62rem;height:.62rem;border-radius:50%;background:var(--grad)}
.dk li:before{background:#fff}
.media.wide img{width:100%;max-height:66vh;object-fit:contain;border-radius:18px}
.cap{color:var(--muted);margin-top:.9rem;font-size:.95rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:clamp(1.4rem,2.4vw,2.6rem);margin-top:1.8rem}
.stat b{display:block;font-family:var(--disp);font-weight:344;font-size:clamp(2.6rem,4.4vw,4rem);line-height:1.12;padding-bottom:.06em;overflow:visible;letter-spacing:-.02em;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.dk .stat b{background:none;color:#fff}
.stat span{display:block;margin-top:.5rem;color:var(--body);font-size:1rem}
.dk .stat span{color:rgba(255,255,255,.9)}
blockquote{font-family:var(--disp);font-weight:344;font-size:clamp(1.9rem,3.4vw,3.1rem);line-height:1.18;margin:0;letter-spacing:-.02em;text-wrap:balance;color:var(--ink)}
.dk blockquote{color:#fff}
cite{display:block;margin-top:1.5rem;font-style:normal;font-family:var(--mono);letter-spacing:.06em;color:var(--purple)}
.dk cite{color:rgba(255,255,255,.9)}
.body{font-size:clamp(1.05rem,1.35vw,1.38rem);line-height:1.6;max-width:60ch;margin-top:.6rem}
a{color:var(--purple);text-decoration:underline;text-underline-offset:3px;font-weight:500}
.dk a{color:#fff}
/* cover brand mark (the eyebrow on the cover) */
.brandmark{display:inline-flex;align-items:center;gap:.6rem;font-family:var(--mono);letter-spacing:.16em;text-transform:uppercase;font-size:.82rem;font-weight:600;margin-bottom:1.4rem;color:var(--purple)}
.dk .brandmark{color:#fff}
.bm-x{width:15px;height:15px;flex-shrink:0;background:var(--grad);clip-path:polygon(38% 0,62% 0,62% 38%,100% 38%,100% 62%,62% 62%,62% 100%,38% 100%,38% 62%,0 62%,0 38%,38% 38%)}
.dk .bm-x{background:#fff}
/* cover variants */
.cover .in{max-width:1240px}
.cover h1{font-size:clamp(3.2rem,7vw,6rem);line-height:.98}
.cover .lead{margin-top:1.5rem;font-size:clamp(1.2rem,1.7vw,1.7rem)}
.cover-gradient{background:var(--grad);color:#fff}
.cover-light{background:#fff}
.cover-light h1{color:var(--ink)}
.cover-light .gt{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.cover-light .lead{color:var(--body)}
.cover-dark{background:#0f1424;color:#fff}
.cover-dark::after{content:"";position:absolute;inset:0;background:radial-gradient(90% 70% at 90% 10%,rgba(139,92,246,.35),transparent 60%);pointer-events:none}
.cover-dark h1{color:#fff}
.cover-dark .lead{color:rgba(255,255,255,.85)}
/* ===== master cover (real intro-deck cover: headline left, 3D emblem right) ===== */
.cover-master{background:radial-gradient(125% 125% at 82% 32%,#efe9ff 0%,#eef3ff 42%,#fff 100%);color:var(--ink);padding:clamp(2.5rem,6vw,6.5rem)}
.cover-master .in{max-width:1440px}
.cm-split{display:grid;grid-template-columns:1.02fr .98fr;gap:clamp(1.5rem,3vw,3.5rem);align-items:center;width:100%}
.cover-master .gt{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.cover-master h1{font-size:clamp(3rem,5.6vw,5.4rem);margin:0}
.cover-master .lead{margin-top:1.4rem;max-width:40ch;color:var(--body)}
.cm-art{position:relative;display:flex;align-items:center;justify-content:center;min-height:64vh}
.cm-art img{width:min(94%,600px);max-height:82vh;object-fit:contain;position:relative;z-index:1;filter:drop-shadow(0 50px 90px rgba(139,92,246,.4))}
.cm-glow{position:absolute;width:70%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,.5),rgba(59,130,246,.32) 45%,transparent 70%);filter:blur(40px)}
@media(max-width:900px){.cm-split{grid-template-columns:1fr}.cm-art{min-height:auto;margin-top:1.5rem}}
/* ===== device cover (master-deck style: headline + date pill left, live app UI in a device frame right) ===== */
.cover-device{background:radial-gradient(125% 125% at 82% 32%,#f3efff 0%,#eef3ff 40%,#fff 100%);color:var(--ink);padding:clamp(2.5rem,6vw,6.5rem)}
.cover-device .in{max-width:1480px}
.cd-split{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(1.8rem,3.4vw,3.4rem);align-items:center;width:100%}
.cd-split>.cm-copy{min-width:0}
.cover-device h1{font-size:clamp(2.4rem,4.7vw,4.5rem);margin:0;line-height:1.04;letter-spacing:-.02em;text-wrap:balance}
.cover-device .gt{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
/* clean cover sub-headline (sentence) and refined tag chip (short date/label) — replaces the old gradient box */
.cd-lead{margin:1.4rem 0 0;font-size:clamp(1.08rem,1.4vw,1.45rem);line-height:1.5;max-width:32ch;color:var(--body);font-weight:400;text-wrap:balance}
.cd-tag{display:inline-block;margin-top:1.6rem;background:var(--grad-soft);color:var(--purple);font-family:var(--mono);font-weight:600;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;padding:.5rem 1.1rem;border-radius:999px;border:1px solid var(--border)}
.cd-date{display:inline-block;margin-top:1.7rem;background:var(--grad);color:#fff;font-family:var(--disp);font-weight:500;font-size:clamp(1.05rem,1.6vw,1.5rem);padding:.55rem 1.7rem;border-radius:999px;letter-spacing:.02em}
.cd-device{position:relative}
.cd-frame{border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 50px 110px -34px rgba(139,92,246,.55);border:1px solid var(--border)}
.cd-bar{height:36px;background:#f3f4f6;display:flex;align-items:center;gap:7px;padding:0 15px;border-bottom:1px solid var(--border)}
.cd-bar i{width:11px;height:11px;border-radius:50%;background:#d3d5df;display:block}
.cd-frame img{width:100%;display:block}
@media(max-width:900px){.cd-split{grid-template-columns:1fr}}
/* ===== hybrid cover: floating 3D emblem + device mockup (smaller) ===== */
.cover-hybrid{background:radial-gradient(125% 125% at 82% 32%,#f3efff 0%,#eef3ff 40%,#fff 100%);color:var(--ink);padding:clamp(2.5rem,6vw,6.5rem)}
.cover-hybrid .in{max-width:1480px}
/* giant faded emblem watermark washing over the whole right region, behind everything */
.ch-bgmark{position:absolute;right:-16%;top:50%;transform:translateY(-50%);width:min(84vw,1680px);max-width:none;opacity:.07;z-index:0;pointer-events:none;user-select:none}
.ch-split{display:grid;grid-template-columns:.72fr 1.28fr;gap:clamp(1.2rem,2.4vw,2.8rem);align-items:center;width:100%;position:relative;z-index:1}
.cover-hybrid .cm-copy{padding-left:clamp(1.6rem,4vw,4.8rem)}
.cover-hybrid .cm-copy .cd-date{margin-top:clamp(1.4rem,2.4vw,2.2rem)}
.cover-hybrid h1{font-size:clamp(3rem,6vw,5.8rem);margin:0;line-height:1;letter-spacing:-.02em}
.cover-hybrid .gt{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.ch-art{position:relative;display:flex;align-items:center;justify-content:center;min-height:58vh}
.ch-glow{position:absolute;top:2%;right:2%;width:42%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,.42),rgba(59,130,246,.26) 45%,transparent 70%);filter:blur(50px);z-index:0}
/* the exact short-pack device cluster (captured tablet + iPhone), used as a single transparent image */
.ch-devices{position:relative;z-index:1;width:min(112%,960px);max-width:none;max-height:70vh;height:auto;object-fit:contain;display:block}
.ch-emblem{position:absolute;top:-11%;right:-1%;width:clamp(120px,13vw,195px);z-index:30;filter:drop-shadow(0 32px 62px rgba(139,92,246,.55))}
@media(max-width:900px){.ch-split{grid-template-columns:1fr}.ch-art{min-height:auto;margin-top:1.5rem}}
/* ===== master slide-pattern kit (from web-deck components/deck/kit.css) ===== */
.solve-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;grid-template-rows:1fr 1fr;gap:clamp(1rem,1.5vw,1.4rem);margin-top:2.2rem;text-align:left}
.solve-hero{grid-row:span 2;background:var(--grad-deep);color:#fff;border-radius:28px;padding:clamp(1.8rem,2.6vw,2.8rem);display:flex;flex-direction:column;justify-content:flex-end;box-shadow:var(--shadow)}
.solve-hero .big{font-family:var(--disp);font-weight:400;font-size:clamp(3rem,4.4vw,4.4rem);line-height:1.1;padding-bottom:.08em;overflow:visible;background:linear-gradient(100deg,#fff,#b7e6ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.solve-hero h3{color:#fff;font-size:clamp(1.35rem,1.8vw,1.8rem);margin-top:1rem}
.solve-hero p{color:rgba(255,255,255,.82);font-size:clamp(1.02rem,1.3vw,1.3rem);line-height:1.4;margin-top:.8rem}
.solve-card{background:#fff;border:1px solid var(--border);border-radius:24px;padding:clamp(1.4rem,2vw,2rem);box-shadow:var(--shadow-sm)}
.solve-card .n{font-family:var(--disp);font-weight:400;font-size:clamp(2rem,2.8vw,2.8rem);line-height:1.12;padding-bottom:.06em;overflow:visible;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.solve-card h3{font-size:clamp(1.12rem,1.4vw,1.4rem);margin-top:.7rem}
.solve-card p{font-size:clamp(1rem,1.2vw,1.2rem);color:var(--body);line-height:1.38;margin-top:.5rem}
.cfo-band{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:clamp(1rem,1.5vw,1.4rem);margin-top:2.2rem;text-align:left}
.cfo-band>div{background:var(--grad-deep);border-radius:24px;padding:clamp(1.5rem,2.2vw,2.3rem) clamp(1.3rem,1.9vw,2rem);box-shadow:var(--shadow)}
.cfo-band .v{font-family:var(--disp);font-weight:400;font-size:clamp(2.6rem,3.6vw,3.8rem);line-height:1.12;padding-bottom:.06em;overflow:visible;color:#fff}
.cfo-band .l{font-size:clamp(1rem,1.25vw,1.25rem);color:rgba(255,255,255,.82);margin-top:.6rem;line-height:1.3;text-wrap:balance}
.res-row{display:grid;grid-template-columns:1.7fr 1fr;gap:clamp(1rem,1.5vw,1.4rem);margin-top:1.4rem;text-align:left}
.res-quote{background:#fff;border:1px solid var(--border);border-radius:24px;padding:clamp(1.6rem,2.3vw,2.4rem);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;justify-content:space-between}
.res-quote blockquote{font-family:var(--disp);font-weight:344;font-size:clamp(1.35rem,1.8vw,1.85rem);line-height:1.22;color:var(--ink);text-wrap:balance;margin:0}
.res-quote cite{display:block;font-style:normal;margin-top:1.1rem;font-size:clamp(.95rem,1.1vw,1.1rem);color:var(--muted)}
.res-quote cite b{color:var(--ink);font-weight:600}
.res-side{display:flex;flex-direction:column;gap:clamp(1rem,1.5vw,1.4rem)}
.res-mini{flex:1;background:#fff;border:1px solid var(--border);border-radius:24px;padding:clamp(1.2rem,1.7vw,1.8rem);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;justify-content:center}
.res-mini .v{font-family:var(--disp);font-weight:400;font-size:clamp(2rem,2.8vw,3rem);line-height:1.12;padding-bottom:.06em;overflow:visible;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.res-mini .l{font-size:clamp(1rem,1.2vw,1.2rem);color:var(--body);margin-top:.5rem;line-height:1.3}
.steps6{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(1rem,1.5vw,1.4rem);margin-top:2.2rem;text-align:left}
.steps4{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(.9rem,1.3vw,1.3rem);margin-top:2.2rem;text-align:left}
.step{background:#fff;border:1px solid var(--border);border-radius:20px;padding:clamp(1.2rem,1.7vw,1.8rem);box-shadow:var(--shadow-sm)}
.step .k{font-family:var(--mono);font-weight:700;color:var(--purple);font-size:clamp(.85rem,1vw,1rem);letter-spacing:.06em}
.step h3{font-size:clamp(1.12rem,1.4vw,1.45rem);margin-top:.55rem}
.step p{font-size:clamp(.95rem,1.15vw,1.15rem);color:var(--body);line-height:1.35;margin-top:.45rem}
.split2{display:grid;grid-template-columns:1.1fr 1fr;gap:clamp(1.6rem,2.6vw,2.8rem);align-items:center;margin-top:2rem;text-align:left}
.split2 ul{margin:0}
.chiprow{display:flex;flex-wrap:wrap;gap:.9rem;margin-top:2rem}
.chiprow-l{justify-content:flex-start}
.chip{font-family:var(--mono);font-size:clamp(.85rem,1vw,1rem);font-weight:600;color:var(--purple);background:#f5edff;border-radius:999px;padding:.7rem 1.4rem;white-space:nowrap}
.dk .chip{color:#fff;background:rgba(255,255,255,.16)}
.mod-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:clamp(1rem,1.5vw,1.4rem);margin-top:2.2rem;text-align:left}
.mod-card{background:#fff;border:1px solid var(--border);border-radius:24px;padding:clamp(1.5rem,2.1vw,2.2rem);box-shadow:var(--shadow-sm)}
.mod-card.wide{grid-column:span 2;background:var(--grad-deep)}
.mod-card.wide h3{color:#fff}.mod-card.wide p{color:rgba(255,255,255,.85)}.mod-card.wide .mn{color:rgba(255,255,255,.7)}
.mod-card .mn{font-family:var(--mono);font-size:clamp(.85rem,1vw,1rem);font-weight:700;color:var(--purple);letter-spacing:.08em}
.mod-card h3{font-size:clamp(1.3rem,1.6vw,1.65rem);margin-top:.6rem}
.mod-card p{font-size:clamp(1.05rem,1.25vw,1.3rem);color:var(--body);line-height:1.34;margin-top:.55rem;text-wrap:balance}
/* metrics: stat highlight cards + line chart (town-hall Product Metrics) */
.mx-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(.9rem,1.6vw,1.5rem);margin-top:clamp(1.2rem,2vw,1.8rem);width:100%;text-align:center}
.mx-card{border-radius:18px;padding:clamp(1rem,1.6vw,1.6rem);background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:2px solid transparent;box-shadow:0 16px 40px -28px rgba(139,92,246,.4)}
.mx-card.fill{background:var(--grad);border:2px solid transparent}
.mx-ic{display:inline-flex;align-items:center;justify-content:center;width:clamp(42px,3vw,52px);height:clamp(42px,3vw,52px);border-radius:50%;background:var(--grad);color:#fff;margin-bottom:.55rem}
.mx-card.fill .mx-ic{background:#fff;color:var(--purple)}
.mx-ic svg{width:54%;height:54%}
.mx-lbl{font-size:clamp(.85rem,1vw,1rem);color:var(--body)}
.mx-card.fill .mx-lbl{color:rgba(255,255,255,.9)}
.mx-val{font-family:var(--disp);font-weight:600;font-size:clamp(1.9rem,2.9vw,2.9rem);line-height:1.05;color:var(--purple);margin-top:.25rem}
.mx-card.fill .mx-val{color:#fff}
.mx-pill{display:inline-block;margin-top:.5rem;padding:.28rem .8rem;border-radius:999px;background:#f3efff;color:var(--purple);font-weight:600;font-size:clamp(.72rem,.85vw,.85rem);white-space:nowrap}
.mx-card.fill .mx-pill{background:rgba(255,255,255,.18);color:#fff}
.mx-chart{width:100%;margin-top:clamp(1.1rem,1.8vw,1.7rem)}
.mx-legend{display:flex;justify-content:center;gap:1.6rem;font-size:clamp(.82rem,1vw,1rem);color:var(--ink);margin-bottom:.4rem}
.mx-legend span{display:inline-flex;align-items:center;gap:.45rem}
.mx-legend i{width:11px;height:11px;border-radius:50%;display:inline-block}
.mx-svg{width:100%;height:auto;display:block}
@media(max-width:900px){.mx-cards{grid-template-columns:1fr 1fr}}
/* deep-navy dark theme (theme:"dark"), the master intro-deck look */
.sl.dkx{background:radial-gradient(130% 130% at 82% 8%,#2a1e56 0%,#0f172a 52%,#0d0a24 100%);color:#fff}
.dkx .in>h2{color:#fff}
.style2 .dkx .in>h2{background:none;-webkit-background-clip:initial;color:#fff}
.dkx .lead,.dkx li,.dkx p{color:rgba(255,255,255,.88)}
.dkx .tbl td{color:rgba(255,255,255,.85);border-color:rgba(255,255,255,.12)}
.dkx .tbl td.tbl-h{color:#fff}
.dkx .tbl tbody tr:nth-child(even) td{background:rgba(255,255,255,.05)}
.dkx .ft-card{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14);box-shadow:none}
.dkx .ft-card h3{color:#fff}
.dkx .ft-card p{color:rgba(255,255,255,.78)}
/* bento cards stay WHITE on dark slides, so their text must stay dark (was white-on-white) */
.dkx .solve-card h3{color:var(--ink)}
.dkx .solve-card p{color:var(--body)}
.dkx .solve-card{background:#fff}
.dkx .mx-card{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14)}
.dkx .mx-lbl{color:rgba(255,255,255,.75)}
.dkx .stats .l,.dkx .cap{color:rgba(255,255,255,.7)}
/* copy mode: a faithful full-bleed image of the original source page, framed in our shell */
.sl:has(.pg-full){padding:1.6vh 2.2vw 1.6vh clamp(1rem,14vw,14.5rem)}
.pp.nav-collapsed .sl:has(.pg-full){padding-left:2.2vw}
.sl:has(.pg-full) .in{max-width:none;width:100%;height:96vh;display:flex;align-items:center;justify-content:center}
.pg-full{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:6px;box-shadow:0 10px 40px -16px rgba(17,20,36,.18)}
.pp-copy .sl:has(.pg-full){padding:2.4vh 3vw}
.pp-copy .sl:has(.pg-full) .in{height:95vh}
/* HYBRID diagram: crisp original of an intricate diagram, framed on-brand (eyebrow + short title + card) */
.sl:has(.pg-dia) .in{max-width:none;width:100%}
.pg-dia{display:flex;flex-direction:column;height:92vh;width:100%}
.pg-dia-head{flex:0 0 auto;margin-bottom:1.4vh}
.pg-eyebrow{font-family:var(--mono);font-size:.9rem;letter-spacing:.18em;color:var(--purple);font-weight:600;display:block;margin-bottom:.5rem}
.pg-dia-title{font-size:clamp(1.7rem,3vw,2.7rem);background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content;max-width:100%}
.pg-dia-card{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:20px;padding:2.2vh 2vw;box-shadow:var(--shadow-sm);border:1px solid var(--border)}
.pg-dia-card img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
.pg-dia-bar{flex:0 0 auto;height:7px;margin-top:1.6vh;border-radius:6px;background:linear-gradient(90deg,#7c3aed 0 25%,#0ea5e9 25% 50%,#14b8a6 50% 75%,#f43f5e 75% 100%)}
.pg-dia-bare .pg-dia-card{padding:1.4vh 1.4vw}
/* novel (gamma mode): bespoke fragment container */
.novel{width:100%;margin-top:1rem}
.novel img{max-width:100%}
/* focus: ticks + dotted priority timeline + tinted table */
.fk-ticks{display:flex;justify-content:space-between;gap:clamp(1.2rem,3vw,3rem);margin-top:.4rem;width:100%}
.fk-tick{display:flex;gap:.75rem;align-items:flex-start;flex:1;max-width:30ch}
.fk-tick span{flex:0 0 auto;width:4.5px;align-self:stretch;min-height:2.2em;border-radius:3px;background:var(--grad)}
.fk-tick p{font-size:clamp(1rem,1.25vw,1.3rem);color:var(--ink);line-height:1.3;text-wrap:balance}
.fk-body{display:grid;grid-template-columns:1fr 1.05fr;gap:clamp(2rem,4vw,4.5rem);align-items:center;margin-top:clamp(1.6rem,2.8vw,2.8rem);width:100%}
.fk-sub{font-family:var(--disp);font-weight:600;font-size:clamp(1.5rem,2.1vw,2.15rem);background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content}
.fk-lead{color:var(--body);font-size:clamp(1rem,1.2vw,1.25rem);margin-top:.5rem}
.fk-pts{margin-top:1.4rem;position:relative;display:flex;flex-direction:column;gap:1.6rem;padding-left:2.4rem}
.fk-pts::before{content:"";position:absolute;left:12px;top:8px;bottom:8px;border-left:2px dashed #c4b5fd}
.fk-pt{position:relative}
.fk-pt i{position:absolute;left:-2.4rem;top:.1em;width:26px;height:26px;border-radius:50%;background:var(--grad);box-shadow:0 6px 16px rgba(139,92,246,.45)}
.fk-pt span{font-size:clamp(1rem,1.25vw,1.3rem);color:var(--ink);line-height:1.35}
.fk-tbl td{font-size:clamp(.95rem,1.15vw,1.2rem);padding:.8rem 1rem}
.fk-tbl tr.fk-total td{background:var(--grad);color:#fff;font-weight:700}
.fk-tbl tr.fk-total td.tbl-h{color:#fff}
/* textimage: bullets + gradient-framed image with zoom loupe */
.ti-wrap{display:grid;grid-template-columns:.4fr .6fr;gap:clamp(1.6rem,3vw,3.2rem);align-items:center;margin-top:1rem;width:100%}
.ti-frame{position:relative;border-radius:24px;padding:9px;background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:2.5px solid transparent;box-shadow:0 30px 70px -34px rgba(139,92,246,.5)}
.ti-img{width:100%;max-height:62vh;object-fit:contain;border-radius:16px;display:block;cursor:zoom-in}
.ti-loupe{position:absolute;left:16px;bottom:16px;width:clamp(150px,15vw,230px);aspect-ratio:1;border-radius:50%;padding:4px;background:var(--grad);box-shadow:0 26px 60px -16px rgba(17,20,36,.45);opacity:0;transition:opacity .18s;pointer-events:none;z-index:6}
.ti-lens{width:100%;height:100%;border-radius:50%;background:#fff no-repeat}
/* servicemetrics: speed cards + resolution + CSAT verbatims */
.sv-wrap{display:grid;grid-template-columns:1.02fr .98fr;gap:clamp(1.6rem,3vw,3rem);align-items:start;margin-top:1rem;width:100%}
.sv-lhead{display:flex;align-items:center;gap:.8rem;font-size:clamp(1.15rem,1.5vw,1.55rem);color:var(--ink);font-weight:600}
.sv-lic{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:14px;background:var(--grad);color:#fff}
.sv-lic svg,.sv-ric svg{width:24px;height:24px}
.sv-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(.8rem,1.4vw,1.3rem);margin-top:1.1rem}
.sv-card{border-radius:18px;padding:clamp(.9rem,1.5vw,1.4rem);text-align:center;background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:2px solid transparent}
.sv-cic{display:inline-flex;align-items:center;justify-content:center;width:clamp(42px,3vw,52px);height:clamp(42px,3vw,52px);border-radius:50%;background:var(--grad);color:#fff}
.sv-cic svg{width:50%;height:50%}
.sv-clabel{font-size:clamp(.85rem,1vw,1rem);color:var(--body);margin-top:.45rem}
.sv-val{font-family:var(--disp);font-weight:600;font-size:clamp(1.7rem,2.4vw,2.5rem);color:var(--purple);line-height:1.05;margin-top:.2rem}
.sv-val small{font-size:.45em;font-weight:500;margin-left:.15em;color:var(--body)}
.sv-up{color:var(--green);font-weight:700;margin-left:.2em}
.sv-up.big{font-size:1.6em}
.sv-pill{display:inline-block;margin-top:.55rem;padding:.3rem .8rem;border-radius:999px;background:var(--grad);color:#fff;font-weight:600;font-size:clamp(.7rem,.85vw,.85rem);white-space:nowrap}
.sv-res{display:flex;align-items:center;gap:1.1rem;margin-top:1.2rem;border-radius:18px;padding:clamp(1rem,1.6vw,1.5rem);background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:2px solid transparent}
.sv-ric{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:52px;height:52px;border-radius:50%;background:#eaf1ff;color:var(--blue)}
.sv-rlabel{font-size:clamp(.95rem,1.15vw,1.2rem);color:var(--ink);font-weight:600}
.sv-rval{font-family:var(--disp);font-weight:600;font-size:clamp(1.9rem,2.6vw,2.7rem);color:var(--blue);line-height:1.05}
.sv-kpi{margin-left:auto;min-width:34%;text-align:left}
.sv-kpi span{font-family:var(--mono);font-weight:700;font-size:.8rem;color:var(--ink)}
.sv-bar{margin-top:.45rem;height:10px;border-radius:999px;background:#eceafb;overflow:hidden}
.sv-bar i{display:block;height:100%;border-radius:999px;background:var(--grad)}
.sv-csat{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.sv-cv{font-family:var(--disp);font-weight:600;font-size:clamp(2rem,3vw,3.1rem);background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.sv-cl{font-size:clamp(1.2rem,1.7vw,1.75rem);color:var(--ink);font-weight:600}
.sv-vhead{display:flex;align-items:center;gap:.75rem;margin-top:1rem;font-family:var(--disp);font-weight:600;font-size:clamp(1.3rem,1.8vw,1.85rem);color:var(--ink)}
.sv-q{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:var(--grad);color:#fff;font-size:1.05rem;letter-spacing:-.12em;padding-bottom:.35em}
.sv-verbs{display:flex;flex-direction:column;gap:.7rem;margin-top:.9rem}
.sv-verb{display:flex;align-items:center;gap:.85rem;border-radius:16px;padding:.7rem 1rem;background:#eaf1ff}
.sv-verb.alt{background:#f5edff}
.sv-verb p{flex:1;font-size:clamp(.92rem,1.1vw,1.12rem);color:var(--ink);line-height:1.35}
.sv-av{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#60a5fa);color:#fff}
.sv-av.alt{background:linear-gradient(135deg,#8b5cf6,#8b5cf6)}
.sv-av svg{width:58%;height:58%}
.sv-stars{color:#f6b83c;font-size:.95rem;letter-spacing:.12em;white-space:nowrap}
/* deals: pins around a central illustration */
.dl{width:100%}
.dl>h2{text-align:center;margin-inline:auto}
.dl-grid{display:grid;grid-template-columns:1fr 1.3fr 1fr;gap:clamp(1.4rem,3vw,3rem);align-items:start;margin-top:1rem;width:100%}
.dl-col{display:flex;flex-direction:column;gap:clamp(2.5rem,6vh,4.5rem);padding-top:1.2rem}
.dl-mid{display:flex;flex-direction:column;align-items:center;gap:.6rem}
.dl-img{width:100%;max-height:52vh;object-fit:contain}
.dl-pin{display:flex;flex-direction:column;align-items:center;text-align:center;gap:.55rem}
.dl-dot{width:44px;height:44px;border-radius:50%;border:2.5px solid var(--purple);display:flex;align-items:center;justify-content:center}
.dl-dot i{width:26px;height:26px;border-radius:50%;background:var(--grad)}
.dl-pin p{font-size:clamp(1rem,1.3vw,1.35rem);color:var(--ink);line-height:1.3;text-wrap:balance;max-width:24ch}
/* suppliers: regional panels + illustration */
.sp2{display:grid;grid-template-columns:1.5fr 1fr;gap:clamp(1.6rem,3vw,3rem);align-items:center;margin-top:1rem;width:100%}
.sp2-panels{display:grid;grid-template-columns:1fr 1fr;gap:clamp(1rem,1.8vw,1.6rem)}
.sp2-panel{border-radius:22px;padding:clamp(1.2rem,1.9vw,1.8rem);background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:3px solid transparent;box-shadow:0 22px 50px -32px rgba(139,92,246,.55)}
.sp2-panel.tall{grid-row:span 2}
.sp2-panel h3{font-family:var(--disp);font-weight:700;font-size:clamp(1.2rem,1.6vw,1.6rem);color:var(--ink)}
.sp2-items{margin-top:.9rem;position:relative;display:flex;flex-direction:column;gap:1.05rem;padding-left:1.5rem}
.sp2-items::before{content:"";position:absolute;left:6px;top:6px;bottom:6px;border-left:1.5px solid #c9c2ee}
.sp2-it{position:relative}
.sp2-it i{position:absolute;left:-1.5rem;top:.28em;width:13px;height:13px;border-radius:50%;border:2.5px solid var(--purple);background:#fff}
.sp2-it span{font-size:clamp(.95rem,1.15vw,1.2rem);color:var(--ink)}
.sp2-illo img{width:100%;max-height:56vh;object-fit:contain}
/* announcements: hub-and-spoke megaphone */
.an{width:100%}
.an>h2{text-align:center;margin-inline:auto}
.an-grid{display:grid;grid-template-columns:1fr auto 1fr;gap:clamp(1.6rem,3.4vw,3.6rem);align-items:center;margin-top:clamp(1.2rem,2.4vw,2.4rem);width:100%}
.an-col{display:flex;flex-direction:column;gap:clamp(1.6rem,3.6vh,3rem)}
.an-box{position:relative;border:1.6px solid var(--purple);border-radius:16px;padding:clamp(.95rem,1.5vw,1.4rem) clamp(1rem,1.6vw,1.5rem);background:#fff;box-shadow:0 16px 38px -30px rgba(139,92,246,.6)}
.an-box p{font-size:clamp(.98rem,1.2vw,1.25rem);color:var(--ink);line-height:1.35;text-align:center;text-wrap:balance}
.an-col.l .an-box::after{content:"";position:absolute;right:-2.4rem;top:50%;width:2.4rem;border-top:2px dashed #b9a8f7}
.an-col.r .an-box::before{content:"";position:absolute;left:-2.4rem;top:50%;width:2.4rem;border-top:2px dashed #b9a8f7}
.an-mega{display:flex;align-items:center;justify-content:center;width:clamp(180px,17vw,260px);aspect-ratio:1;border-radius:50%;background:var(--grad);color:#fff;box-shadow:0 40px 90px -30px rgba(139,92,246,.7)}
.an-mega svg{width:52%;height:52%}
/* staffsat: wide highlight card + staff photo cluster */
.ss-card{display:grid;grid-template-columns:1fr .8fr;gap:clamp(1.6rem,3vw,3rem);align-items:center;width:100%;margin-top:1.4rem;border-radius:26px;padding:clamp(1.8rem,3vw,3rem);background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:2.5px solid transparent;box-shadow:0 30px 70px -40px rgba(139,92,246,.55)}
.ss-h{font-family:var(--disp);font-weight:700;font-style:italic;font-size:clamp(1.9rem,2.8vw,2.9rem);background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content}
.ss-rule{display:block;width:min(56%,300px);height:3px;border-radius:2px;background:var(--grad);margin:.7rem 0 1.2rem}
.ss-line{font-size:clamp(1.1rem,1.45vw,1.5rem);color:var(--ink);line-height:1.5;margin-top:.6rem}
.ss-circle{position:relative;width:min(100%,380px);aspect-ratio:1;justify-self:center;border-radius:50%;border:2.5px dashed #9d8bfa}
.ss-av{position:absolute;border-radius:50%;object-fit:cover;border:4px solid #fff;box-shadow:0 14px 34px -12px rgba(17,20,36,.35)}
.ss-av0{width:34%;aspect-ratio:1;left:33%;top:26%;z-index:5}
.ss-av1{width:26%;aspect-ratio:1;left:12%;top:38%;z-index:4}
.ss-av2{width:26%;aspect-ratio:1;right:12%;top:38%;z-index:4}
.ss-av3{width:22%;aspect-ratio:1;left:22%;top:14%;z-index:3}
.ss-av4{width:22%;aspect-ratio:1;right:22%;top:14%;z-index:3}
.ss-av5{width:24%;aspect-ratio:1;left:20%;bottom:12%;z-index:4}
.ss-av6{width:24%;aspect-ratio:1;right:20%;bottom:12%;z-index:4}
/* features: gradient-bordered cards, fixed grid (4 -> 2x2) — matches the town-hall "What's Here" slide */
.ft-grid{display:grid;gap:clamp(1.2rem,1.9vw,1.9rem);margin-top:clamp(1.8rem,3vw,2.6rem);text-align:left}
.ft-grid.ft-n4{grid-template-columns:1fr 1fr}
.ft-grid.ft-n6,.ft-grid.ft-n5,.ft-grid.ft-n3{grid-template-columns:repeat(3,1fr)}
.ft-grid.ft-n2{grid-template-columns:1fr 1fr}
.ft-grid.ft-n1{grid-template-columns:1fr}
.ft-card{border-radius:22px;padding:clamp(1.5rem,2.2vw,2.4rem);background:linear-gradient(#fff,#fff) padding-box,var(--grad) border-box;border:2.5px solid transparent;box-shadow:0 20px 48px -30px rgba(139,92,246,.45);transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s}
.ft-card:hover{transform:translateY(-4px);box-shadow:0 30px 60px -28px rgba(139,92,246,.55)}
.ft-ic{display:inline-flex;align-items:center;justify-content:center;width:clamp(48px,3.4vw,58px);height:clamp(48px,3.4vw,58px);border-radius:16px;background:var(--grad);color:#fff;box-shadow:0 10px 24px -10px rgba(139,92,246,.55);margin-bottom:clamp(.8rem,1.4vw,1.15rem)}
.ft-ic svg{width:56%;height:56%}
.ft-card h3{font-family:var(--disp);font-weight:600;font-size:clamp(1.25rem,1.7vw,1.75rem);color:var(--ink);line-height:1.1;text-wrap:balance}
.ft-card p{font-size:clamp(1.02rem,1.25vw,1.32rem);color:var(--body);line-height:1.4;margin-top:.6rem;text-wrap:balance}
@media(max-width:900px){.ft-grid.ft-n6,.ft-grid.ft-n5,.ft-grid.ft-n4,.ft-grid.ft-n3,.ft-grid.ft-n2{grid-template-columns:1fr}}
/* showcase: real app screenshot in a device panel (master module-slide look) */
.sw-split{display:grid;grid-template-columns:.82fr 1.18fr;gap:clamp(2rem,4vw,4.5rem);align-items:center;margin-top:1rem}
.sw-copy ul{margin-top:1.2rem}
.sw-panel{border-radius:22px;padding:10px;background:linear-gradient(150deg,#1b1140,#0f1424);box-shadow:0 40px 100px -30px rgba(139,92,246,.5);border:1px solid rgba(139,92,246,.25)}
.sw-panel img{width:100%;display:block;border-radius:14px}
/* people: leadership / team grid with source headshots */
.ppl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(1.2rem,2vw,2rem);margin-top:2rem;width:100%}
.ppl-grid.four{grid-template-columns:repeat(2,1fr)}
.ppl-card{display:flex;align-items:center;gap:1.1rem;background:#fff;border:1px solid var(--border);border-radius:20px;padding:clamp(1rem,1.4vw,1.4rem);box-shadow:var(--shadow-sm)}
.ppl-photo{flex:0 0 auto;width:88px;height:88px;border-radius:50%;overflow:hidden;background:var(--grad);display:flex;align-items:center;justify-content:center}
.ppl-photo img{width:100%;height:100%;object-fit:cover}
.ppl-init{font-family:var(--disp);color:#fff;font-size:2rem}
.ppl-name{font-family:var(--disp);font-weight:500;font-size:clamp(1.1rem,1.4vw,1.35rem);color:var(--ink)}
.ppl-role{font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em;font-size:.72rem;color:var(--purple);margin-top:.25rem}
.ppl-note{color:var(--body);font-size:.98rem;margin-top:.4rem;line-height:1.4}
/* video: embedded source Vimeo/YouTube */
.vid-frame{margin-top:1.6rem;width:min(100%,1000px);aspect-ratio:16/9;border-radius:20px;overflow:hidden;box-shadow:0 40px 100px -30px rgba(139,92,246,.5);border:1px solid rgba(139,92,246,.2);background:#0f1424}
.vid-frame iframe{width:100%;height:100%;border:0;display:block}
.vid-link a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8rem;height:100%;color:#fff;text-decoration:none;font-family:var(--mono);letter-spacing:.05em;text-transform:uppercase;font-size:.85rem}
.vid-play{width:70px;height:70px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:1.6rem;padding-left:6px}
.cap{margin-top:.9rem;color:var(--muted);font-family:var(--mono);font-size:.8rem}
.cap a{color:var(--purple)}
/* timeline: milestones on a line */
.tl{position:relative;width:100%;margin-top:clamp(2rem,4vw,3.5rem);padding:clamp(7rem,12vw,10rem) .5rem}
.tl-line{position:absolute;left:1.5%;right:1.5%;top:50%;height:4px;transform:translateY(-50%);background:linear-gradient(90deg,#8b5cf6,#8b5cf6,#3b82f6);border-radius:3px;z-index:0}
.tl-nodes{position:relative;display:flex;justify-content:space-between;align-items:center}
.tl-node{position:relative;flex:1 1 0;display:flex;justify-content:center}
.tl-dot{width:18px;height:18px;border-radius:50%;background:var(--ink);border:4px solid #fff;box-shadow:0 0 0 3px var(--purple);z-index:2}
.tl-card{position:absolute;left:50%;transform:translateX(-50%);width:min(96%,15rem);text-align:center}
.tl-card.tl-above{bottom:calc(100% + 18px)}
.tl-card.tl-below{top:calc(100% + 18px)}
.tl-year{font-family:var(--disp);font-weight:500;font-size:clamp(1.3rem,2vw,2rem);color:var(--ink);line-height:1.1}
.tl-label{font-weight:600;color:var(--purple);font-size:.9rem;margin-top:.25rem;text-wrap:balance}
.tl-note{color:var(--body);font-size:.8rem;margin-top:.25rem;line-height:1.35;text-wrap:balance}
/* table: pricing / specs / tiers */
.tbl-wrap{width:100%;margin-top:1.6rem;overflow-x:auto}
.tbl{width:100%;border-collapse:collapse;font-size:clamp(.86rem,1vw,1.02rem)}
.tbl th{text-align:left;font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em;font-size:.74rem;color:#fff;background:var(--grad);padding:.8rem .9rem;border:0}
.tbl thead th:first-child{border-radius:12px 0 0 12px}.tbl thead th:last-child{border-radius:0 12px 12px 0}
.tbl tbody tr:nth-child(even) td{background:#f7f5ff}
.tbl td{padding:.7rem .9rem;border-bottom:1px solid var(--border-soft);color:var(--body)}
.tbl td.tbl-h{color:var(--ink);font-weight:600}
.tbl tbody tr:nth-child(even){background:#faf9ff}
/* people + video on one slide */
.ppl-vid{display:grid;grid-template-columns:1fr 1.15fr;gap:clamp(1.5rem,3vw,3rem);align-items:center;margin-top:1.4rem;width:100%}
.ppl-vid .ppl-grid{grid-template-columns:1fr;margin-top:0}
.ppl-vid-r .vid-frame{margin-top:0}
/* celebration: promotion / award / recognition — one person, big photo, fills the slide */
.cel{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(2rem,4.5vw,5rem);align-items:center;width:100%;position:relative}
.cel-body{position:relative;z-index:1}
.cel-name{font-family:var(--disp);font-weight:600;font-size:clamp(2.5rem,4.6vw,4.6rem);line-height:1.02;letter-spacing:-.02em;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;margin:0;text-transform:uppercase}
.cel-eyebrow{display:block;font-size:clamp(1.05rem,1.4vw,1.45rem);color:var(--ink);margin-top:.45rem}
.cel-rule{display:block;width:min(58%,300px);height:2px;background:linear-gradient(90deg,var(--purple),rgba(139,92,246,.15));margin:1.1rem 0 1.3rem;position:relative}
.cel-rule::after{content:"";position:absolute;right:0;top:50%;transform:translate(50%,-50%);width:9px;height:9px;border-radius:50%;background:var(--purple)}
.cel-msg{font-size:clamp(1.02rem,1.35vw,1.4rem);color:var(--body);line-height:1.5;max-width:34ch}
.cel-pill{display:inline-block;margin-top:1.5rem;padding:.68rem 1.6rem;border-radius:999px;background:var(--grad);color:#fff;font-weight:600;font-size:clamp(.92rem,1.15vw,1.15rem);white-space:nowrap;box-shadow:0 12px 30px rgba(139,92,246,.35)}
.cel-figure{position:relative;z-index:1;justify-self:center;width:min(100%,440px);aspect-ratio:1}
.cel-photo{position:relative;width:100%;height:100%;border-radius:50%;padding:6px;background:var(--grad);box-shadow:0 40px 90px -34px rgba(139,92,246,.5)}
.cel-photo img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}
.cel-init{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f3efff;color:var(--purple);border-radius:50%;font-family:var(--disp);font-weight:600;font-size:6rem}
.cel-emblem{position:absolute;top:1%;left:6%;z-index:3;width:clamp(46px,5vw,74px);height:clamp(46px,5vw,74px);border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(17,24,39,.16);padding:15%}
.cel-emblem img{width:100%;height:100%;object-fit:contain}
@media(max-width:900px){.cel{grid-template-columns:1fr;text-align:center}.cel-rule{margin-inline:auto}}
/* vision: brand target centre, icon points flanking (master-deck Vision look) */
.vt{width:100%}
/* the target is a centred composition, so cancel the nav's asymmetric left padding for this slide
   (otherwise the whole thing is shoved right of the slide centre) and instead inset the LEFT points
   enough to clear the fixed sidenav. keeps the bullseye on the true horizontal centre of the slide. */
.sl:has(.vt){padding-left:clamp(3rem,7.5vw,8rem)}
.sl:has(.vt) .in{max-width:none}
.vt-body .vt-col:first-child{padding-left:clamp(6rem,9vw,10rem)}
.vt-head{text-align:center}
.vt-head h2{font-family:var(--disp);font-weight:500;font-size:clamp(2.4rem,4.4vw,4rem);background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;margin-top:.3rem}
.vt-head .eyebrow{color:var(--body);font-family:inherit;text-transform:none;letter-spacing:0;font-size:clamp(1rem,1.3vw,1.25rem);font-weight:400}
.vt-body{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:clamp(1.5rem,3vw,3.5rem);align-items:center;margin-top:clamp(1.5rem,3vw,3rem)}
.vt-tgt{width:clamp(230px,22vw,340px);height:auto;filter:drop-shadow(0 26px 52px rgba(139,92,246,.3))}
.vt-tgt-wrap{display:flex;justify-content:center}
.vt-col{display:flex;flex-direction:column;gap:clamp(1.4rem,2.6vw,2.6rem)}
.vt-pt{display:flex;align-items:flex-start;gap:1rem}
.vt-pt.r{flex-direction:row-reverse;text-align:right}
.vt-ic{flex:0 0 auto;width:52px;height:52px;border-radius:14px;background:#f3efff;color:var(--purple);display:flex;align-items:center;justify-content:center}
.vt-ic svg{width:26px;height:26px}
.vt-pt-h{font-family:var(--disp);font-weight:500;font-size:clamp(1.15rem,1.5vw,1.5rem);color:var(--ink);line-height:1.1}
.vt-pt-t{color:var(--body);font-size:clamp(.9rem,1.1vw,1.05rem);margin-top:.3rem}
@media(max-width:900px){.vt-body{grid-template-columns:1fr}.vt-tgt-wrap{order:-1}.vt-pt.r{flex-direction:row;text-align:left}}
/* mission: dominant statement hero + supporting icon cards */
.mn2{display:grid;grid-template-columns:1.05fr 1fr;gap:clamp(1.5rem,2.5vw,2.4rem);margin-top:1.6rem;align-items:stretch}
.mn2-hero{background:var(--grad-deep);border-radius:28px;padding:clamp(2rem,3vw,3rem);color:#fff;display:flex;flex-direction:column;justify-content:center;box-shadow:0 40px 90px -40px rgba(139,92,246,.5)}
.mn2-hero .eyebrow{color:#c9b8ff}
.mn2-stmt{font-family:var(--disp);font-weight:400;font-size:clamp(1.4rem,2.2vw,2.3rem);line-height:1.22;margin-top:1rem;text-wrap:balance;color:#fff}
.mn2-cards{display:flex;flex-direction:column;gap:clamp(.8rem,1.4vw,1.1rem)}
.mn2-card{flex:1;display:flex;align-items:center;gap:1rem;background:#fff;border:1px solid var(--border);border-radius:20px;padding:clamp(1.1rem,1.6vw,1.5rem);box-shadow:0 18px 38px -30px rgba(17,24,39,.3)}
.mn2-ic{flex:0 0 auto;width:48px;height:48px;border-radius:13px;background:#f3efff;color:var(--purple);display:flex;align-items:center;justify-content:center}
.mn2-ic svg{width:25px;height:25px}
.mn2-h{font-family:var(--disp);font-weight:500;font-size:clamp(1.05rem,1.4vw,1.35rem);color:var(--ink)}
.mn2-t{color:var(--body);font-size:clamp(.88rem,1.05vw,1rem);margin-top:.25rem;line-height:1.4}
@media(max-width:900px){.mn2{grid-template-columns:1fr}}
/* awards: celebratory recognition grid (peak performance) */
.aw-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:clamp(1rem,1.6vw,1.4rem);margin-top:1.8rem}
.aw-card{display:flex;gap:1rem;align-items:flex-start;background:linear-gradient(135deg,#f7f2ff,#eef3ff);border:1px solid #e4dcff;border-radius:20px;padding:clamp(1.1rem,1.6vw,1.5rem)}
.aw-ic{flex:0 0 auto;width:46px;height:46px;border-radius:12px;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 22px -10px rgba(139,92,246,.65)}
.aw-ic svg{width:24px;height:24px}
.aw-name{font-family:var(--disp);font-weight:500;font-size:clamp(1.1rem,1.4vw,1.4rem);color:var(--purple)}
.aw-note{color:var(--body);font-size:clamp(.9rem,1.05vw,1.02rem);margin-top:.3rem;line-height:1.4}
.aw-by{display:inline-block;margin-top:.6rem;font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em;font-size:.68rem;color:var(--purple);background:#fff;border-radius:999px;padding:3px 10px}
@media(max-width:900px){.aw-grid{grid-template-columns:1fr}}
/* teamgrid: department team, master-deck style (name + underline + role, round photo below) */
.tg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(1.5rem,2.6vw,2.6rem);margin-top:2rem}
.tg-name{font-family:var(--disp);font-weight:500;font-size:clamp(1.2rem,1.6vw,1.7rem);color:var(--ink)}
.tg-line{height:3px;background:var(--grad);border-radius:3px;margin:.5rem 0 .5rem}
.tg-role{color:var(--body);font-size:clamp(.9rem,1.1vw,1.05rem)}
.tg-ph{margin-top:1rem;width:clamp(120px,10vw,150px);aspect-ratio:1;border-radius:50%;overflow:hidden;background:var(--grad);display:flex;align-items:center;justify-content:center}
.tg-ph img{width:100%;height:100%;object-fit:cover}
.tg-init{color:#fff;font-family:var(--disp);font-size:3rem}
@media(max-width:1000px){.tg-grid{grid-template-columns:repeat(2,1fr)}}
/* map: world silhouette + region bubbles + flag legend */
.map-wrap{display:grid;grid-template-columns:.55fr 1.9fr;gap:clamp(1.5rem,3vw,3rem);align-items:center;margin-top:1rem;width:100%}
.map-viewport{position:relative;overflow:hidden;border-radius:22px;max-height:66vh;width:100%;background:#f2f4fb;margin:auto}
.map-zoom{position:absolute;display:block;opacity:.55;filter:saturate(.5) brightness(1.25)}
.map-pin{position:absolute;transform:translate(-50%,-50%);z-index:3}
.map-pin i{display:block;width:20px;height:20px;border-radius:50%;border:3.5px solid #fff;box-shadow:0 6px 18px rgba(17,20,36,.35)}
.map-pin.a i{background:var(--grad)}
.map-pin.b i{background:#f43f5e}
.map-pin-lbl{position:absolute;left:50%;bottom:130%;transform:translateX(-50%);white-space:nowrap;background:#fff;color:var(--ink);font-weight:600;font-size:clamp(.72rem,.95vw,.95rem);padding:.32rem .7rem;border-radius:999px;box-shadow:0 10px 26px -8px rgba(17,20,36,.35)}
.map-pin-lbl.below{bottom:auto;top:130%}
.map-canvas{position:relative;width:100%}
.map-img{width:100%;display:block;opacity:.92}
.map-bub{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-family:var(--disp);font-weight:500;font-size:clamp(.85rem,1.05vw,1.15rem);box-shadow:0 12px 34px -8px rgba(0,0,0,.45);border:2px solid rgba(255,255,255,.5)}
.map-bub.a{background:rgba(139,92,246,.92)}
.map-bub.b{background:rgba(244,63,94,.92)}
.map-legend{display:flex;flex-direction:column;gap:1.4rem}
.map-leg-grp{display:flex;flex-direction:column;gap:.55rem}
.map-leg-title{font-family:var(--disp);font-weight:500;font-size:1.05rem;color:var(--ink);display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem}
.map-leg-item{color:var(--body);font-size:1rem;display:flex;align-items:center;gap:.55rem}
.map-leg-item b{color:var(--ink)}
.map-leg-flag{font-size:1.2rem;line-height:1}
.map-leg-dot{width:14px;height:14px;border-radius:50%;flex:0 0 auto}
.map-leg-dot.a{background:var(--purple)}.map-leg-dot.b{background:#f43f5e}
/* columns: side-by-side comparison lists */
.cmp-grid{display:grid;gap:clamp(1.5rem,3vw,3.5rem);margin-top:2rem;width:100%;align-items:start}
.cmp-head{font-family:var(--disp);font-weight:500;font-size:clamp(1.3rem,1.8vw,1.7rem);color:var(--ink);padding-bottom:.7rem;border-bottom:2px solid var(--border);margin-bottom:1.1rem}
.cmp-item{display:flex;gap:.7rem;padding:.55rem 0}
.cmp-dot{flex:0 0 auto;width:.6rem;height:.6rem;border-radius:50%;background:var(--grad);margin-top:.55em}
.cmp-label{color:var(--ink);font-weight:500;font-size:1.02rem;line-height:1.35}
.cmp-note{color:var(--body);font-size:.88rem;line-height:1.35;margin-top:.15rem}
.cmp-total{margin-top:1.2rem;display:inline-block;background:var(--grad);color:#fff;font-family:var(--disp);font-size:1.15rem;padding:.5rem 1.3rem;border-radius:999px}
/* custom: AI-designed brand-locked slide body */
@media(max-width:1100px){.solve-grid{grid-template-columns:1fr 1fr}.solve-hero{grid-row:auto;grid-column:span 2}.res-row{grid-template-columns:1fr}.steps6,.steps4{grid-template-columns:repeat(2,1fr)}.split2,.sw-split{grid-template-columns:1fr}.mod-card.wide{grid-column:span 1}.ppl-grid,.ppl-grid.four{grid-template-columns:1fr 1fr}.map-wrap{grid-template-columns:1fr}}
@media(max-width:820px){.row{grid-template-columns:1fr}}
/* ===== master shell chrome (sidenav / rail / arrows / progress) — from deck.css ===== */
.sl{padding-left:clamp(13rem,15vw,15.5rem)}
.cover .in,.sl .in{margin-left:0}
.pp-sidenav{position:fixed;left:0;top:0;bottom:0;width:14.5rem;display:flex;flex-direction:column;justify-content:center;gap:.08rem;padding:2rem 1.3rem;z-index:40}
/* collapse the left slide-menu: a small close button, and a slim vertical tab to reopen it */
.pp-navclose{position:absolute;top:1.1rem;right:.7rem;width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:rgba(255,255,255,.65);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1rem;line-height:1;z-index:42;transition:color .2s,border-color .2s}
.pp-navclose:hover{color:var(--purple);border-color:#dcd4ff}
.pp[data-navbg=grad] .pp-navclose{border-color:rgba(255,255,255,.4);background:rgba(255,255,255,.14);color:#fff}
.pp-navtab{position:fixed;left:0;top:50%;transform:translateY(-50%);width:22px;height:76px;border:0;border-radius:0 12px 12px 0;background:var(--grad);color:#fff;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:.95rem;z-index:42;box-shadow:0 12px 34px rgba(139,92,246,.4)}
.pp.nav-collapsed .pp-sidenav{display:none}
.pp.nav-collapsed .pp-navtab{display:flex}
.pp.nav-collapsed .sl:not(.cover){padding-left:clamp(3rem,7vw,8rem)}
.pp.nav-collapsed .pp-slidenum{left:clamp(3rem,7vw,8rem)}
.pp-sidenav.dense{gap:.05rem;padding:5.4rem 1.1rem 1.4rem;overflow-y:auto;justify-content:center}
.pp-sidenav.xdense{width:12.6rem;padding:5rem .9rem 1.2rem}
.pp-logo-stack{position:absolute;top:1.5rem;left:1.4rem;height:52px}
.pp-logo-stack img{height:52px;width:auto;object-fit:contain}
.pp-logo-w{display:none}
.pp[data-navbg=grad] .pp-logo-c{display:none}
.pp[data-navbg=grad] .pp-logo-w{display:inline-block}
.pp-sidenav.xdense .pp-logo-stack,.pp-sidenav.xdense .pp-logo-stack img{height:44px}
.pp-sidenav__item{position:relative;display:flex;align-items:center;gap:.6rem;padding:.4rem .7rem .4rem 3.4rem;border:0;background:0 0;color:var(--muted);font-family:var(--mono);font-size:.68rem;letter-spacing:.03em;font-weight:600;cursor:pointer;text-align:left;border-radius:8px;text-transform:uppercase}
.pp-sidenav.dense .pp-sidenav__item{font-size:.5rem;padding:.12rem .6rem .12rem 2.2rem}
.pp-sidenav.xdense .pp-sidenav__item{font-size:.4rem;padding:.06rem .5rem .06rem 1.7rem;letter-spacing:.01em}
.pp-sidenav__item .bar{position:absolute;left:2.4rem;top:50%;transform:translateY(-50%);width:14px;height:2px;background:var(--border);border-radius:2px;transition:all .3s}
.pp-sidenav.dense .pp-sidenav__item .bar{left:1.2rem;width:9px}
.pp-sidenav.xdense .pp-sidenav__item .bar{left:1rem;width:7px}
.pp-sidenav__item span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-sidenav__item.on{color:#fff;background:var(--grad)}
.pp-sidenav__item.on .bar{display:none}
.pp[data-navbg=grad] .pp-sidenav__item{color:rgba(255,255,255,.85)}
.pp[data-navbg=grad] .pp-sidenav__item .bar{background:rgba(255,255,255,.5)}
.pp[data-navbg=grad] .pp-sidenav__item.on{background:#fff}
.pp[data-navbg=grad] .pp-sidenav__item.on span{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.pp-railbox{position:fixed;right:clamp(12px,2vw,26px);top:50%;transform:translateY(-50%);z-index:40;display:flex;flex-direction:column;align-items:center;gap:12px;max-height:90vh}
.pp-rail{display:flex;flex-direction:column;align-items:center;gap:11px;overflow:hidden}
.pp-rail.dense{gap:5px}
.pp-rail.xdense{gap:3px}
.pp-rail button{width:9px;height:9px;border-radius:50%;border:0;background:#d8d5ea;cursor:pointer;padding:0;flex:0 0 auto;transition:all .3s}
.pp-rail.dense button{width:6px;height:6px}
.pp-rail.xdense button{width:4px;height:4px}
.pp-rail button.on{background:var(--purple);transform:scale(1.4)}
.pp[data-navbg=grad] .pp-rail button{background:rgba(255,255,255,.5)}
.pp[data-navbg=grad] .pp-rail button.on{background:#fff}
.pp-arrow{flex:0 0 auto;z-index:40;width:34px;height:34px;border-radius:50%;border:0;background:var(--grad);color:#fff;font-size:1rem;cursor:pointer;box-shadow:var(--shadow-sm);display:flex;align-items:center;justify-content:center}
.pp-railbox.dense .pp-arrow{width:30px;height:30px;font-size:.9rem}
.pp-railbox.xdense .pp-arrow{width:26px;height:26px;font-size:.8rem}
.pp-progress{position:fixed;top:0;left:0;right:0;height:3px;background:var(--grad);transform-origin:left;z-index:50;transition:transform .3s}
.pp-slidenum{position:fixed;bottom:1.3rem;left:clamp(13rem,15vw,15.5rem);font-family:var(--mono);font-size:.7rem;color:var(--muted);z-index:40}
/* EXPORT mode (PDF / PPTX): no interactive chrome — hide the left slide-name nav, the right arrows/dots rail,
   the top progress bar and the nav tab/close. Keep ONLY the bottom page count. Reclaim the nav's left padding. */
.pp.pp-export .pp-sidenav,.pp.pp-export .pp-railbox,.pp.pp-export .pp-navclose,.pp.pp-export .pp-navtab,.pp.pp-export .pp-progress{display:none!important}
.pp.pp-export .sl{padding-left:clamp(2.6rem,6vw,5rem)!important;padding-right:clamp(2.6rem,6vw,5rem)!important}
.pp.pp-export .pp-slidenum{left:clamp(2.6rem,6vw,5rem)}
.pp[data-navbg=grad] .pp-slidenum{color:rgba(255,255,255,.8)}
/* ===== style2 (Brand Kit balanced palette): calmer titles, rotating accents ===== */
.style2 .lt .in>h2{background:none;-webkit-background-clip:initial;background-clip:initial;color:#0f172a;position:relative;padding-bottom:.35em}
.style2 .lt .in>h2::after{content:"";position:absolute;left:2px;bottom:0;width:2.2em;height:5px;border-radius:3px;background:var(--grad)}
.style2 .ft-card{background:#fff;border:1.5px solid #e6e4f2;box-shadow:0 18px 44px -34px rgba(15,23,42,.35)}
.style2 .ft-grid>.ft-card:nth-child(4n+1) .ft-ic{background:#f1e3ff;color:#7c3aed}
.style2 .ft-grid>.ft-card:nth-child(4n+2) .ft-ic{background:#e4efff;color:#0ea5e9}
.style2 .ft-grid>.ft-card:nth-child(4n+3) .ft-ic{background:#dff9fa;color:#0d9488}
.style2 .ft-grid>.ft-card:nth-child(4n+4) .ft-ic{background:#ffe7ee;color:#f43f5e}
.style2 .ft-card:hover{box-shadow:0 26px 54px -30px rgba(15,23,42,.4)}
.style2 .mx-card{border:1.5px solid #e6e4f2;background:#fff}
.style2 .mx-cards>.mx-card:nth-child(4n+1) .mx-ic{background:#7c3aed}
.style2 .mx-cards>.mx-card:nth-child(4n+2) .mx-ic{background:#0ea5e9}
.style2 .mx-cards>.mx-card:nth-child(4n+3) .mx-ic{background:#14b8a6}
.style2 .mx-cards>.mx-card:nth-child(4n+4) .mx-ic{background:#0f172a}
.style2 .mx-card.fill{background:#0f172a;border-color:#0f172a}
.style2 .mx-cards>.mx-card:nth-child(4n+1) .mx-val{color:#7c3aed}
.style2 .mx-cards>.mx-card:nth-child(4n+2) .mx-val{color:#0ea5e9}
.style2 .mx-cards>.mx-card:nth-child(4n+3) .mx-val{color:#0d9488}
.style2 .cfo-band>div:nth-child(4n+1){background:#7c3aed}
.style2 .cfo-band>div:nth-child(4n+2){background:#0f172a}
.style2 .cfo-band>div:nth-child(4n+3){background:#0ea5e9}
.style2 .cfo-band>div:nth-child(4n+4){background:linear-gradient(135deg,#14b8a6,#0ea5e9)}
.style2 .chiprow .chip:nth-child(3n+2){color:#0ea5e9;background:#e4efff}
.style2 .chiprow .chip:nth-child(3n+3){color:#0d9488;background:#dff9fa}
.style2 .aw-grid>.aw-card:nth-child(3n+2) .aw-ic{background:#0ea5e9}
.style2 .aw-grid>.aw-card:nth-child(3n+3) .aw-ic{background:#14b8a6}
.style2 .aw-name{color:#0f172a}
.style2 .tbl th{background:#0f172a}
.style2 .fk-tbl tr.fk-total td{background:#0f172a}
.style2 .step .k{color:#7c3aed}
.style2 li:before{background:#8b5cf6}
.style2 ul li:nth-child(3n+2):before{background:#0ea5e9}
.style2 ul li:nth-child(3n+3):before{background:#14b8a6}
/* ===== deterministic diagram renderers ===== */
/* hub: centre node + radiating spokes */
.hub{position:relative;width:min(94%,64vh);aspect-ratio:1/1;margin:clamp(.6rem,2vh,1.8rem) auto 0;overflow:visible}
.hub-lines{position:absolute;inset:0;width:100%;height:100%;z-index:0;overflow:visible}
.hub-lines line{stroke:#c3b4f7;stroke-width:.4;opacity:.85}
.hub-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:clamp(78px,13vh,132px);height:clamp(78px,13vh,132px);border-radius:50%;background:#fff;box-shadow:0 14px 36px -8px rgba(139,92,246,.4);border:2px solid #efe9ff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:14px;z-index:3}
.hub-center img{width:100%;max-height:62%;object-fit:contain}
.hub-center span{font-size:.6rem;font-weight:700;color:#0f172a;text-align:center;line-height:1.05;text-wrap:balance}
.hub-node{position:absolute;transform:translate(-50%,-50%);width:clamp(78px,11.5vw,132px);min-height:clamp(42px,6.2vh,60px);background:#fff;border:1.5px solid #e6e1f7;border-radius:13px;box-shadow:0 10px 24px -12px rgba(15,23,42,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px 10px;z-index:2;text-align:center}
.hub-node img{max-width:100%;max-height:30px;width:auto;object-fit:contain}
.hub-wm{font-size:.74rem;font-weight:600;color:#0f172a;line-height:1.12;text-wrap:balance}
.hub-lbl{font-size:.58rem;color:#6b7280;line-height:1.05;text-wrap:balance}
.dk .hub-node,.dkx .hub-node{background:#1b1440;border-color:rgba(255,255,255,.14)}.dk .hub-wm,.dkx .hub-wm{color:#fff}
/* flow: pipeline of stages joined by arrows */
.flow-wrap{width:100%;margin-top:clamp(1.4rem,3vh,2.6rem)}
.flow-row{display:flex;align-items:stretch;justify-content:center}
.flow-stage{flex:1 1 0;min-width:0;background:#fff;border:1.5px solid #e6e1f7;border-radius:16px;box-shadow:0 14px 34px -20px rgba(15,23,42,.4);padding:clamp(14px,2vh,22px);display:flex;flex-direction:column;gap:8px}
.flow-h{font-weight:700;color:#0f172a;font-size:clamp(.9rem,1.2vw,1.12rem);text-align:center;padding-bottom:8px;border-bottom:2px solid #b9a7ff;margin-bottom:4px;text-wrap:balance}
.flow-items{display:flex;flex-direction:column;gap:7px}
.flow-it{background:#f7f5ff;border-radius:9px;padding:9px 11px;font-size:clamp(.78rem,1vw,.94rem);color:#333d52;text-align:center;line-height:1.3;text-wrap:balance}
.flow-arrow{flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#8b5cf6;padding:0 clamp(4px,1vw,14px)}
.flow-arrow svg{width:clamp(22px,2.4vw,34px);height:auto}
.flow-note{text-align:center;margin-top:1.3rem;color:#6b7280;font-size:.92rem;font-style:italic;text-wrap:balance}
/* ring: rows of labelled colour circles */
.ring{width:100%;margin-top:clamp(1rem,2.4vh,2rem);display:flex;flex-direction:column;gap:clamp(1rem,2.6vh,2.2rem)}
.ring-h{font-weight:600;color:#0f172a;font-size:clamp(1rem,1.35vw,1.28rem)}
.ring-row{display:flex;flex-wrap:wrap;gap:clamp(.9rem,2vw,2rem);justify-content:center}
.ring-c{flex:0 0 auto;width:clamp(94px,13vw,152px);height:clamp(94px,13vw,152px);border-radius:50%;display:flex;align-items:center;justify-content:center;padding:12px;box-shadow:0 16px 32px -14px rgba(15,23,42,.5)}
.ring-c span{color:#fff;font-weight:600;font-size:clamp(.72rem,.98vw,.94rem);text-align:center;line-height:1.16;text-wrap:balance}
/* venn: two overlapping circles + optional shared middle */
.venn{position:relative;width:100%;height:clamp(300px,54vh,470px);margin-top:1.2rem}
.venn-c{position:absolute;top:50%;transform:translateY(-50%);width:clamp(240px,42%,420px);aspect-ratio:1/1;border-radius:50%}
.venn-l{left:11%;background:radial-gradient(circle,rgba(139,92,246,.18),rgba(139,92,246,.08));border:2px solid rgba(139,92,246,.55)}
.venn-r{right:11%;background:radial-gradient(circle,rgba(59,130,246,.16),rgba(59,130,246,.07));border:2px solid rgba(59,130,246,.55)}
.venn-txt{position:absolute;top:50%;transform:translateY(-50%);text-align:center;z-index:3}
.venn-tl{left:13%;width:23%}.venn-tr{right:13%;width:23%}.venn-tm{left:50%;transform:translate(-50%,-50%);width:16%}
.venn-ch{font-weight:700;color:#0f172a;font-size:clamp(.86rem,1.12vw,1.08rem);margin-bottom:.55rem;text-wrap:balance}
.venn-txt>div{font-size:clamp(.72rem,.92vw,.9rem);color:#333d52;line-height:1.4;margin-bottom:.24rem;text-wrap:balance}
/* gantt: workstream rows x month columns */
.gantt-wrap{width:100%;margin-top:clamp(1rem,2.4vh,2rem);overflow-x:auto}
.gantt{min-width:600px;display:flex;flex-direction:column;gap:6px}
.gantt-row{display:grid;grid-template-columns:clamp(116px,17%,196px) 1fr;gap:12px;align-items:center}
.gantt-lbl{font-size:clamp(.75rem,.95vw,.92rem);color:#0f172a;font-weight:600;text-align:right;line-height:1.16}
.gantt-cells{display:grid;gap:3px}
.gantt-mh{font-size:.64rem;color:#9aa0b0;text-align:center;font-weight:700}
.gantt-row:not(.gantt-head) .gantt-cells{background:#f5f3fc;border-radius:8px;padding:3px;min-height:30px;align-items:center}
.gantt-bar{grid-row:1;height:clamp(20px,3vh,26px);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.62rem;font-weight:700;box-shadow:0 3px 8px rgba(15,23,42,.2);overflow:hidden;white-space:nowrap}
/* roadmap: numbered stages on a path + themes aside */
.rm{width:100%;display:flex;gap:clamp(1.4rem,3vw,3rem);align-items:flex-start;margin-top:clamp(1.6rem,3.5vh,3rem)}
.rm-track{flex:1 1 auto;position:relative;display:flex;justify-content:space-between;align-items:flex-start;padding:clamp(1.6rem,3vw,2.4rem) .5rem 0}
.rm-line{position:absolute;left:4%;right:4%;top:calc(clamp(1.6rem,3vw,2.4rem) + clamp(21px,2.5vw,30px));height:4px;background:var(--grad);border-radius:3px;z-index:0}
.rm-stage{position:relative;flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:clamp(.8rem,1.6vh,1.3rem);padding:0 .4rem}
.rm-num{width:clamp(42px,5vw,60px);height:clamp(42px,5vw,60px);border-radius:50%;background:var(--grad);color:#fff;font-family:var(--disp);font-weight:600;font-size:clamp(1.1rem,1.6vw,1.6rem);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(139,92,246,.4);z-index:2;border:4px solid #fff;flex:0 0 auto}
.rm-card{width:100%;text-align:center}
.rm-h{font-weight:700;color:#0f172a;font-size:clamp(.84rem,1.05vw,1.02rem);text-wrap:balance;line-height:1.2}
.rm-t{color:#4b5563;font-size:clamp(.72rem,.9vw,.86rem);margin-top:.3rem;line-height:1.4;text-wrap:balance}
.rm-themes{flex:0 0 clamp(200px,25%,300px);align-self:stretch;background:linear-gradient(150deg,#f5edff,#eaf1ff);border-radius:18px;padding:clamp(16px,2.4vh,26px);display:flex;flex-direction:column;justify-content:center}
.rm-th-h{font-weight:700;color:#0f172a;font-size:clamp(.95rem,1.2vw,1.16rem);margin-bottom:.8rem;text-wrap:balance}
.rm-th-i{font-size:clamp(.8rem,1vw,.94rem);color:#333d52;padding:.55rem 0;border-bottom:1px solid rgba(139,92,246,.16);line-height:1.36;text-wrap:balance}
.rm-th-i:last-child{border-bottom:0}
@media(max-width:900px){.pp-sidenav{display:none}.sl{padding-left:clamp(3rem,7vw,8rem)}.pp-slidenum{left:clamp(3rem,7vw,8rem)}.rm{flex-direction:column}.venn-c{width:60%}}`;

// nav labels for the master sidenav / rail
// filler words a nav label should drop so it reads meaningfully (e.g. "Results our customers see" -> "Results customers")
const NAV_STOP = /^(to|of|and|the|a|an|for|with|that|about|or|is|are|be|in|on|at|by|your|our|we|it|its|this|these|those|what|how|why|when|where|will|shall|can|do|does|see|so|as|from|into)$/i;
const navLabel = (s) => {
  if (s.type === "cover" || s.type === "title") return "Overview";
  if (s.type === "cta") return "Get started";
  // person slides (promotions / new starters) are named by the person, not a generic label
  let t = String((s.type === "celebration" && s.name) || s.title || s.label || s.type).replace(/[.:].*$/, "").replace(/[&,].*$/, "").trim();
  let w = t.split(/\s+/).filter(Boolean);
  // keep the MEANINGFUL words (drop filler), then take up to 2 — a clean, non-truncated label
  let meaningful = w.filter((x) => !NAV_STOP.test(x));
  if (!meaningful.length) meaningful = w;
  let label = meaningful.slice(0, 2).join(" ");
  // never cut mid-word: if still long, keep just the first meaningful word
  if (label.length > 20) label = meaningful[0].slice(0, 20);
  return label || s.type;
};
const nav = deck.slides.map(navLabel);
// scale the chrome to slide count: bigger decks get a tighter, smaller nav/rail so everything fits
const density = deck.slides.length > 34 ? " dense xdense" : deck.slides.length > 15 ? " dense" : "";
const dense = density;
// vanilla scroll-tracking that mirrors the master DeckShell (active nav/rail, progress, arrow+key nav)
const chromeJS = `(function(){var d=document.getElementById('ppdeck'),S=[].slice.call(d.querySelectorAll('.pp-slide')),NI=[].slice.call(document.querySelectorAll('.pp-sidenav__item')),RI=[].slice.call(document.querySelectorAll('.pp-rail button')),P=document.getElementById('ppprog'),SN=document.getElementById('ppnum'),W=document.getElementById('ppwrap');function dk(s){return s.classList.contains('dk')}function cur(){var h=innerHeight,a=0;for(var i=0;i<S.length;i++){if(S[i].getBoundingClientRect().top<=h/2)a=i}return a}function upd(){var a=cur();NI.forEach(function(n){n.classList.toggle('on',+n.dataset.i===a)});RI.forEach(function(r){r.classList.toggle('on',+r.dataset.i===a)});SN.textContent=('0'+(a+1)).slice(-2)+' / '+('0'+S.length).slice(-2);P.style.transform='scaleX('+((a+1)/S.length)+')';W.setAttribute('data-navbg',dk(S[a])?'grad':'light');S[a].classList.add('in');try{top.postMessage({ppSlide:a},'*')}catch(e){}}function go(i){i=Math.max(0,Math.min(S.length-1,i));S[i].scrollIntoView({behavior:'smooth'})}NI.forEach(function(n){n.onclick=function(){go(+n.dataset.i)}});RI.forEach(function(r){r.onclick=function(){go(+r.dataset.i)}});document.getElementById('ppup').onclick=function(){go(cur()-1)};document.getElementById('ppdn').onclick=function(){go(cur()+1)};addEventListener('keydown',function(e){if(['ArrowDown',' ','PageDown','ArrowRight'].indexOf(e.key)>=0){e.preventDefault();go(cur()+1)}else if(['ArrowUp','PageUp','ArrowLeft'].indexOf(e.key)>=0){e.preventDefault();go(cur()-1)}});function setNav(c){W.classList.toggle('nav-collapsed',c);try{localStorage.setItem('ppNavCollapsed',c?'1':'0')}catch(e){}}var _nc=document.getElementById('ppnavclose'),_nt=document.getElementById('ppnavtab');if(_nc)_nc.onclick=function(){setNav(true)};if(_nt)_nt.onclick=function(){setNav(false)};try{var _np=localStorage.getItem('ppNavCollapsed');if(_np==='1'||(_np===null&&W.classList.contains('pp-copy')))W.classList.add('nav-collapsed')}catch(e){}[].forEach.call(document.querySelectorAll('.ti-frame'),function(f){var img=f.querySelector('.ti-img'),lp=f.querySelector('.ti-loupe'),ln=f.querySelector('.ti-lens');if(!img||!lp||!ln)return;var Z=2.4;function mv(e){var r=img.getBoundingClientRect();var x=e.clientX-r.left,y=e.clientY-r.top;if(x<0||y<0||x>r.width||y>r.height){lp.style.opacity=0;return}lp.style.opacity=1;ln.style.backgroundImage='url("'+img.getAttribute('src')+'")';ln.style.backgroundSize=(r.width*Z)+'px '+(r.height*Z)+'px';ln.style.backgroundPosition=(-(x*Z-ln.offsetWidth/2))+'px '+(-(y*Z-ln.offsetHeight/2))+'px'}f.addEventListener('mousemove',mv);f.addEventListener('mouseleave',function(){lp.style.opacity=0})});d.addEventListener('scroll',upd,{passive:true});addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd);upd();var _hm=(location.hash||'').match(/s(\\d+)/);if(_hm){setTimeout(function(){go(+_hm[1])},80)}})();`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.title || TITLE)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="pp${STYLE2 ? " style2" : ""}${deck.slides.every((x)=>x.type==="page") ? " pp-copy" : ""}" id="ppwrap" data-navbg="light">
<div class="pp-progress" id="ppprog"></div>
<nav class="pp-sidenav${density}"><button class="pp-navclose" id="ppnavclose" aria-label="Hide menu">&#8249;</button><span class="pp-logo-stack"><img class="pp-logo-c" src="assets/logo.png" alt="Acme"><img class="pp-logo-w" src="assets/logo-allwhite.png" alt="Acme"></span>${nav.map((l, i) => `<button class="pp-sidenav__item" data-i="${i}"><span class="bar"></span><span>${esc(l)}</span></button>`).join("")}</nav>
<button class="pp-navtab" id="ppnavtab" aria-label="Show menu">&#8250;</button>
<div class="pp-slidenum" id="ppnum">01 / ${("0" + deck.slides.length).slice(-2)}</div>
<div class="pp-railbox${density}"><button class="pp-arrow up" id="ppup" aria-label="Previous">&#8593;</button>
<div class="pp-rail${density}">${nav.map((_, i) => `<button data-i="${i}" aria-label="slide ${i + 1}"></button>`).join("")}</div>
<button class="pp-arrow down" id="ppdn" aria-label="Next">&#8595;</button></div>
<div class="deck pp-deck" id="ppdeck">${deck.slides.map(slideHTML).join("")}</div>
</div>
<script>${chromeJS}</script>
<script src="/pp-edit.js" data-ppedit="1"></script>
<script src="/pp-currency.js?v=2" data-ppcur="1"></script>
</body></html>`;

fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true });
// bundle the brand font so the deck matches the master templates exactly, offline
const FONTS = process.env.BRAND_FONTS_DIR || path.join(os.homedir(), "presentation-agent", "assets", "fonts");
for (const f of ["Inter-Light.ttf", "Inter-Medium.ttf"]) {
  try { fs.copyFileSync(path.join(FONTS, f), path.join(OUT, "fonts", f)); } catch {}
}
// bundle the real brand-kit assets used by templates (cover emblem, logos)
const brandAssets = { emblem: ["gen", "emblem.png"], logo: ["acme", "logo.png"], logoWhite: ["acme", "logo-allwhite.png"] };
const haveAsset = {};
for (const [k, [dir, file]] of Object.entries(brandAssets)) {
  try { fs.copyFileSync(path.join(BRAND, dir, file), path.join(OUT, "assets", file)); haveAsset[k] = file; } catch {}
}
// copy the app screenshots referenced by showcase slides
let needMap = false;
for (const s of deck.slides) {
  if (s.type === "showcase") {
    const scr = SCREENS.includes(s.screen) ? s.screen : "home";
    // use the CURRENT (live) app UI, not the proposed redesign; fall back to the base poster if missing
    const cur = path.join(BRAND, "screens", `poster-${scr}-current.webp`);
    const base = path.join(BRAND, "screens", `poster-${scr}.webp`);
    try { fs.copyFileSync(fs.existsSync(cur) ? cur : base, path.join(OUT, "assets", `screen-${scr}.webp`)); } catch {}
  }
  if (s.type === "map") needMap = true;
  // vision slides use the real 3D dart target (extracted from the approved town-hall deck)
  if (s.type === "vision") { try { fs.copyFileSync(path.join(BRAND, "gen", "target3d.png"), path.join(OUT, "assets", "target3d.png")); } catch {} }
}
// world map asset for map slides
if (needMap) { try { fs.copyFileSync(path.join(BRAND, "gen", "worldmap.svg"), path.join(OUT, "assets", "worldmap.svg")); } catch {} }
// device cover needs the live-UI home screen
if (COVER === "device") { try { fs.copyFileSync(path.join(BRAND, "screens", "poster-home-current.webp"), path.join(OUT, "assets", "screen-home.webp")); } catch {} }
// hybrid cover: the captured short-pack device cluster (tablet + iPhone); the emblem is already copied via brandAssets
if (COVER === "hybrid") {
  // fresh filename (cover-devices3.png): the old sp-devices.png was once published cropped, and browsers
  // cache deck assets by URL — a new name guarantees no viewer ever sees the stale chopped file again
  try { fs.copyFileSync(path.join(BRAND, "gen", "sp-devices.png"), path.join(OUT, "assets", "cover-devices3.png")); } catch {}
}
// copy every source image the deck actually references: image/people slides + any assets/<file> in custom html
const copySrc = (f) => {
  if (!f) return;
  const src = fs.existsSync(path.join(ASSETS, f)) ? path.join(ASSETS, f)
    : fs.existsSync(path.join(BRAND, "gen", "brandkit", f)) ? path.join(BRAND, "gen", "brandkit", f)  // brand-kit slugs (screen-*, scene-*, card-*, device-*)
    : null;
  if (src) { try { fs.copyFileSync(src, path.join(OUT, "assets", f)); } catch {} }
};
for (const s of deck.slides) {
  if (s.image) copySrc(s.image);
  if (s.type === "people" || s.type === "teamgrid") for (const p of arr(s.people)) copySrc(p.image);
  if (s.type === "staffsat") for (const f of arr(s.images)) copySrc(f);
  if (s.type === "novel" && s.html) for (const m of String(s.html).matchAll(/assets\/([\w.\- ]+)/g)) copySrc(m[1]);
}
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.writeFileSync(path.join(OUT, "deck.json"), JSON.stringify(deck, null, 2));
{
  // asset-coverage audit: report every meaningful ingested image the deck never referenced
  const used = JSON.stringify(deck);
  const unused = [];
  for (const p2 of brief || []) for (const im of arr(p2.images)) {
    if ((im.w || 0) >= 200 && (im.h || 0) >= 140 && !used.includes(im.file)) unused.push(`${im.file} (page ${p2.page})`);
  }
  if (unused.length) console.log(`@@LOG NOTE: ${unused.length} source image(s) unused: ${unused.slice(0, 6).join(", ")}${unused.length > 6 ? "…" : ""}`);
}
console.log(`GENERATED ${deck.slides.length} slides -> ${OUT}`);
// token accounting for cost measurement (bench)
try {
  const tf = path.join(OUT, "tokens.json");
  let prev = { in: 0, out: 0, calls: 0 };
  if (fs.existsSync(tf)) { try { prev = JSON.parse(fs.readFileSync(tf, "utf8")); } catch {} }
  const total = { in: prev.in + TOK.in, out: prev.out + TOK.out, calls: prev.calls + TOK.calls };
  fs.writeFileSync(tf, JSON.stringify(total));
  console.log(`@@LOG TOKENS gen in=${TOK.in} out=${TOK.out} calls=${TOK.calls} (cumulative in=${total.in} out=${total.out})`);
} catch {}
