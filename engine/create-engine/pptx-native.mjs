/* Native editable PPTX from a deck.json: real text boxes, real tables, brand colors.
   Deterministic mapper (no AI): every slide type gets a clean PowerPoint layout so the file
   is genuinely editable (unlike the capture-based export). v1 of the "native export leg".
   Usage: node pptx-native.mjs --deck <deck.json> --assets <dir> --out <file.pptx> --title "..." */
import fs from "node:fs"; import path from "node:path";
import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);
const Pptx = require2("pptxgenjs");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const DECK = arg("deck"), ASSETS = arg("assets", ""), OUTF = arg("out"), TITLE = arg("title", "Presentation");
const deck = JSON.parse(fs.readFileSync(DECK, "utf8"));

// brand (neutral placeholder palette + font; swap for your own)
const INK = "0f172a", BODY = "333d52", MUTE = "828fa8", WHITE = "FFFFFF";
const PURPLE = "8b5cf6", LP = "8b5cf6", BLUE = "3b82f6", VIOLET = "7c3aed", AZURE = "0ea5e9", TEAL = "14b8a6", ROSE = "f43f5e", GREEN = "10b981";
const ACCENTS = [VIOLET, AZURE, TEAL, ROSE];
const NAVY = "0f172a";
const TAGLINE = process.env.BRAND_TAGLINE || "Acme platform";
const strip = (t) => String(t ?? "").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1").replace(/<[^>]*>/g, "");
const img = (f) => (f && ASSETS && fs.existsSync(path.join(ASSETS, f)) ? path.join(ASSETS, f) : null);

const p = new Pptx();
p.defineLayout({ name: "W", width: 13.33, height: 7.5 });
p.layout = "W";
p.author = "Acme"; p.title = deck.title || TITLE;

const W = 13.33, H = 7.5, M = 0.75; // margins honour the 5% safe zone
const dark = (s) => s.theme === "dark" || s.type === "section" || s.type === "cta";

function base(s) {
  const sl = p.addSlide();
  if (dark(s)) sl.background = { color: NAVY };
  else sl.background = { color: WHITE };
  return sl;
}
function title(sl, s, text, opts = {}) {
  const t = strip(text ?? s.title); if (!t) return 1.0;
  sl.addText(t, { x: M, y: 0.55, w: W - 2 * M, h: 0.9, fontFace: "Inter", fontSize: opts.size || 30, bold: true, color: dark(s) ? WHITE : INK, ...opts.pos });
  // short gradient underline stand-in (PowerPoint has no CSS gradients on shapes without fill tricks; two-tone bar)
  sl.addShape("rect", { x: M, y: 1.42, w: 0.9, h: 0.07, fill: { color: PURPLE }, line: { type: "none" } });
  sl.addShape("rect", { x: M + 0.9, y: 1.42, w: 0.45, h: 0.07, fill: { color: BLUE }, line: { type: "none" } });
  return 1.75;
}
const bodyOpts = (s, extra = {}) => ({ fontFace: "Inter", fontSize: 14, color: dark(s) ? "E8E6F5" : BODY, ...extra });

function bullets(sl, s, points, y) {
  const items = (points || []).map((x) => ({ text: strip(x), options: { bullet: { code: "2022", indent: 12 }, breakLine: true, paraSpaceAfter: 10 } }));
  sl.addText(items, { x: M, y, w: W - 2 * M, h: H - y - 0.6, ...bodyOpts(s, { fontSize: 16, valign: "top" }) });
}
function cardGrid(sl, s, cards, y, cols) {
  const n = cards.length; if (!n) return;
  cols = cols || (n <= 2 ? n : n <= 4 ? 2 : 3);
  const rows = Math.ceil(n / cols);
  const gw = (W - 2 * M - (cols - 1) * 0.3) / cols;
  const gh = Math.min(1.9, (H - y - 0.6 - (rows - 1) * 0.3) / rows);
  cards.forEach((c, i) => {
    const cx = M + (i % cols) * (gw + 0.3), cy = y + Math.floor(i / cols) * (gh + 0.3);
    sl.addShape("roundRect", { x: cx, y: cy, w: gw, h: gh, rectRadius: 0.12, fill: { color: dark(s) ? "241C4E" : "FFFFFF" }, line: { color: dark(s) ? "3A3266" : "E6EAF4", width: 1 } });
    sl.addShape("rect", { x: cx, y: cy, w: 0.09, h: gh, fill: { color: ACCENTS[i % 4] }, line: { type: "none" } });
    const head = strip(c.heading || c.name || c.value || "");
    const txt = strip(c.text || c.note || c.label || "");
    sl.addText([
      ...(head ? [{ text: head, options: { bold: true, fontSize: 15, color: dark(s) ? "FFFFFF" : INK, breakLine: true } }] : []),
      ...(txt ? [{ text: txt, options: { fontSize: 12.5, color: dark(s) ? "CFCBE8" : BODY } }] : []),
    ], { x: cx + 0.25, y: cy + 0.18, w: gw - 0.45, h: gh - 0.36, valign: "top", fontFace: "Inter" });
  });
}
function statRow(sl, s, stats, y) {
  const n = Math.min(stats.length, 4); if (!n) return;
  const gw = (W - 2 * M - (n - 1) * 0.35) / n;
  stats.slice(0, n).forEach((x, i) => {
    const cx = M + i * (gw + 0.35);
    sl.addShape("roundRect", { x: cx, y, w: gw, h: 2.1, rectRadius: 0.14, fill: { color: [VIOLET, INK, AZURE, TEAL][i % 4] }, line: { type: "none" } });
    sl.addText([
      { text: strip(x.value), options: { fontSize: 32, bold: true, color: "FFFFFF", breakLine: true } },
      { text: strip(x.label || x.sub || ""), options: { fontSize: 12.5, color: "E5E1F5" } },
    ], { x: cx + 0.25, y: y + 0.25, w: gw - 0.5, h: 1.6, valign: "top", fontFace: "Inter" });
  });
}

