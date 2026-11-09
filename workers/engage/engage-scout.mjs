// Prospect site scout for the engagement deck engine. Opens the prospect's website in headless Chrome
// (hotel sites 403 naive fetches and render their logos with JS) and pulls what the deck needs: the
// company name, description, logo candidates, hero photo candidates, the visible copy, and (deep mode)
// the copy of a few "about / our hotels / portfolio" pages too.
//
//   node engage-scout.mjs <url> [--deep]      -> JSON on stdout   (the Create pane calls --quick, the worker --deep)
//   import { scout } from "./engage-scout.mjs"
//
// Lives at /var/www/acme-gtm-workers/engage/ on the VPS (puppeteer + the cached Chrome are in the parent folder).
import puppeteer from "puppeteer";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) throw new Error("no url");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const url = new URL(u);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error("not a website address");
  return url.toString();
}

// Runs INSIDE the page. Everything is plain DOM so it serialises back as JSON.
function extractInPage() {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ""; } };
  const meta = (sel) => { const m = document.querySelector(sel); return (m && (m.getAttribute("content") || "").trim()) || ""; };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const title = clean(document.title);
  const siteName = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]');
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  // company name: og:site_name, else the <title> segment that matches the domain ("Global Hotel Management
  // Company | Example Hotels" -> "Example Hotels"), else the proper noun the description opens with
  // ("Example Hotels is a global..."), else the first title segment, else the domain.
  const domainWord = location.hostname.replace(/^www\./, "").split(".")[0].toLowerCase();
  const segs = title.split(/\s[|\-–—:·]\s/).map((x) => x.trim()).filter(Boolean);
  const matchesDomain = (x) => domainWord.length > 3 && x.toLowerCase().replace(/[^a-z0-9]/g, "").includes(domainWord.replace(/[^a-z0-9]/g, "").slice(0, Math.max(4, Math.min(domainWord.length, 10))));
  const descLead = (description.match(/^([A-Z][\w&'.-]*(?:\s+(?:of|the|and|&|[A-Z][\w&'.-]*)){0,4})\s+(?:is|are|was|offers|provides|operates|owns|manages|has)\b/) || [])[1] || "";
  const genericTitle = (x) => /hotel|hotels|resort|home|welcome|official|book|luxury|management|company|group|collection|hospitality/i.test(x) && x.split(/\s+/).length > 3;
  const name = siteName || segs.find(matchesDomain) || (descLead && matchesDomain(descLead) ? descLead : "") || (segs[0] && !genericTitle(segs[0]) ? segs[0] : "") || descLead || segs[segs.length - 1] || location.hostname.replace(/^www\./, "");

  // ---- logo candidates ----
  const logos = [];
  const seen = new Set();
  const push = (url, el, kind, bonus) => {
    if (!url || seen.has(url)) return;
    let w = 0, h = 0, top = 9999, inHead = false;
    if (el) {
      const r = el.getBoundingClientRect();
      w = Math.round(r.width); h = Math.round(r.height); top = Math.round(r.top + scrollY);
      inHead = !!el.closest("header, nav, [class*=header i], [class*=navbar i], [id*=header i], [class*=masthead i], [class*=topbar i]");
      if (el.tagName === "IMG") { w = el.naturalWidth || w; h = el.naturalHeight || h; }
    }
    const txt = ((el && (el.getAttribute("alt") || "") + " " + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "") + " " + (el.id || "") + " " + url) || "").toLowerCase();
    let score = bonus;
    if (inHead) score += 3;
    if (/logo|brand|wordmark/.test(txt)) score += 2;
    if (/\.svg($|\?)|^data:image\/svg/.test(url)) score += 1;
    if (w && h) { const ar = w / h; if (ar >= 1.4 && ar <= 8) score += 1; if (h < 16 || w < 40) score -= 3; }
    if (top < 220) score += 1;
    if (/icon|favicon|sprite|arrow|flag|badge|award|payment|visa|mastercard|tripadvisor|facebook|instagram|twitter|linkedin|youtube/.test(txt) && !/logo/.test(txt)) score -= 3;
    // third-party widgets (booking engines, review badges, chat) carry their OWN logos
    if (/widget|designmynight|trustpilot|tripadvisor|opentable|sevenrooms|resdiary|bookatable|google|facebook|instagram|cookiebot|cookielaw|onetrust|intercom|zendesk|hubspot|revinate|synxis|travelclick|guestline|mews/.test(url.toLowerCase())) score -= 5;
    seen.add(url);
    logos.push({ url, w, h, kind, score });
  };
  const logoEls = document.querySelectorAll('header img, nav img, [class*=logo i] img, img[alt*=logo i], img[src*=logo i], a[href="/"] img, a[href="./"] img, [class*=brand i] img');
  logoEls.forEach((el) => push(abs(el.currentSrc || el.src || el.getAttribute("data-src") || ""), el, "img", 0));
  // inline SVG logos (very common on hotel sites): serialise the markup
  document.querySelectorAll('header svg, nav svg, [class*=logo i] svg, a[href="/"] svg').forEach((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 12) return;
    let html = el.outerHTML; if (html.length > 120000) return;
    if (!/xmlns=/.test(html)) html = html.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    // an SVG that only references a <symbol> defined elsewhere renders empty on its own
    if (/<use\b/.test(html) && !/<symbol\b/.test(html)) return;
    const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(html)));
    push(url, el, "svg", 1);
  });
  // CSS background logos
  document.querySelectorAll('header [class*=logo i], nav [class*=logo i], a[href="/"], [class*=brand i]').forEach((el) => {
    const bg = getComputedStyle(el).backgroundImage || "";
    const m = bg.match(/url\(["']?([^"')]+)["']?\)/); if (!m) return;
    push(abs(m[1]), el, "bg", 0);
  });
  // icons as a last resort
  document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').forEach((l) => {
    const href = abs(l.getAttribute("href") || ""); if (!href) return;
    const sz = parseInt((l.getAttribute("sizes") || "0").split("x")[0], 10) || 0;
    push(href, null, "icon", sz >= 120 ? -1 : -3);
  });
  logos.sort((a, b) => b.score - a.score);

  // ---- hero photo candidates ----
  const heroes = [];
  const hseen = new Set();
  const hpush = (url, w, h, score) => { if (!url || hseen.has(url) || /\.svg($|\?)|^data:/.test(url)) return; hseen.add(url); heroes.push({ url, w, h, score }); };
  const og = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
  if (og) hpush(abs(og), 0, 0, 5);
  document.querySelectorAll("img").forEach((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 520 || r.height < 280 || r.top + scrollY > innerHeight * 2.5) return;
    const u = abs(el.currentSrc || el.src || ""); if (!u) return;
    const ar = r.width / r.height; if (ar > 3.2 || ar < 0.6) return;
    hpush(u, el.naturalWidth || Math.round(r.width), el.naturalHeight || Math.round(r.height), 3 + (r.top + scrollY < innerHeight ? 1 : 0));
  });
  document.querySelectorAll("section, div, header, main").forEach((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 700 || r.height < 320 || r.top + scrollY > innerHeight * 2.5) return;
    const bg = getComputedStyle(el).backgroundImage || ""; const m = bg.match(/url\(["']?([^"')]+)["']?\)/); if (!m) return;
    hpush(abs(m[1]), Math.round(r.width), Math.round(r.height), 2);
  });
  // video poster frames read well too
  document.querySelectorAll("video[poster]").forEach((v) => hpush(abs(v.getAttribute("poster")), 0, 0, 2));
  heroes.sort((a, b) => b.score - a.score);

  // ---- copy ----
  const text = clean(document.body ? document.body.innerText : "").slice(0, 9000);
  const links = [];
  const lseen = new Set();
  document.querySelectorAll("a[href]").forEach((a) => {
    const t = clean(a.innerText).toLowerCase(); const href = abs(a.getAttribute("href"));
    if (!href || !href.startsWith(location.origin) || lseen.has(href) || href === location.href) return;
    if (/^(about( us)?|who we are|our (story|hotels|properties|portfolio|brands|collection|group|company|business)|hotels|properties|portfolio|destinations|locations|brands|the group|company|corporate|restaurants|food|dining|about the group)$/.test(t) || /\/(about|our-story|portfolio|our-hotels|hotels|properties|destinations|locations|brands|group|company|corporate)\/?$/i.test(href)) {
      lseen.add(href); links.push({ href, text: t });
    }
  });
  // ---- dark brand colours (for recolouring a white logo when the brand has no dark version) ----
  const colors = [];
  const parse = (c) => { const m = (c || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/); if (!m) return null; const a = m[4] === undefined ? 1 : parseFloat(m[4]); if (a < 0.95) return null; const r = +m[1], g = +m[2], b = +m[3]; return { hex: "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join(""), lum: 0.2126 * r + 0.7152 * g + 0.0722 * b, sat: Math.max(r, g, b) - Math.min(r, g, b) }; };
  const cpush = (c, src, w) => { const p = parse(c); if (!p || p.lum > 110) return; colors.push({ ...p, src, w }); };
  cpush(meta('meta[name="theme-color"]'), "theme", 3);
  document.querySelectorAll('header, nav, [class*=header i], [class*=navbar i], footer, [class*=footer i]').forEach((el, i) => { if (i > 8) return; const cs = getComputedStyle(el); cpush(cs.backgroundColor, /foot/i.test(el.tagName + el.className) ? "footer" : "header", 2); });
  document.querySelectorAll('button, a[class*=btn i], a[class*=button i], a[class*=cta i], [class*=btn-primary i]').forEach((el, i) => { if (i > 24) return; const cs = getComputedStyle(el); const p = parse(cs.backgroundColor); if (p && p.lum < 90) colors.push({ ...p, src: "button", w: 3 }); });
  document.querySelectorAll("h1, h2").forEach((el, i) => { if (i > 6) return; cpush(getComputedStyle(el).color, "heading", 1); });
  const byHex = new Map();
  for (const c of colors) { const cur = byHex.get(c.hex) || { ...c, score: 0, n: 0 }; cur.n++; cur.score += c.w + (c.sat > 60 ? 2 : 0); byHex.set(c.hex, cur); }
  const brandColors = [...byHex.values()].sort((a, b) => b.score - a.score).slice(0, 5).map((c) => ({ hex: c.hex, lum: Math.round(c.lum), sat: c.sat, src: c.src, score: c.score }));
  return { url: location.href, name, title, description, logos: logos.slice(0, 8), heroes: heroes.slice(0, 6), text, links: links.slice(0, 8), brandColors };
}

async function dismissConsent(page) {
  try {
    await page.evaluate(() => {
      const rx = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|agree|i agree|i accept|got it|ok(ay)?|continue|yes,? i agree|accept and close)$/i;
      const els = [...document.querySelectorAll("button, a, [role=button]")];
      for (const el of els) { const t = (el.innerText || "").trim(); if (rx.test(t)) { el.click(); return true; } }
      return false;
    });
    await new Promise((r) => setTimeout(r, 600));
  } catch { /* no consent UI */ }
}

