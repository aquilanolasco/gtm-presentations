// Which logo goes on the cover? The design rule: the prospect's own logo, always directly on
// the white cover, never a badge behind it. A site often only carries the white version, so we gather
// every version we can find (their site, then a web image search for "<client> logo"), download them
// all, and let Claude look at them and choose the official dark or coloured one. If nothing suitable
// exists anywhere, the worker recolours the white artwork (engage-assets.mjs darkenLogo).
//
// Web search, best-effort and keyless: Bing Images through headless Chrome answers reliably from the
// VPS (about a second); Google serves the VPS a bot wall and DuckDuckGo a bot challenge after a few
// queries, so those are only fallbacks. Results are cached on disk for a day per query, because the
// Create pane's look-up and the worker both ask.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import puppeteer from "puppeteer";
import Anthropic from "@anthropic-ai/sdk";
import { fetchBin, looksLight } from "./engage-assets.mjs";

const CACHE_DIR = process.env.ENGAGE_SEARCH_CACHE || "/tmp/engage-search-cache";
const cacheFile = (q) => path.join(CACHE_DIR, crypto.createHash("sha1").update(q.toLowerCase()).digest("hex") + ".json");
function readCache(q) { try { const f = cacheFile(q); if (Date.now() - fs.statSync(f).mtimeMs < 24 * 3600e3) return JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* miss */ } return null; }
function writeCache(q, v) { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cacheFile(q), JSON.stringify(v)); } catch { /* best-effort */ } }

async function bingImages(query, limit) {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--lang=en-GB"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
    try { await page.waitForSelector("a.iusc", { timeout: 12000 }); } catch { /* no results rendered */ }
    const rows = await page.evaluate((n) => [...document.querySelectorAll("a.iusc")].slice(0, n).map((a) => { try { const m = JSON.parse(a.getAttribute("m")); return { url: m.murl, title: m.t || "", page: m.purl || "" }; } catch { return null; } }).filter(Boolean), limit);
    return rows.map((r) => ({ ...r, source: "bing" }));
  } finally { await browser.close().catch(() => {}); }
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MODEL = process.env.ENGAGE_MODEL || "claude-opus-5-5";
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const LOGO_HOSTS = /wikimedia|wikipedia|brandfetch|seeklogo|logos-world|vectorlogo|worldvectorlogo|logotyp|brandsoftheworld|crunchbase|licdn\.com|logo\.clearbit|cdn\.worldvectorlogo|1000logos|logowik|pngwing|freelogovectors/i;

export async function searchLogoImages(query, { limit = 14 } = {}) {
  const hit = readCache(query);
  if (hit) return hit;
  const out = [];
  const add = (url, extra) => { if (!url || !/^https?:\/\//i.test(url) || out.some((o) => o.url === url)) return; out.push({ url, host: host(url), ...extra }); };
  try { for (const r of await bingImages(query, limit)) add(r.url, { source: "bing", title: r.title, page: r.page }); } catch { /* browser or Bing unavailable */ }
  // Google basic results (imgurl= links). Answers with a bot wall from the VPS, so this is best-effort.
  if (out.length < 4) try {
    const r = await fetch(`https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0", "Accept-Language": "en", Cookie: "CONSENT=YES+cb; SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LyaBg" },
      signal: AbortSignal.timeout(6000),
    });
    const html = await r.text();
    for (const m of html.matchAll(/imgurl=([^&"]+)/g)) { add(decodeURIComponent(m[1]), { source: "google" }); if (out.length >= limit) break; }
  } catch { /* unreachable or walled */ }
  if (out.length < 4) {
    try {
      const h = await (await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) })).text();
      const vqd = (h.match(/vqd="?([\d-]+)"?/) || [])[1];
      if (vqd) {
        const j = await (await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,,,&p=1`, { headers: { "User-Agent": UA, Referer: "https://duckduckgo.com/" }, signal: AbortSignal.timeout(9000) })).json();
        for (const r of j.results || []) { add(r.image, { source: "duckduckgo", title: r.title, w: r.width, h: r.height, page: r.url }); if (out.length >= limit) break; }
      }
    } catch { /* no web results */ }
  }
  if (out.length) writeCache(query, out);
  return out;
}

/* Rank web results so the likeliest logo files come first (the client's own domain, known logo
   libraries, PNG/SVG, wordmark proportions, "logo" in the title); news photos drop to the back. */
