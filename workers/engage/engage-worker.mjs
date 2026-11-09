// Engagement deck worker (VPS, PM2 "engage-worker"). Polls the GTM app for queued prospect sales decks
// (presentations rows with engine = "engage"), then for each one:
//   read    scout the prospect's site (deep), fetch + prepare their logo and a hero photo
//   write   Claude writes the prospect-specific opening slides (engage-writer.mjs)
//   export  copy the shared engage template next to a spec.json, capture every slide, build PPTX + PDF
//   publish viewer wrapper, thumbnail, mark the row ready
// Everything lands where the Presentations module already looks: /var/www/presentation-public/<slug>/
// (deck + public downloads) and /var/www/presentation-exports/<slug>/ (authed downloads).
//
//   node engage-worker.mjs            # loop
//   node engage-worker.mjs --once     # one poll, then exit (debugging)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { scoutAny } from "./engage-scout.mjs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { writeIntro, writeSlide, checkSlide } from "./engage-writer.mjs";
import { captureDeck, captureOne, assembleExports, viewerHTML } from "./engage-export.mjs";
import { prepareLogo, prepareHero, darkenLogo } from "./engage-assets.mjs";
import { collectCandidates, chooseLogo, pickBrandColor, collectHeroCandidates, chooseHero } from "./engage-logosearch.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
// env: the workers folder's .env (ANTHROPIC_API_KEY, RELAY_SECRET, optional APP_DOMAIN)
for (const envFile of [path.join(__dir, "..", ".env"), path.join(__dir, ".env")]) {
  try {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* optional */ }
}

const APP = process.env.ENGAGE_APP || "http://127.0.0.1:3000";
// the app's public origin: deck URLs the capture opens (Chrome maps this host to 127.0.0.1) and the links it logs
const SITE = `https://${process.env.APP_DOMAIN ?? "app.example.com"}`;
const SECRET = (process.env.RELAY_SECRET || "").trim();
const PUBLIC = "/var/www/presentation-public";
const EXPORTS = "/var/www/presentation-exports";
const SPOOL = "/var/www/presentation-spool";
const TEMPLATE = path.join(PUBLIC, "_engage", "deck", "engage.html");
// presenter keys for the closing-page signature variants (<slug>--<key>.pptx/.pdf); must match the template's roster
const SIG_KEYS = ["jane", "john", "alex", "sam"];
if (!SECRET) { console.error("RELAY_SECRET missing"); process.exit(1); }

const hdr = { "x-relay-secret": SECRET, "Content-Type": "application/json" };
const prog = (id, patch) => fetch(`${APP}/api/create/progress`, { method: "POST", headers: hdr, body: JSON.stringify({ id, ...patch }) }).catch(() => {});
const done = (id, body) => fetch(`${APP}/api/create/done`, { method: "POST", headers: hdr, body: JSON.stringify({ id, ...body }) }).catch(() => {});

const longDate = (d = new Date()) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const execFile = promisify(execFileCb);
/* The slide library (a copy of web-deck components/library/library.json): the master slides a rep can put
   after the opening slides. One id space; deck order = order in the deck; the Short Pack is the default. */
const LIB = JSON.parse(fs.readFileSync(path.join(__dir, "engage-library.json"), "utf8"));
const LIB_INDEX = {};
LIB.decks.forEach((d, di) => d.slides.forEach((s, si) => { LIB_INDEX[s.sid] = { ...s, deck: d.id, deckOrder: di, order: si }; }));
const BODY_ALL = LIB.decks.find((d) => d.id === "shortpack").slides.map((s) => s.sid);
/* a body as the template shows it: known slides only ("<sid>", or "<sid>~<savedId>" for a Saved slide),
   legacy bare ids are the Short Pack's, no duplicates, library order whatever order the rep ticked them
   in (a saved variant right after its master); empty = the Short Pack */
const REF = /^[a-z0-9-]+(~[a-z0-9]{4,16})?$/;
const baseOf = (ref) => String(ref).split("~")[0];
function normalizeBody(list) {
  const seen = new Set();
  const out = (Array.isArray(list) ? list : []).filter((x) => typeof x === "string").map((x) => x.replace(/^shortpack:/, "")).filter((x) => REF.test(x) && LIB_INDEX[baseOf(x)] && !seen.has(x) && seen.add(x));
  if (!out.length) return [...BODY_ALL];
  const key = (x) => { const e = LIB_INDEX[baseOf(x)]; return [e.deckOrder, e.order, x.includes("~") ? 1 : 0]; };
  return out.sort((a, b) => { const ka = key(a), kb = key(b); return (ka[0] - kb[0]) || (ka[1] - kb[1]) || (ka[2] - kb[2]) || a.localeCompare(b); });
}