async function openPage(browser, url, timeout) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-GB,en;q=0.9" });
  let status = 0;
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle2", timeout });
    status = resp ? resp.status() : 0;
  } catch (e) {
    // many hotel sites never reach network idle (chat widgets, trackers): fall back to whatever loaded
    if (!/Timeout/i.test(String(e))) throw e;
  }
  await dismissConsent(page);
  // let lazy hero images / JS logos settle
  await new Promise((r) => setTimeout(r, 1200));
  return { page, status };
}

export async function scout(rawUrl, { deep = false, timeout = 25000 } = {}) {
  const url = normalizeUrl(rawUrl);
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  try {
    const { page, status } = await openPage(browser, url, timeout);
    const home = await page.evaluate(extractInPage);
    home.status = status;
    home.domain = new URL(home.url || url).hostname.replace(/^www\./, "");
    const pages = [];
    if (deep && home.links.length) {
      const picks = home.links.slice(0, 3);
      for (const l of picks) {
        try {
          const sub = await openPage(browser, l.href, Math.min(timeout, 18000));
          const d = await sub.page.evaluate(extractInPage);
          pages.push({ url: d.url, title: d.title, text: d.text.slice(0, 5000) });
          // extra hero candidates from the about/portfolio pages
          for (const h of d.heroes.slice(0, 3)) if (!home.heroes.some((x) => x.url === h.url)) home.heroes.push({ ...h, score: h.score - 1 });
          for (const l of d.logos.slice(0, 4)) if (l.score >= 2 && !home.logos.some((x) => x.url === l.url)) home.logos.push({ ...l, score: l.score - 1, page: d.url });
          await sub.page.close();
        } catch (e) { pages.push({ url: l.href, error: String(e).slice(0, 120) }); }
      }
    }
    home.pages = pages;
    return home;
  } finally {
    await browser.close().catch(() => {});
  }
}

