#!/usr/bin/env node
/* ============================================================================
   render-web.mjs  --  Engine v2 web renderer.
   Deck spec (JSON, validated) + manifest -> ONE self-contained animated HTML.
   Deterministic: the AI never writes HTML, only a spec. Unknown asset id or a
   schema violation is a hard error, never a broken slide.

   Usage:
     node render-web.mjs --spec deck.json --out builds/deck.html [--embed]
                         [--assets-base ../assets/] [--manifest engine-v2/manifest.json]
   --embed : inline images as data URIs (portable single file, used for local QA).
   Otherwise images are referenced at <assets-base><asset.path>.
   ============================================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- args -------------------------------------------------------------------
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const SPEC = arg("spec");
const OUT = arg("out");
const EMBED = arg("embed", false) === true;
const ASSETS_BASE = arg("assets-base", "assets/");
const MANIFEST = path.resolve(__dirname, arg("manifest", "manifest.json"));
if (!SPEC || !OUT) { console.error("Required: --spec <file> --out <file>"); process.exit(2); }

const DS = path.join(__dirname, "design-system");
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");

// ---- load + validate --------------------------------------------------------
const spec = JSON.parse(fs.readFileSync(path.resolve(SPEC), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "deck-spec.schema.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(spec)) {
  console.error("Deck spec FAILED schema validation:");
  for (const e of validate.errors) console.error(`  ${e.instancePath || "/"} ${e.message}`);
  process.exit(1);
}
// Renderer-level asserts the schema can't express
if (spec.slides[0].type !== "cover") { console.error("First slide must be type 'cover'."); process.exit(1); }
if (spec.slides[spec.slides.length - 1].type !== "call-to-action") { console.error("Last slide must be 'call-to-action'."); process.exit(1); }

// ---- asset resolution (hard fail on unknown id) -----------------------------
const byId = new Map();
for (const a of manifest.assets) {
  byId.set(a.id, a);
  for (const al of a.aliases || []) byId.set(al, a);
}
function resolveAsset(ref) {
  const a = byId.get(ref.id);
  if (!a) { console.error(`Unknown asset id '${ref.id}' (role ${ref.role}). Not in manifest.`); process.exit(1); }
  if (a.noDeckUse) console.warn(`WARN asset '${ref.id}' is flagged noDeckUse.`);
  return a;
}
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
function assetSrc(a) {
  if (EMBED) {
    const buf = fs.readFileSync(path.join(ASSETS_DIR, a.path));
    return `data:${MIME[a.ext] || "application/octet-stream"};base64,${buf.toString("base64")}`;
  }
  return ASSETS_BASE.replace(/\/?$/, "/") + a.path.split("/").map(encodeURIComponent).join("/");
}

// ---- html helpers -----------------------------------------------------------
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const read = (p) => fs.readFileSync(p, "utf8");

// Accent the last word with a SOLID brand color (not gradient): background-clip:text
// does not survive SplitText re-wrapping, so headlines use .accent, numbers use .grad-text.
function accentLastWord(text) {
  const t = esc(text).trim();
  const i = t.lastIndexOf(" ");
  if (i === -1) return `<span class="accent">${t}</span>`;
  return `${t.slice(0, i)} <span class="accent">${t.slice(i + 1)}</span>`;
}

// ---- panel composition by role ---------------------------------------------
const CARD_POS = [
  "top:6%; left:4%;", "top:20%; left:2%;", "bottom:12%; left:8%;",
];
function panel(slide) {
  const assets = (slide.assets || []).map((r) => ({ ref: r, a: resolveAsset(r) }));
  const get = (role) => assets.filter((x) => x.ref.role === role);
  const img = (x, cls, style) => x.a.type === "video"
    ? `<video class="${cls}" ${style ? `style="${style}"` : ""} muted loop autoplay playsinline src="${assetSrc(x.a)}"></video>`
    : `<img class="${cls}" ${style ? `style="${style}"` : ""} src="${assetSrc(x.a)}" alt="${esc(x.ref.alt || "")}">`;

  if (slide.type === "cover") {
    const d = get("device")[0] || assets[0];
    return `<div class="slide-right anim">${d ? img(d, "sr-device") : ""}</div>`;
  }
  if (slide.type === "application-multi-screen") {
    const screens = get("screen");
    return `<div class="slide-right anim"><div class="multi-screen">${screens.map((s) => img(s, "")).join("")}</div></div>`;
  }
  if (slide.type === "call-to-action") {
    const logo = get("logo")[0] || assets[0];
    return `<div class="slide-right anim">${logo ? img(logo, "") : ""}</div>`;
  }

  // Layered composition: bg-screen (back) -> hero/scene -> cards (floating) -> character (front)
  const soft = get("hero").length || get("card").length || slide.type === "txt-character-fun-ui" || slide.type === "analytics-dash-ai";
  let inner = "";
  get("bg-screen").forEach((x) => inner += img(x, "sr-bg-screen"));
  get("scene").forEach((x) => inner += img(x, "sr-scene"));
  get("hero").forEach((x) => inner += img(x, "sr-hero"));
  get("screen").forEach((x) => inner += img(x, "sr-screen"));
  get("card").forEach((x, i) => inner += img(x, "sr-card", CARD_POS[i % CARD_POS.length]));
  get("character").forEach((x) => inner += img(x, "sr-char"));
  if (!inner) return "";
  return `<div class="slide-right anim ${soft ? "is-soft" : ""}">${inner}</div>`;
}

// ---- left column ------------------------------------------------------------
function statBlock(s) {
  return `<div class="stat anim"><div class="stat__value"><span class="grad-text">${esc(s.value)}</span></div><div class="stat__label">${esc(s.label)}</div></div>`;
}
function cardBlock(c) {
  const icon = c.icon ? `<img class="card__icon" src="${assetSrc(resolveAsset(c.icon))}" alt="">` : "";
  return `<div class="card anim">${icon}<h3 class="card__title">${esc(c.title)}</h3>${c.body ? `<p class="card__body">${esc(c.body)}</p>` : ""}</div>`;
}
function personBlock(p) {
  return `<div class="person anim"><img src="${assetSrc(resolveAsset(p.photo))}" alt="${esc(p.name)}"><div class="person__name">${esc(p.name)}</div>${p.role ? `<div class="person__role">${esc(p.role)}</div>` : ""}</div>`;
}

function leftColumn(slide) {
  const anim = slide.animation || "fade-up";
  const headCls = (anim === "hero-reveal" || anim === "split-text") ? "" : "anim";
  const bigHead = slide.type === "cover" || slide.type === "section-divider" || slide.type === "call-to-action";
  const headHtml = slide.headline
    ? `<h1 class="headline ${headCls}">${bigHead ? accentLastWord(slide.headline) : esc(slide.headline)}</h1>` : "";

  let out = "";
  if (slide.eyebrow) out += `<p class="eyebrow anim">${esc(slide.eyebrow)}</p>`;
  out += headHtml;
  if (slide.subhead) out += `<p class="subhead anim">${esc(slide.subhead)}</p>`;
  if (slide.body) out += `<p class="lead anim">${esc(slide.body)}</p>`;
  if (slide.stats && slide.stats.length) out += `<div class="stats">${slide.stats.map(statBlock).join("")}</div>`;
  if (slide.bullets && slide.bullets.length) out += `<ul class="bullets">${slide.bullets.map((b) => `<li class="anim ${b.emphasis ? "is-emphasis" : ""}">${esc(b.text)}</li>`).join("")}</ul>`;
  if (slide.type === "feature-highlight" && slide.cards) out += `<div class="cards">${slide.cards.map(cardBlock).join("")}</div>`;
  if (slide.type === "people" && slide.people) out += `<div class="people-grid">${slide.people.map(personBlock).join("")}</div>`;
  if (slide.quote) out += `<blockquote class="quote anim">${esc(slide.quote.text)}${slide.quote.attribution ? `<div class="quote__attr">${esc(slide.quote.attribution)}</div>` : ""}</blockquote>`;
  if (slide.type === "cover") {
    const bits = [slide.presenter, slide.date].filter(Boolean).map(esc).join("  &middot;  ");
    if (bits) out += `<p class="meta anim">${bits}</p>`;
  }
  if (slide.type === "call-to-action") out += `<a class="cta anim" href="#">Get started</a>`;
  return out;
}

// ---- slide + deck -----------------------------------------------------------
const SINGLE_COL = new Set(["section-divider", "feature-highlight", "people"]);
function renderSlide(slide) {
  const p = SINGLE_COL.has(slide.type) ? "" : panel(slide);
  const cols = (SINGLE_COL.has(slide.type) || (!p && slide.type !== "cover")) ? "1" : "2";
  const left = `<div class="slide-left">${leftColumn(slide)}</div>`;
  return `<section class="slide" id="${esc(slide.id)}" data-type="${esc(slide.type)}" data-anim="${esc(slide.animation || "fade-up")}" data-cols="${cols}">
    <div class="slide-inner">${left}${p}</div>
  </section>`;
}

function navLabel(slide, i) {
  const raw = slide.headline || slide.type.replace(/-/g, " ");
  const t = raw.length > 30 ? raw.slice(0, 28).trim() + "…" : raw;
  return esc(t);
}

// logos
const navLogo = byId.has("logo-horizontal-color") ? assetSrc(byId.get("logo-horizontal-color")) : "";

const navHtml = spec.slides.map((s, i) =>
  `<a class="deck-nav__item" data-target="${esc(s.id)}"><span class="deck-nav__dot"></span>${navLabel(s, i)}</a>`).join("");

const tokensCss = read(path.join(DS, "tokens.css"));
const deckCss = read(path.join(__dirname, "deck.css"));
// vendor/ is NOT included in this export. Populate it from the gsap npm package
// (node_modules/gsap/dist/{gsap,ScrollTrigger,SplitText}.min.js) or a pinned CDN
// copy before rendering; the renderer inlines these so the output is one file.
const gsapMin = read(path.join(__dirname, "vendor", "gsap.min.js"));
const stMin = read(path.join(__dirname, "vendor", "ScrollTrigger.min.js"));
const splitMin = read(path.join(__dirname, "vendor", "SplitText.min.js"));
const engine = read(path.join(__dirname, "gsap-engine.js"));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(spec.meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* tokens.css */
${tokensCss}
/* deck.css */
${deckCss}
</style>
</head>
<body>
<nav class="deck-nav" aria-label="Slides">
  <div class="deck-nav__logo">${navLogo ? `<img src="${navLogo}" alt="Acme">` : ""}</div>
  <div class="deck-nav__list">${navHtml}</div>
  <div class="deck-nav__progress"><i></i></div>
</nav>
<div class="deck-topbar">${navLogo ? `<img src="${navLogo}" alt="Acme">` : ""}</div>
<main class="deck">
${spec.slides.map(renderSlide).join("\n")}
</main>
<script>${gsapMin}</script>
<script>${stMin}</script>
<script>${splitMin}</script>
<script>${engine}</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(path.resolve(OUT), html);
console.log(`Rendered ${spec.slides.length} slides -> ${OUT} (${(html.length / 1024).toFixed(0)} KB, embed=${EMBED})`);