for (const s of deck.slides || []) {
  const sl = base(s);
  switch (s.type) {
    case "page": {
      const f = img(s.image);
      if (f) sl.addImage({ path: f, x: 0, y: 0, w: W, h: H, sizing: { type: "contain", w: W, h: H } });
      break;
    }
    case "cover": {
      sl.background = { color: WHITE };
      sl.addText(TAGLINE.toUpperCase(), { x: M, y: 2.0, w: 8, h: 0.4, fontSize: 12, color: PURPLE, charSpacing: 4, fontFace: "JetBrains Mono" });
      sl.addText(strip(s.title || deck.title), { x: M, y: 2.45, w: 8.6, h: 2.2, fontSize: 48, bold: true, color: INK, fontFace: "Inter" });
      if (s.subtitle) sl.addText(strip(s.subtitle), { x: M, y: 4.75, w: 5, h: 0.55, fontSize: 16, color: "FFFFFF", align: "center", fill: { color: PURPLE }, fontFace: "Inter" });
      const em = img("emblem.png"); if (em) sl.addImage({ path: em, x: 9.6, y: 2.2, w: 2.8, h: 2.8 });
      break;
    }
    case "section": case "cta": {
      sl.background = { color: NAVY };
      if (s.label || s.eyebrow) sl.addText(strip(s.label || s.eyebrow), { x: M, y: 2.6, w: 6, h: 0.5, fontSize: 14, color: LP, charSpacing: 3, fontFace: "JetBrains Mono" });
      sl.addText(strip(s.title), { x: M, y: 3.05, w: W - 2 * M, h: 1.4, fontSize: 44, bold: true, color: "FFFFFF", fontFace: "Inter" });
      if (s.subtitle) sl.addText(strip(s.subtitle), { x: M, y: 4.5, w: 9, h: 1.2, fontSize: 16, color: "D9D4F0", fontFace: "Inter" });
      if (s.type === "cta" && Array.isArray(s.chips)) sl.addText(s.chips.map(strip).join("     "), { x: M, y: 5.9, w: W - 2 * M, h: 0.5, fontSize: 14, color: LP, fontFace: "JetBrains Mono" });
      break;
    }
    case "kpi": case "metrics": {
      const y = title(sl, s);
      statRow(sl, s, s.stats || [], y + 0.2);
      if (s.type === "metrics" && s.chart) sl.addText("Trend chart: see HTML deck / speaker notes", { x: M, y: y + 2.7, w: 6, h: 0.4, ...bodyOpts(s, { italic: true, fontSize: 11, color: MUTE }) });
      break;
    }
    case "features": case "focus": case "announcements": case "awards": case "mission": {
      const y = title(sl, s);
      const cards = s.cards || s.items?.map((x) => (typeof x === "string" ? { text: x } : x)) || [];
      if (s.type === "mission" && s.statement) {
        sl.addShape("roundRect", { x: M, y, w: 5.6, h: 4.6, rectRadius: 0.14, fill: { color: PURPLE }, line: { type: "none" } });
        sl.addText(strip(s.statement), { x: M + 0.3, y: y + 0.3, w: 5.0, h: 4.0, fontSize: 17, color: "FFFFFF", fontFace: "Inter", valign: "top" });
        cardGrid(sl, { ...s, theme: s.theme }, s.cards || [], y, 1) || null;
      } else {
        cardGrid(sl, s, cards, y);
      }
      if (s.type === "focus" && s.table) {
        const rows = (s.table.rows || []).map((r) => r.map((c) => ({ text: strip(c), options: { fontSize: 12, fontFace: "Inter" } })));
        if (rows.length) sl.addTable(rows, { x: W / 2 + 0.2, y: 1.9, w: W / 2 - M - 0.2, border: { type: "solid", color: "E6EAF4", pt: 0.5 }, fill: { color: "FFFFFF" }, color: BODY });
      }
      break;
    }
    case "table": {
      const y = title(sl, s);
      const head = (s.headers || []).map((hd) => ({ text: strip(hd), options: { bold: true, color: "FFFFFF", fill: { color: INK }, fontSize: 12 } }));
      const rows = (s.rows || []).map((r) => r.map((c) => ({ text: strip(c), options: { fontSize: 12, color: BODY } })));
      sl.addTable([...(head.length ? [head] : []), ...rows], { x: M, y, w: W - 2 * M, border: { type: "solid", color: "E6EAF4", pt: 0.5 }, autoPage: false, fontFace: "Inter" });
      break;
    }
    case "celebration": {
      sl.addText(strip(s.name), { x: M, y: 1.6, w: 6.4, h: 1.0, fontSize: 36, bold: true, color: PURPLE, fontFace: "Inter" });
      sl.addText(strip(s.eyebrow || ""), { x: M, y: 2.6, w: 6, h: 0.4, fontSize: 14, color: INK, fontFace: "Inter" });
      if (s.message) sl.addText(strip(s.message), { x: M, y: 3.2, w: 5.8, h: 2.4, fontSize: 14, color: BODY, fontFace: "Inter", valign: "top" });
      if (s.role) sl.addText(strip(s.role), { x: M, y: 5.7, w: 3.2, h: 0.5, fontSize: 13, bold: true, color: "FFFFFF", align: "center", fill: { color: PURPLE } });
      const ph = img(s.image); if (ph) sl.addImage({ path: ph, x: 8.1, y: 1.55, w: 4.2, h: 4.2, rounding: true });
      break;
    }
    case "teamgrid": case "people": case "staffsat": {
      const y = title(sl, s);
      const ppl = s.people || (s.lines || []).map((l) => ({ name: l }));
      cardGrid(sl, s, ppl.map((x) => ({ heading: x.name, text: x.role || x.note || "" })), y);
      break;
    }
    case "quote": case "proof": {
      sl.addText(`“${strip(s.quote)}”`, { x: 1.6, y: 2.2, w: W - 3.2, h: 2.2, fontSize: 26, italic: true, color: dark(s) ? "FFFFFF" : INK, align: "center", fontFace: "Inter" });
      if (s.author) sl.addText(strip(s.author), { x: 1.6, y: 4.5, w: W - 3.2, h: 0.5, fontSize: 14, color: dark(s) ? "CFCBE8" : MUTE, align: "center", fontFace: "JetBrains Mono" });
      if (s.stats) statRow(sl, s, s.stats, 5.2);
      break;
    }
    case "textimage": case "image": case "showcase": {
      const y = title(sl, s);
      if (s.points) bullets(sl, { ...s }, s.points, y);
      const f = img(s.image || (s.screen ? `screen-${s.screen}.webp` : null));
      if (f) sl.addImage({ path: f, x: s.points ? 6.6 : M, y, w: s.points ? W - 6.6 - M : W - 2 * M, h: Math.min(4.8, H - y - 0.6), sizing: { type: "contain", w: s.points ? W - 6.6 - M : W - 2 * M, h: Math.min(4.8, H - y - 0.6) } });
      break;
    }
    case "map": case "deals": {
      const y = title(sl, s);
      const items = (s.markers || s.items || []).map((m) => (typeof m === "string" ? m : `${strip(m.label || m.value || "")}${m.place ? ` (${m.place})` : ""}`));
      bullets(sl, s, items, y);
      break;
    }
    case "columns": case "suppliers": {
      const y = title(sl, s);
      const groups = s.columns || s.groups || [];
      cardGrid(sl, s, groups.map((g) => ({ heading: strip(g.heading || ""), text: (g.items || []).map((it) => strip(typeof it === "string" ? it : it.label)).join("\n") })), y, Math.min(3, Math.max(1, groups.length)));
      break;
    }
    case "steps": case "agenda": case "timeline": {
      const y = title(sl, s);
      const its = s.steps || s.items || s.events || [];
      cardGrid(sl, s, its.map((x, i) => (typeof x === "string" ? { heading: `${i + 1}`, text: x } : { heading: x.heading || x.year || `${i + 1}`, text: x.text || x.label || "" })), y, Math.min(4, Math.max(2, its.length)));
      break;
    }
    default: {
      const y = title(sl, s);
      const pts = s.points || (s.html ? [strip(s.html).slice(0, 400)] : []) || [];
      if (pts.length) bullets(sl, s, pts, y);
      else if (s.subtitle || s.statement || s.brief) sl.addText(strip(s.subtitle || s.statement || s.brief), { x: M, y, w: W - 2 * M, h: 3, ...bodyOpts(s, { fontSize: 16, valign: "top" }) });
    }
  }
  // slide number, bottom-left per brand rule
  sl.addText(`${String((deck.slides.indexOf(s)) + 1).padStart(2, "0")}`, { x: M, y: H - 0.5, w: 1, h: 0.3, fontSize: 9, color: MUTE, fontFace: "JetBrains Mono" });
}

await p.writeFile({ fileName: OUTF });
console.log("NATIVE PPTX", OUTF);
