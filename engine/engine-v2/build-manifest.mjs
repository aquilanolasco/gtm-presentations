#!/usr/bin/env node
/**
 * Asset Manifest Generator — Presentation Engine v2
 *
 * Walks the brand asset tree and emits manifest.json: the single source of truth
 * for what the AI composer is allowed to reference. The composer is grounded on
 * this manifest, and the renderers resolve every deck-spec assetRef.id against it.
 * An id that isn't here is a hard error, not a broken <img>. That is the whole point.
 *
 * Usage:  node build-manifest.mjs [assetsDir] [outFile]
 * Default: ../assets  ->  ./manifest.json
 *
 * Runs on macOS (uses `sips` as a dimension fallback). Pure-JS readers cover
 * PNG/JPEG/GIF/SVG so the common cases need no shell-out.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, process.argv[2] || "../assets");
const OUT_FILE = path.resolve(__dirname, process.argv[3] || "./manifest.json");

// ── What we refuse to index ────────────────────────────────────────────────
// Brandkit is a legacy brand folder that must never reach a deck. The rest are
// non-web source formats and OS/sync junk that must never reach a deck.
const EXCLUDE_CATEGORIES = new Set(["Brandkit"]);
const WEB_IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"]);
const WEB_VIDEO = new Set([".mp4", ".webm", ".mov"]);
const WEB_FONT = new Set([".ttf", ".woff", ".woff2"]);
const JUNK = /(\.DS_Store$|\.tmp\$\$$|\.smbdelete|\.textclipping$|\.webloc$|^\._)/i;
const NON_WEB_SOURCE = new Set([".eps", ".ai", ".psd", ".psb", ".indd", ".zip", ".docx", ".pptx", ".pdf", ".ogg", ".webmanifest", ".ico", ".md", ".html", ".mp3"]);

// ── Usage rules per top-level category (distilled from the agent rulebook) ───────────
const CATEGORY_USAGE = {
  "Acme Logos": "Brand logos. Use as-is, never alter. White-bg decks: logo-horizontal-color. Dark panels: logo-vertical-slogan-white.",
  "Acme UI & UX": "Device mockups for the cover right-panel hero. One device, alone, no scene layered on top.",
  "Acme Web Application Screens": "Real product artboards. Use as sr-screen (floating) or sr-bg-screen (dimmed). Never full-bleed.",
  "Colourful UI UX": "Illustrated KPI cards + hero illustrations. Floating sr-card overlays; combine 2-3 per slide.",
  "Characters": "Brand characters. Never alter geometry/palette. sr-char, bottom-right, 65-75% height, overlapping UI.",
  "Scenes": "Composite two-sided / marketplace scenes. sr-scene, fills right panel.",
  "Agent Personas": "AI agent personas mapped to product areas. Use on AI-agent / automation slides. Names are fixed.",
  "Acme Icons": "Benefit illustration icons. Use in feature cards / bullets.",
  "Acme Colours": "Palette reference swatches. Reference only, not deck content.",
  "Web Content": "Product screenshots + customer/industry photos + cert badges. Real-world context images.",
  "Team": "Team / leadership photos. People slide only.",
  "Fonts": "Brand font files. The ONLY font for on-image AI-generated typography.",
  "Animations": "Motion assets. Not for use in decks until motion is approved. Indexed but flagged noDeckUse.",
  "Examples": "Reference example decks. Not deck content.",
  "Generated": "Ad-hoc AI-generated assets. Review before use.",
  "Topics": "Topic reference. Not deck content.",
  "Voice": "Voice reference. Not deck content.",
  "Images": "Misc images."
};

// role hint by category, so the composer knows the natural sr-* role
const CATEGORY_ROLE = {
  "Acme Logos": "logo",
  "Acme UI & UX": "device",
  "Acme Web Application Screens": "screen",
  "Colourful UI UX": "card",
  "Characters": "character",
  "Scenes": "scene",
  "Agent Personas": "character",
  "Acme Icons": "icon",
  "Web Content": "photo",
  "Team": "photo"
};

// Curated friendly aliases for the highest-value files (match the agent rulebook names).
const ALIASES = {
  "logo-horizontal-color.png": ["logo-horizontal-color"],
  "logo-vertical-color.png": ["logo-vertical-color"],
  "logo-vertical-slogan-white.png": ["logo-vertical-slogan-white"],
  "logo-horizontal-slogan-white.png": ["logo-horizontal-slogan-white"],
  "logo-emblem-color.png": ["logo-emblem-color"],
  "logo-emblem-white.png": ["logo-emblem-white"],
  "logo-emblem-mobile.png": ["logo-emblem-mobile"],
  "001_mobile-marketplace-screen.png": ["device-mobile"],
  "002_responsive-marketplace-desktop-mobile.png": ["device-responsive"],
  "003_dashboard-procurement-list.png": ["device-dashboard"],
  "Artboard 1_Acme.png": ["artboard-1"],
  "Artboard 2_Acme.png": ["artboard-2"],
  "Artboard 3_Acme.png": ["artboard-3"],
  "Artboard 4_Acme.png": ["artboard-4"],
  "Artboard 5_Acme.png": ["artboard-5"],
  "Artboard 6_Acme.png": ["artboard-6"],
  "Artboard 7_Acme.png": ["artboard-7"],
  "Artboard 8_Acme.png": ["artboard-8"],
  "Artboard 9_Acme.png": ["artboard-9"],
  "Artboard 10_Acme.png": ["artboard-10"]
};

// ── Dimension readers (pure JS for common types) ────────────────────────────
function dimsPNG(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function dimsGIF(b) {
  if (b.length < 10 || b.toString("ascii", 0, 3) !== "GIF") return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}
function dimsJPEG(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const marker = b[o + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(o + 5), width: b.readUInt16BE(o + 7) };
    }
    o += 2 + b.readUInt16BE(o + 2);
  }
  return null;
}
function dimsSVG(txt) {
  const vb = txt.match(/viewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  if (vb) return { width: Math.round(+vb[1]), height: Math.round(+vb[2]) };
  const w = txt.match(/\bwidth\s*=\s*["']?([\d.]+)/i);
  const h = txt.match(/\bheight\s*=\s*["']?([\d.]+)/i);
  if (w && h) return { width: Math.round(+w[1]), height: Math.round(+h[1]) };
  return null;
}
function dimsSips(file) {
  try {
    const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const w = out.match(/pixelWidth:\s*(\d+)/);
    const h = out.match(/pixelHeight:\s*(\d+)/);
    if (w && h) return { width: +w[1], height: +h[1] };
  } catch { /* not an image sips understands */ }
  return null;
}
function getDims(file, ext) {
  try {
    if (ext === ".svg") return dimsSVG(fs.readFileSync(file, "utf8"));
    const b = fs.readFileSync(file);
    if (ext === ".png") return dimsPNG(b) || dimsSips(file);
    if (ext === ".gif") return dimsGIF(b) || dimsSips(file);
    if (ext === ".jpg" || ext === ".jpeg") return dimsJPEG(b) || dimsSips(file);
    return dimsSips(file); // webp / avif / etc.
  } catch { return null; }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function slugify(s) {
  return s.toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[&]+/g, " and ")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
function tokenize(relPath) {
  return [...new Set(
    relPath.toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !["png","jpg","jpeg","the","and","rgb","dpi","acme"].includes(t))
  )];
}
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