/* The slide ids the deck shows OUTSIDE the editor, in order: the same rule as the template (cover, intro,
   body, close; added slides after their anchor; hidden ones dropped). Its length is what a capture expects. */
function visibleSequence(spec) {
  const body = normalizeBody(spec.body);
  const ids = ["cover", ...(spec.intro || []).map((s) => s.id), ...body, "close"];
  for (const x of spec.extra || []) {
    if (!x || !x.slide || !x.slide.id || ids.includes(x.slide.id)) continue;
    const at = ids.indexOf(x.after);
    ids.splice(at >= 0 ? at + 1 : ids.length - 1, 0, x.slide.id);
  }
  const hidden = new Set(spec.hidden || []);
  return ids.filter((i) => !hidden.has(i));
}
const readSpec = (slug) => JSON.parse(fs.readFileSync(path.join(PUBLIC, slug, "deck", "spec.json"), "utf8"));
function writeSpec(slug, spec) {
  const dir = path.join(PUBLIC, slug, "deck"), file = path.join(dir, "spec.json"), orig = path.join(dir, "spec.original.json");
  if (fs.existsSync(file) && !fs.existsSync(orig)) fs.copyFileSync(file, orig);
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
}

/* Rebuild PowerPoint, PDF and thumbnail from the deck as it reads now (after the rep's edits). */
async function exportDeck({ id, slug, log }) {
  const spec = readSpec(slug);
  const expected = visibleSequence(spec).length;
  const shots = fs.mkdtempSync("/tmp/engage-cap-");
  try {
    const { slides, closings } = await captureDeck({ url: `${SITE}/p/${slug}/deck/?export=${Date.now()}`, expected, outDir: shots, sigKeys: SIG_KEYS, log });
    if (slides.length !== expected) log(`Note: captured ${slides.length} slides, expected ${expected}`);
    await assembleExports({ slug, slides, closings, targets: [path.join(EXPORTS, slug), path.join(PUBLIC, slug)], log });
    try { await sharp(slides[0]).resize({ width: 900 }).png().toFile(path.join(PUBLIC, slug, "thumb.png")); } catch { /* optional */ }
    return slides.length;
  } finally { fs.rmSync(shots, { recursive: true, force: true }); }
}

/* What the rep attached for a new slide: text for documents, an image block for pictures. */
async function readMaterial(spoolDir, name, originalName, log) {
  if (!name) return null;
  const f = path.join(spoolDir, path.basename(name));
  if (!fs.existsSync(f)) { log("The attached file was not found, writing from the brief alone"); return null; }
  const ext = path.extname(f).slice(1).toLowerCase();
  const strip = (xml) => xml.replace(/<\/(?:a:p|w:p)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  try {
    if (ext === "pdf") { const { stdout } = await execFile("pdftotext", ["-layout", f, "-"], { maxBuffer: 20e6 }); return { name: originalName, text: stdout.replace(/[ \t]+/g, " ").trim() }; }
    if (["txt", "md", "csv"].includes(ext)) return { name: originalName, text: fs.readFileSync(f, "utf8") };
    if (ext === "pptx") { const { stdout } = await execFile("unzip", ["-p", f, "ppt/slides/slide*.xml"], { maxBuffer: 30e6 }); return { name: originalName, text: strip(stdout) }; }
    if (ext === "docx") { const { stdout } = await execFile("unzip", ["-p", f, "word/document.xml"], { maxBuffer: 30e6 }); return { name: originalName, text: strip(stdout) }; }
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      const jpg = await sharp(f).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      return { name: originalName, image: { media_type: "image/jpeg", data: jpg.toString("base64") } };
    }
  } catch (e) { log(`Could not read the attached file (${String(e).slice(0, 60)}), writing from the brief alone`); }
  return null;
}

/* Slide Editor "add a slide": write it inside the template's slide types, place it, render it, check the
   screenshot (layout rules + Claude's eye), rewrite it while anything is wrong (three passes at most),
   then refresh the exports. The slide lands in the deck as soon as it is written, so the editor can
   show it while the PowerPoint and PDF rebuild. */