export function rankWebLogos(results, domain) {
  const base = (domain || "").replace(/^www\./, "").split(".")[0];
  return results.map((r) => {
    let s = 0;
    const u = r.url.toLowerCase();
    if (domain && r.host && (r.host === domain || r.host.endsWith("." + domain))) s += 3;
    if (domain && r.page && host(r.page) && (host(r.page) === domain || host(r.page).endsWith("." + domain))) s += 2;
    if (LOGO_HOSTS.test(r.host || "")) s += 2;
    if (/\.(png|svg|webp)($|\?)/.test(u)) s += 1;
    if (/\.jpe?g($|\?)/.test(u)) s -= 1;
    if (/logo/.test(u) || /logo/i.test(r.title || "")) s += 1;
    if (base && u.includes(base)) s += 1;
    if (r.w && r.h) { const ar = r.w / r.h; if (ar >= 1.2 && ar <= 6) s += 1; if (r.w < 120) s -= 2; }
    if (/facebook|instagram|twitter|x\.com|youtube|tiktok|pinterest/.test(r.host || "")) s -= 2;
    return { ...r, rank: s };
  }).sort((a, b) => b.rank - a.rank);
}

/* Download and normalise every candidate (site first, then the web). Each usable candidate gets a
   preview PNG on white (what the cover would show) plus a WHITE-artwork flag. */