// ── Build ─────────────────────────────────────────────────────────────────
if (!fs.existsSync(ASSETS_DIR)) {
  console.error(`Assets dir not found: ${ASSETS_DIR}`);
  process.exit(1);
}

const assets = [];
const seenIds = new Map();
const skipped = { junk: 0, source: 0, brandkit: 0, other: 0 };

for (const file of walk(ASSETS_DIR)) {
  const rel = path.relative(ASSETS_DIR, file);
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  const category = rel.split(path.sep)[0];

  if (JUNK.test(base)) { skipped.junk++; continue; }
  if (EXCLUDE_CATEGORIES.has(category)) { skipped.brandkit++; continue; }

  let type;
  if (WEB_IMAGE.has(ext)) type = "image";
  else if (WEB_VIDEO.has(ext)) type = "video";
  else if (WEB_FONT.has(ext)) type = "font";
  else if (NON_WEB_SOURCE.has(ext)) { skipped.source++; continue; }
  else { skipped.other++; continue; }

  const parts = rel.split(path.sep);
  const subcategory = parts.length > 2 ? parts[1] : null;

  // stable id: slug of relative path; disambiguate collisions
  let id = slugify(rel);
  if (seenIds.has(id)) {
    const n = seenIds.get(id) + 1;
    seenIds.set(id, n);
    id = `${id}-${n}`;
  } else {
    seenIds.set(id, 1);
  }

  let width = null, height = null, orientation = null;
  if (type === "image" && ext !== ".gif") {
    const d = getDims(file, ext);
    if (d) {
      width = d.width; height = d.height;
      orientation = width === height ? "square" : width > height ? "landscape" : "portrait";
    }
  }

  assets.push({
    id,
    aliases: ALIASES[base] || [],
    path: rel.split(path.sep).join("/"),
    category,
    subcategory,
    type,
    ext: ext.slice(1),
    bytes: fs.statSync(file).size,
    width,
    height,
    orientation,
    role: CATEGORY_ROLE[category] || null,
    noDeckUse: category === "Animations" || ["Acme Colours", "Examples", "Topics", "Voice"].includes(category),
    tags: tokenize(rel),
    usage: CATEGORY_USAGE[category] || null
  });
}

assets.sort((a, b) => a.category.localeCompare(b.category) || a.path.localeCompare(b.path));

const byCategory = {};
for (const a of assets) byCategory[a.category] = (byCategory[a.category] || 0) + 1;

const manifest = {
  manifestVersion: "2.0",
  generatedFrom: path.relative(path.resolve(__dirname, ".."), ASSETS_DIR),
  assetCount: assets.length,
  byCategory,
  usableForDecks: assets.filter((a) => !a.noDeckUse).length,
  assets
};

fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));

console.log(`Manifest written: ${path.relative(process.cwd(), OUT_FILE)}`);
console.log(`  indexed: ${assets.length}  (deck-usable: ${manifest.usableForDecks})`);
console.log(`  skipped: brandkit=${skipped.brandkit} source=${skipped.source} junk=${skipped.junk} other=${skipped.other}`);
console.log(`  by category:`);
for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${c}`);
const noDims = assets.filter((a) => a.type === "image" && a.ext !== "gif" && a.width == null);
if (noDims.length) console.log(`  WARN: ${noDims.length} image(s) without dimensions (first: ${noDims[0].path})`);