async function addSlide(job) {
  const { id, slug } = job;
  const log = (line) => { console.log(`[${slug}] ${line}`); prog(id, { log: String(line).slice(0, 200) }); };
  const spoolDir = path.join(SPOOL, id);
  const reqFile = path.join(spoolDir, "slide.json");
  let spec;
  try {
    spec = readSpec(slug);
    const req = JSON.parse(fs.readFileSync(reqFile, "utf8"));
    const afterLabel = (() => {
      if (req.after === "cover") return "Overview";
      const s = (spec.intro || []).find((x) => x.id === req.after) || (spec.extra || []).map((x) => x.slide).find((x) => x.id === req.after);
      if (s) return s.label;
      return { cost: "The cost today", modules: "The modules", flow: "Order to payment", compare: "Today vs Acme", proof: "Proof", golive: "Go live", close: "Get in touch" }[req.after] || req.after;
    })();
    await prog(id, { stage: "write" });
    log("Reading your brief…");
    const material = await readMaterial(spoolDir, req.file, req.originalName, log);
    if (material && material.text) log(`Read ${material.text.length.toLocaleString("en-GB")} characters from ${material.name || "the file"}`);
    let slide = await writeSlide({ spec, afterLabel, prompt: req.prompt, material, log });
    const sid = "x" + Date.now().toString(36);
    slide = { ...slide, id: sid };
    spec.extra = [...(spec.extra || []), { after: req.after, slide }];
    writeSpec(slug, spec);
    log(`Written: "${slide.label}" (${slide.type}), placed after ${afterLabel}`);

    await prog(id, { stage: "export" });
    const shots = fs.mkdtempSync("/tmp/engage-one-");
    try {
      for (let round = 1; round <= 3; round++) {
        log(`Rendering the slide${round > 1 ? ` (pass ${round})` : ""}…`);
        const expected = visibleSequence(spec).length;
        const { file, issues } = await captureOne({ url: `${SITE}/p/${slug}/deck/?export=${Date.now()}`, sid, expected, outDir: shots });
        log(issues.length ? `Layout check: ${issues.join(" ")}` : "Layout check: fits the slide");
        const verdict = await checkSlide({ png: file, slide, log });
        log(verdict.ok ? "Visual check: looks right" : `Visual check: ${verdict.issues.join(" ")}`);
        const all = [...issues, ...(verdict.ok ? [] : verdict.issues)];
        if (!all.length) break;
        if (round === 3) { log("Kept the best version after three passes"); break; }
        const next = await writeSlide({ spec, afterLabel, prompt: req.prompt, material, previous: slide, issues: all, log });
        slide = { ...next, id: sid };
        spec.extra = spec.extra.map((x) => (x.slide.id === sid ? { after: x.after, slide } : x));
        writeSpec(slug, spec);
      }
    } finally { fs.rmSync(shots, { recursive: true, force: true }); }
    log(`Slide ready: "${slide.label}". Refreshing PowerPoint and PDF…`);
    try { fs.rmSync(reqFile, { force: true }); if (req.file) fs.rmSync(path.join(spoolDir, path.basename(req.file)), { force: true }); } catch { /* tidy only */ }
    const n = await exportDeck({ id, slug, log });
    await done(id, { status: "ready", slideCount: n, deckUrl: `/p/${slug}/`, pptxReady: true, pdfReady: true });
    log("PowerPoint and PDF refreshed");
  } catch (e) {
    console.error("ADD SLIDE FAILED", id, e);
    try { fs.rmSync(reqFile, { force: true }); } catch { /* tidy only */ }
    // the deck itself is intact (the slide either landed or never did): back to ready with the reason in the log
    const n = spec ? visibleSequence(spec).length : undefined;
    log(`Could not add the slide: ${String(e && e.message ? e.message : e).slice(0, 160)}`);
    await done(id, { status: "ready", statusMsg: "Ready", slideCount: n, deckUrl: `/p/${slug}/`, pptxReady: true, pdfReady: true });
  }
}

/* Re-export requests queued by the Slide Editor (one marker per deck, rewritten on every save). A marker
   is taken only once it has been quiet for 20 s, so a burst of edits costs one rebuild. */