export async function collectCandidates({ scout, client, domain, log = () => {}, maxSite = 6, maxWeb = 8 }) {
  const cands = [];
  for (const l of (scout.logos || []).slice(0, maxSite)) if (l.score >= 0) cands.push({ url: l.url, source: "site", host: l.url.startsWith("data:") ? domain : host(l.url), page: l.page });
  let web = [];
  try { web = rankWebLogos(await searchLogoImages(`${client} logo`), domain); } catch { /* none */ }
  for (const r of web.slice(0, maxWeb)) if (!cands.some((c) => c.url === r.url)) cands.push({ url: r.url, source: "web", host: r.host, title: r.title, searched: r.source });
  log(`Logo candidates: ${cands.filter((c) => c.source === "site").length} from their site, ${cands.filter((c) => c.source === "web").length} from the web`);
  const ok = [];
  for (const c of cands) {
    try {
      const { buf, ct } = await fetchBin(c.url, scout.url);
      const head = buf.subarray(0, 400).toString("utf8");
      const isSvg = /svg/.test(ct) || /^\s*(<\?xml|<svg|<!DOCTYPE svg)/i.test(head);
      let png;
      if (isSvg) png = await sharp(buf, { density: 144 }).resize({ width: 800, fit: "inside" }).png().toBuffer();
      else {
        try { png = await sharp(buf).ensureAlpha().trim({ threshold: 18 }).resize({ width: 800, height: 400, fit: "inside", withoutEnlargement: true }).png().toBuffer(); }
        catch { png = await sharp(buf).ensureAlpha().resize({ width: 800, height: 400, fit: "inside", withoutEnlargement: true }).png().toBuffer(); }
      }
      const meta = await sharp(png).metadata();
      if (!meta.width || meta.width < 48 || meta.height < 14) continue;
      c.w = meta.width; c.h = meta.height; c.isSvg = isSvg; c.light = await looksLight(png);
      c.preview = await sharp(png).flatten({ background: "#ffffff" }).resize({ width: 440, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      ok.push(c);
    } catch (e) { c.err = String(e).slice(0, 70); }
    if (ok.length >= 12) break;
  }
  return ok;
}

const SYSTEM = `You choose the client's logo for the cover of a co-branded sales deck. The cover is WHITE and the logo sits directly on it next to the Acme logo, with no badge or box behind it.
Rules, in order:
1. It must be the client's OWN official logo. Reject other companies' logos, partner or franchise brand marks, awards and "best places to work" badges, app-store or booking-widget marks, review badges, social icons, screenshots, photos, banners with people, and images where the logo is a small part of something else.
2. It must read on white: dark or coloured artwork. White or very pale artwork is unusable (it would be invisible), so it can only ever be the backup.
3. Prefer the full primary logo (wordmark, or emblem with wordmark) over an emblem or icon alone. Prefer clean, isolated artwork (transparent or plain background, no extra text, no border) over busy crops. When two are equally good, prefer the one from their own website, then the larger one.
Reply with JSON only: {"pick": <candidate number, or 0 if none qualifies>, "backup": <number or 0>, "reason": "<at most 20 words>"}`;

export async function chooseLogo(cands, client, { log = () => {} } = {}) {
  if (!cands.length) return { pick: 0, backup: 0, reason: "no candidates" };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const api = new Anthropic({ apiKey: key });
  const content = [{ type: "text", text: `Client: ${client}. ${cands.length} candidates follow, numbered. Which one goes on the white cover?` }];
  cands.forEach((c, i) => {
    content.push({ type: "text", text: `Candidate ${i + 1}: ${c.source === "site" ? "from their website" : `from a web search (${c.host})`}, ${c.w}x${c.h}${c.isSvg ? ", SVG" : ""}${c.light ? ". NOTE: white artwork, shown here on white so it looks blank" : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: c.preview.toString("base64") } });
  });
  content.push({ type: "text", text: "JSON only." });
  const res = await api.messages.create({ model: MODEL, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content }] });
  const text = res.content.filter((x) => x.type === "text").map((x) => x.text).join("").replace(/```(?:json)?/g, "");
  if (!text.trim() || res.stop_reason !== "end_turn") log(`Logo reply: stop_reason ${res.stop_reason}, blocks ${res.content.map((x) => x.type).join(",") || "none"}, ${res.usage?.output_tokens} output tokens`);
  const m = text.match(/\{[\s\S]*\}/);
  let out = { pick: 0, backup: 0, reason: "unparsed" };
  try { const j = JSON.parse(m ? m[0] : "{}"); out = { pick: Math.max(0, Math.min(cands.length, parseInt(j.pick, 10) || 0)), backup: Math.max(0, Math.min(cands.length, parseInt(j.backup, 10) || 0)), reason: String(j.reason || "").slice(0, 160) }; } catch { /* keep default */ }
  log(`Claude chose ${out.pick ? `candidate ${out.pick} (${cands[out.pick - 1].source}${cands[out.pick - 1].host ? ", " + cands[out.pick - 1].host : ""})` : "none"}: ${out.reason || text.slice(0, 160).replace(/\s+/g, " ")}`);
  return out;
}

/* The brand's own dark colour for recolouring a white logo; black when the site has none. */
export function pickBrandColor(brandColors) {
  const list = Array.isArray(brandColors) ? brandColors : [];
  const good = list.find((c) => c.lum < 110 && (c.sat > 40 || /theme|header|footer/.test(c.src)));
  return good ? good.hex : "#0f172a";
}

/* The cover photo: the prospect's own property, nothing else. The scout's heuristics (og:image, the
   biggest picture above the fold) happily return a news image of someone else's hotel, so Claude looks
   at the candidates and picks one, or none (then the cover uses the full-width layout). */
const HERO_SYSTEM = `You choose the photo for the right-hand side of a sales deck cover prepared for a hotel company. Pick one candidate only if it clearly shows THEIR property or operation: a hotel exterior, lobby, room, restaurant, bar, pool or venue. Reject photos with another company's or brand's signage or logo visible, stock-looking images, maps, graphics, text overlays, portraits or group photos of people, awards, screenshots, and anything blurry or tiny. Prefer a wide, well-lit, professional image. Reply with JSON only: {"pick": <candidate number, or 0 if none qualifies>, "reason": "<at most 20 words>"}`;

export async function collectHeroCandidates({ scout, log = () => {}, max = 5 }) {
  const out = [];
  for (const h of (scout.heroes || []).slice(0, max + 3)) {
    try {
      const { buf } = await fetchBin(h.url, scout.url);
      const m = await sharp(buf).metadata();
      if (!m.width || !m.height || m.width < 640 || m.height < 360) continue;
      if (m.width / m.height > 3.2 || m.width / m.height < 0.7) continue;
      out.push({ url: h.url, w: m.width, h: m.height, preview: await sharp(buf).resize({ width: 520, fit: "inside" }).jpeg({ quality: 80 }).toBuffer() });
    } catch { /* not an image */ }
    if (out.length >= max) break;
  }
  log(`Cover photo candidates: ${out.length}`);
  return out;
}

export async function chooseHero(cands, client, { log = () => {} } = {}) {
  if (!cands.length) return { pick: 0, reason: "no candidates" };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const api = new Anthropic({ apiKey: key });
  const content = [{ type: "text", text: `Client: ${client}. ${cands.length} photo candidates follow, numbered.` }];
  cands.forEach((c, i) => { content.push({ type: "text", text: `Candidate ${i + 1}: ${c.w}x${c.h}` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: c.preview.toString("base64") } }); });
  content.push({ type: "text", text: "JSON only." });
  const res = await api.messages.create({ model: MODEL, max_tokens: 800, system: HERO_SYSTEM, messages: [{ role: "user", content }] });
  const text = res.content.filter((x) => x.type === "text").map((x) => x.text).join("").replace(/```(?:json)?/g, "");
  let out = { pick: 0, reason: "unparsed" };
  try { const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]); out = { pick: Math.max(0, Math.min(cands.length, parseInt(j.pick, 10) || 0)), reason: String(j.reason || "").slice(0, 160) }; } catch { /* keep default */ }
  log(`Cover photo: ${out.pick ? `candidate ${out.pick}` : "none"} (${out.reason || text.slice(0, 120)})`);
  return out;
}