// plain-fetch fallback for when Chrome cannot open the site at all
export async function scoutLite(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  const m = (re) => { const x = html.match(re); return x ? x[1].trim() : ""; };
  const abs = (u) => { try { return new URL(u, url).href; } catch { return ""; } };
  const name = m(/property=["']og:site_name["'][^>]*content=["']([^"']+)/i) || m(/<title[^>]*>([^<]+)<\/title>/i).split(/\s[|\-–—:·]\s/)[0] || new URL(url).hostname.replace(/^www\./, "");
  const description = m(/name=["']description["'][^>]*content=["']([^"']+)/i) || m(/property=["']og:description["'][^>]*content=["']([^"']+)/i);
  const og = m(/property=["']og:image["'][^>]*content=["']([^"']+)/i);
  const logos = [];
  for (const x of html.matchAll(/<img[^>]+src=["']([^"']*logo[^"']*)["']/gi)) logos.push({ url: abs(x[1]), w: 0, h: 0, kind: "img", score: 2 });
  for (const x of html.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/gi)) logos.push({ url: abs(x[1]), w: 0, h: 0, kind: "icon", score: -2 });
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 9000);
  return { url, status: r.status, domain: new URL(url).hostname.replace(/^www\./, ""), name, title: name, description, logos, heroes: og ? [{ url: abs(og), w: 0, h: 0, score: 5 }] : [], text, links: [], pages: [], lite: true };
}

export async function scoutAny(rawUrl, opts) {
  try { return await scout(rawUrl, opts); }
  catch (e) { const lite = await scoutLite(rawUrl); lite.error = String(e).slice(0, 160); return lite; }
}

// CLI
if (process.argv[1] && /engage-scout\.mjs$/.test(process.argv[1])) {
  const url = process.argv[2];
  const deep = process.argv.includes("--deep");
  if (!url) { console.error("usage: node engage-scout.mjs <url> [--deep]"); process.exit(2); }
  scoutAny(url, { deep }).then(async (r) => {
    // quick mode (the Create pane's Look up): add web search results so the rep can pick one
    if (!deep) { try { const { searchLogoImages, rankWebLogos } = await import("./engage-logosearch.mjs"); r.webLogos = rankWebLogos(await searchLogoImages(`${r.name} logo`), r.domain).slice(0, 8).map((x) => ({ url: x.url, host: x.host, title: x.title, w: x.w, h: x.h })); } catch { r.webLogos = []; } }
    process.stdout.write(JSON.stringify(r)); process.exit(0);
  })
    .catch((e) => { console.error(String(e)); process.exit(1); });
}