async function reexportDue() {
  let dirs = [];
  try { dirs = fs.readdirSync(SPOOL); } catch { return false; }
  for (const d of dirs) {
    const m = path.join(SPOOL, d, "reexport.json");
    let job;
    try {
      const st = fs.statSync(m);
      if (Date.now() - st.mtimeMs < 20000) continue;
      job = JSON.parse(fs.readFileSync(m, "utf8"));
      fs.rmSync(m, { force: true }); // edits made during this rebuild write a fresh marker
    } catch { continue; }
    if (!job || !job.slug || !fs.existsSync(path.join(PUBLIC, job.slug, "deck", "spec.json"))) continue;
    const log = (line) => { console.log(`[${job.slug}] ${line}`); if (job.id) prog(job.id, { log: String(line).slice(0, 200) }); };
    try {
      log("Refreshing PowerPoint and PDF with your edits…");
      await exportDeck({ id: job.id, slug: job.slug, log });
      log("PowerPoint and PDF refreshed");
    } catch (e) { console.error("REEXPORT FAILED", job.slug, e); }
    return true;
  }
  return false;
}

/* Thumbnails for Saved slides (markers written by /api/presentations/save-slide): the slide as it reads in
   the deck it was saved from, edits applied, 480px WebP next to the saved record. If the slide cannot be
   captured (hidden in that deck, for instance) the master's library thumbnail stands in. */
async function savedThumbsDue() {
  const dir = path.join(SPOOL, "_saved");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return false; }
  for (const f of files) {
    const m = path.join(dir, f);
    let job;
    try { job = JSON.parse(fs.readFileSync(m, "utf8")); fs.rmSync(m, { force: true }); } catch { continue; }
    if (!job || !job.id || !job.slug || !job.sid) continue;
    // deleted again before its turn came (the record is the .json): nothing to capture
    if (!fs.existsSync(path.join(PUBLIC, "_saved", `${job.id}.json`))) continue;
    const out = path.join(PUBLIC, "_saved", `${job.id}.webp`);
    const log = (l) => console.log(`[saved ${job.id}] ${l}`);
    const shots = fs.mkdtempSync("/tmp/engage-saved-");
    try {
      const spec = readSpec(job.slug);
      const { file } = await captureOne({ url: `${SITE}/p/${job.slug}/deck/?export=${Date.now()}`, sid: job.sid, expected: visibleSequence(spec).length, outDir: shots });
      await sharp(file).resize({ width: 480 }).webp({ quality: 80 }).toFile(out);
      log("thumbnail ready");
    } catch (e) {
      log(`thumbnail failed (${String(e).slice(0, 80)}), using the master's`);
      try { fs.copyFileSync(path.join(PUBLIC, "_library", `${baseOf(job.sid)}.webp`), out); } catch { /* none */ }
    } finally { fs.rmSync(shots, { recursive: true, force: true }); }
    return true;
  }
  return false;
}

async function run(job) {
  if (job.edit) return addSlide(job);
  const { id, slug, title } = job;
  const brief = job.brief || {};
  const log = (line) => { console.log(`[${slug}] ${line}`); prog(id, { log: String(line).slice(0, 200) }); };
  const deckDir = path.join(PUBLIC, slug, "deck");
  const spoolDir = path.join(SPOOL, id);
  if (!fs.existsSync(TEMPLATE)) throw new Error("engage template missing on the VPS: run web-deck/deploy-engage-template.sh");
  fs.mkdirSync(deckDir, { recursive: true });

  // 1) read
  await prog(id, { stage: "read" });
  log(`Reading ${brief.url}…`);
  let scout = brief.scout && brief.scout.deep ? brief.scout : null;
  if (!scout) {
    scout = await scoutAny(brief.url, { deep: true });
    scout.deep = true;
    if (scout.lite) log("Site blocked the browser, read the raw page instead");
  }
  const client = (brief.client || scout.name || scout.domain || "Prospect").trim();
  log(`Prospect: ${client}${scout.pages?.length ? ` (read ${1 + scout.pages.length} pages)` : ""}`);

  // logo. The rep's own pick (a URL from the Look up, a data URL, or an uploaded file) is used as is.
  // Otherwise every version we can find (their site + a web image search) is downloaded and Claude
  // chooses the official dark or coloured one. Whatever comes out, a white logo is never put on a
  // badge: it is recoloured to the brand's dark colour, or black.
  let logo = null;
  const referer = scout.url || brief.url;
  const manual = brief.logo && brief.logo !== "auto" ? brief.logo : "";
  if (manual) {
    logo = await prepareLogo(manual, deckDir, referer, spoolDir);
    log(`Logo: the rep's pick (${logo.file})`);
  } else {
    const cands = await collectCandidates({ scout, client, domain: scout.domain, log });
    const choice = await chooseLogo(cands, client, { log }).catch((e) => { log(`Logo choice skipped: ${String(e).slice(0, 80)}`); return { pick: 0, backup: 0 }; });
    // only what Claude approved is used as a dark version (pick, then backup). If it rejected everything,
    // the site's own primary logo is used and recoloured below; an unreviewed candidate is never promoted
    // (that is how a booking widget or an awards badge ends up on a cover).
    const order = [choice.pick, choice.backup].filter((n) => n > 0).map((n) => cands[n - 1]);
    for (const c of order) {
      try {
        const got = await prepareLogo(c.url, deckDir, referer, spoolDir);
        if (!got.onDark) { logo = got; log(`Logo: ${c.source === "site" ? "their site" : c.host} (${choice.reason || "Claude's pick"})`); break; }
      } catch (e) { log(`Candidate skipped: ${String(e).slice(0, 60)}`); }
    }
    if (!logo) {
      const primary = (scout.logos || [])[0]?.url || cands.find((c) => c.source === "site")?.url;
      if (!primary) throw new Error("no usable logo found on the site or the web: upload one in the Create pane");
      logo = await prepareLogo(primary, deckDir, referer, spoolDir);
      log(`Using the site's primary logo${logo.onDark ? " (white artwork)" : ""}`);
    }
  }
  if (logo.onDark) {
    const hex = pickBrandColor(scout.brandColors);
    logo.file = await darkenLogo(deckDir, logo.file, hex);
    logo.onDark = false; logo.recoloured = hex;
    log(`No dark version of the logo exists, recoloured the white artwork to ${hex}`);
  }
  log(`Logo ready (${logo.file})`);
  let hero = null;
  if (brief.hero && brief.hero !== "none" && brief.hero !== "auto") {
    // the rep's own pick (a candidate from the Look up, or an uploaded file): used as is, cropped to fit
    try {
      hero = await prepareHero(brief.hero, deckDir, referer, spoolDir, { chosen: true });
      log(brief.hero.startsWith("spool:") ? "Cover photo: the rep's upload" : "Cover photo: the rep's pick");
    } catch (e) { log(`Photo skipped: ${String(e && e.message ? e.message : e).slice(0, 90)}`); }
  } else if (brief.hero !== "none") {
    // auto: Claude looks at the candidates and only accepts a photo of THEIR property (no other brand's
    // signage, no stock, no people); otherwise the cover goes full-width
    try {
      const hc = await collectHeroCandidates({ scout, log });
      const pick = hc.length ? await chooseHero(hc, client, { log }) : { pick: 0 };
      if (pick.pick) hero = await prepareHero(hc[pick.pick - 1].url, deckDir, referer);
    } catch (e) { log(`Photo choice skipped: ${String(e).slice(0, 80)}`); }
  }
  log(hero ? "Cover photo ready" : "No cover photo, using the full-width cover");

  // 2) write
  await prog(id, { stage: "write" });
  const written = await writeIntro(scout, { ...brief, client }, { log });
  log(`Opening slides written: ${written.intro.map((s) => s.label).join(", ")}${written.usage ? ` (${written.usage.output} tokens)` : ""}`);

  const presenter = brief.presenter && brief.presenter.name ? brief.presenter : null;
  const body = normalizeBody(brief.body); // the library slides the rep ticked (the master decks and the Short Pack), in library order
  // Saved slides ("<sid>~<savedId>"): the words / photos / hidden items a rep kept become this deck's patch
  // layer (keyed by this deck's own slide id) and the saved name becomes the nav label
  const savedEdits = {}, bodyLabels = {};
  for (const ref of body) {
    const t = ref.indexOf("~"); if (t < 0) continue;
    const base = ref.slice(0, t);
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(PUBLIC, "_saved", `${ref.slice(t + 1)}.json`), "utf8"));
      bodyLabels[ref] = rec.name;
      for (const [k, v] of Object.entries(rec.edits || {})) { const m = k.match(/^([tixb])(.+)\.(\d+)$/); if (m && m[2] === base) savedEdits[`${m[1]}${ref}.${m[3]}`] = v; }
      log(`Saved slide "${rec.name}" (from ${rec.from && rec.from.title ? rec.from.title : "a sales deck"})`);
    } catch { log(`Saved slide ${ref} was not found, using the master slide`); }
  }
  log(`Slides after the opening slides: ${body.map((b) => bodyLabels[b] || LIB_INDEX[baseOf(b)].label).join(", ")}`);
  const spec = {
    title: title || `${written.client} Sales Deck`,
    client: written.client, short: written.short, eyebrow: written.eyebrow, subtitle: written.subtitle, chips: written.chips,
    logo: logo.file, logoOnDark: logo.onDark, hero: hero || undefined,
    preparedBy: presenter?.name || "Acme", date: longDate(),
    intro: written.intro, body, bodyLabels: Object.keys(bodyLabels).length ? bodyLabels : undefined, presenter: presenter || undefined, exportSlug: slug,
    source: { url: scout.url || brief.url, domain: scout.domain, generatedAt: new Date().toISOString(), model: written.usage?.model, notes: brief.notes || "" },
  };

  // 3) render + export
  await prog(id, { stage: "export" });
  fs.copyFileSync(TEMPLATE, path.join(deckDir, "index.html"));
  fs.writeFileSync(path.join(deckDir, "spec.json"), JSON.stringify(spec, null, 2));
  // the patch layer starts with the Saved slides' edits (empty otherwise), so the capture below carries them
  fs.writeFileSync(path.join(deckDir, "edits.json"), JSON.stringify(savedEdits));
  fs.writeFileSync(path.join(PUBLIC, slug, "index.html"), viewerHTML(slug, spec.title, true));
  const expected = 1 + spec.intro.length + body.length + 1;
  await prog(id, { slidesTotal: expected, slidesDone: 0 });
  log(`Deck written (${expected} slides). Capturing…`);
  const shots = fs.mkdtempSync("/tmp/engage-cap-");
  // slide-count patches go out in order (a later, smaller count must never overtake the final one)
  let doneCount = 0, chain = Promise.resolve();
  const { slides, closings } = await captureDeck({
    url: `${SITE}/p/${slug}/deck/?export=${Date.now()}`, expected, outDir: shots, sigKeys: SIG_KEYS,
    log: (l) => { if (/^Captured slide/.test(l)) { const n = ++doneCount; chain = chain.then(() => prog(id, { slidesDone: n })); } log(l); },
  });
  await chain;
  if (slides.length !== expected) log(`Note: captured ${slides.length} slides, expected ${expected}`);
  await assembleExports({ slug, slides, closings, targets: [path.join(EXPORTS, slug), path.join(PUBLIC, slug)], log });

  // 4) publish (the row's edits must match edits.json: the editor seeds the deck from the row)
  await prog(id, { stage: "publish" });
  try { await sharp(slides[0]).resize({ width: 900 }).png().toFile(path.join(PUBLIC, slug, "thumb.png")); } catch { /* optional */ }
  fs.rmSync(shots, { recursive: true, force: true });
  await done(id, { status: "ready", slideCount: slides.length, deckUrl: `/p/${slug}/`, pptxReady: true, pdfReady: true, edits: savedEdits });
  log(`Ready: ${SITE}/presentations/p/${slug}/`);
}

async function poll() {
  const r = await fetch(`${APP}/api/create/next?engine=engage`, { headers: { "x-relay-secret": SECRET } });
  if (!r.ok) { console.log("poll", r.status); return false; }
  const { job } = await r.json();
  if (!job) return false;
  console.log("JOB", job.id, job.slug, job.title);
  try { await run(job); }
  catch (e) {
    console.error("FAILED", job.id, e);
    await done(job.id, { status: "failed", statusMsg: String(e && e.message ? e.message : e).slice(0, 180) });
  }
  return true;
}

const once = process.argv.includes("--once");
console.log("engage worker polling", APP);
if (once) { await poll(); process.exit(0); }
for (;;) {
  try { const did = await poll(); if (!did && !(await reexportDue())) await savedThumbsDue(); } catch (e) { console.error("loop", String(e).slice(0, 160)); }
  await new Promise((r) => setTimeout(r, 4000));
}
