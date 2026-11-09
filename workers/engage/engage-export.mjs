// Export an engagement deck: capture every slide of the LIVE deck with headless Chrome (chrome hidden,
// cover-aligned padding, shrink-only fit, same rules as the deck engine's web-deck/deck-export-capture.mjs),
// then stitch the PNGs into a PPTX (one full-bleed picture per 13.333 x 7.5 in slide) and a PDF
// (3200 x 1800 pt pages, JPEG inside), the exact shape the Presentations module already serves.
// Chrome resolves the app's domain (APP_DOMAIN) to this box, so the capture never leaves the VPS or touches the CDN.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import sharp from "sharp";
import PptxGenJS from "pptxgenjs";
import { PDFDocument } from "pdf-lib";

const W = 1600, H = 900;
const PAD_X = 9.4, PAD_Y = 6.0;
const BAND = Math.round(W - (2 * PAD_X / 100) * W);
const HIDE_CSS = `.pp-sidenav,.v2-topctl,.pp-rail,.pp-slidenum,.pp-arrow,[class*=pp-arrow],.pp-progress,#pp-edit-bar,.ppc-ui,.wb-hint,.wb-pulse{display:none!important}
.pp-slide:not(.cta-slide){padding:${PAD_Y}vh ${PAD_X}vw!important}
.pp-slide:not(.cta-slide) .pp-inner{max-width:${BAND}px!important;width:auto!important;margin:0!important}
.pp .r,.pp .stagger>*,.pp-slide>.pp-inner,.frag{opacity:1!important;transform:none!important;transition:none!important;animation:none!important}
.grad-move{animation:none!important}
html{scroll-behavior:auto!important}.pp-deck{scroll-behavior:auto!important}
/* the closing page keeps the approved export inset (the live deck insets it to clear the sidebar) */
.cta-slide{padding-left:5.875vw!important}.cta-site{left:5.875vw!important}
/* body copy in Inter (self-hosted by the template), never the Linux system-ui fallback */
.pp{font-family:var(--font-inter),Inter,system-ui,sans-serif!important}
/* the Introduction deck's live product screens (the platform tablet, the module devices) are iframes
   scaled by a CSS variable; the capture flattens transforms, so the export shows their posters instead,
   exactly as the master deck's own export does */
.cur-frame,#dashFrame iframe{display:none!important}
.f7-shot{opacity:1!important}`;

// shrink-only fit with zoom (never transform: the deck positions slides with transform) for the ONE slide
// being captured, measured against that slide's own padding. It used to re-fit every slide on every
// capture with viewport-relative numbers: a slide already scrolled past measured as fitting, lost its
// zoom and grew back to its natural height, which pushed the slide on screen down under the scroll
// position (the previous slide's cards or stats at the top of the page) and fitted it against a negative
// height (zoom 0.4: the tiny results and every-category pages). A fitted slide now keeps its zoom.
const FIT = `(idx) => { const vh=innerHeight;
  const slide=document.querySelectorAll('.pp-slide')[idx]; if(!slide||slide.classList.contains('cta-slide')) return;
  const inner=slide.querySelector(':scope > .pp-inner'); if(!inner) return;
  inner.style.zoom=''; inner.style.transform='none'; inner.style.height='auto';
  const cs=getComputedStyle(slide);
  const availH=vh-(parseFloat(cs.paddingTop)||0)-(parseFloat(cs.paddingBottom)||0);
  const ir=inner.getBoundingClientRect();
  let R=-1e9,B=-1e9;
  const walk=(el)=>{ for(const c of el.children){ const st=getComputedStyle(c); if(st.display!=='none'&&st.visibility!=='hidden'&&parseFloat(st.opacity)>0.01){ const r=c.getBoundingClientRect(); if(r.width>2&&r.height>2){ if(r.right>R)R=r.right; if(r.bottom>B)B=r.bottom; } } walk(c);} };
  walk(inner);
  const cw=R-ir.left, ch=B-ir.top;
  if(cw<=0||ch<=0) return;
  const s=Math.min(ir.width/cw, availH/ch, 1);
  if(s<0.995) inner.style.zoom=String(Math.max(s,0.4));
}`;

// the app's public host. Read when Chrome launches (not at import), so a value the worker loads from its
// .env after its imports still applies.
const appDomain = () => process.env.APP_DOMAIN ?? "app.example.com";
export const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--ignore-certificate-errors", "--font-render-hinting=none"];
const launchArgs = () => [...LAUNCH_ARGS, `--host-resolver-rules=MAP ${appDomain()} 127.0.0.1`];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openDeck(browser, url, expected) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  await page.setCacheEnabled(false);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  // an engagement deck says when it has rendered (its slide count can change under an export when the
  // rep hides or adds a slide meanwhile); other decks are ready once the expected slides exist
  await page.waitForFunction((n) => {
    const c = document.querySelectorAll(".pp-slide").length;
    return c >= n || (document.documentElement.hasAttribute("data-engage") && window.__ppEditsApplied === 1 && c > 0);
  }, { timeout: 45000 }, expected);
  // engagement decks apply the Slide Editor's saved words / sizes / photos (edits.json) after the slides
  // render: wait for that before capturing, so the downloads carry the rep's edits
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-engage") || window.__ppEditsApplied === 1, { timeout: 8000 }).catch(() => {});
  await page.evaluate((css) => { const st = document.createElement("style"); st.id = "pp-export-hide"; st.textContent = css; document.head.appendChild(st); }, HIDE_CSS);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // images: give lazy ones a moment, then wait for every img in the deck
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll(".pp-slide img")];
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 4000); }))));
  });
  return page;
}

async function captureSlide(page, i, file) {
  await page.evaluate((idx) => {
    const slides = document.querySelectorAll(".pp-slide");
    slides.forEach((s, j) => {
      s.classList.add("in"); s.querySelectorAll(".frag").forEach((f) => f.classList.add("frag-in"));
      // only the slide being captured is painted: a neighbour's fanned cards, background photo or
      // module card can extend past its own section and would otherwise show at the top of this page
      s.style.visibility = j === idx ? "" : "hidden";
    });
    const el = slides[idx]; if (!el) return;
    window.scrollTo({ top: el.offsetTop, behavior: "instant" });
    // only the ENTRANCE animations are neutralised (HIDE_CSS does the same with !important); a design
    // transform stays: a tilted or scaled device, the fanned six-step cards, the timeline. Stripping every
    // transform flattened those and let their cards spill onto the next slide's capture.
    el.querySelectorAll(".r,.stagger>*,.frag").forEach((e) => { e.style.transform = "none"; e.style.opacity = "1"; });
  }, i);
  await sleep(350);
  await page.evaluate(`(${FIT})(${i})`);
  await sleep(650);
  // counters finish within 1.3s of a slide getting .in (the proof, global, results and who-we-are slides);
  // the module showcase and the display-card stack animate for a little longer
  const anim = await page.evaluate((idx) => { const s = document.querySelectorAll(".pp-slide")[idx]; if (!s) return 0; if (s.querySelector(".ms,.dcards,.vt-node")) return 2; return s.querySelector(".sp-proof,.sd-proof,.sd-globe-stats,.cfo-band,.stat .v,.neb-stats") ? 1 : 0; }, i);
  if (anim === 2) await sleep(1900); else if (anim === 1) await sleep(1200);
  // no clip: puppeteer clips in DOCUMENT coordinates, so a clip at y=0 would always be the cover. The
  // viewport is exactly one 1600x900 slide, so a plain viewport shot is the slide on screen.
  const buf = await page.screenshot({ type: "png", captureBeyondViewport: false });
  fs.writeFileSync(file, buf);
  return page.evaluate((idx) => document.querySelectorAll(".pp-slide")[idx]?.id || "?", i);
}

/* Layout check for one slide, run on the live deck BEFORE the shrink-to-fit: how much taller than the
   screen the content is (that is what gets shrunk), text wider than its box, a title on three lines, one
   card carrying far more text than its neighbours. Returns plain-language issues for the writer. */
const CHECK = `(idx) => {
  const slide = document.querySelectorAll('.pp-slide')[idx]; const out = [];
  if (!slide) return ['slide not found'];
  const inner = slide.querySelector(':scope > .pp-inner');
  const cs = getComputedStyle(slide);
  const avail = innerHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  if (inner) {
    inner.style.zoom = ''; inner.style.transform = 'none'; inner.style.height = 'auto';
    const nat = inner.scrollHeight;
    if (nat > avail * 1.03) out.push('The content is ' + Math.round((nat / avail - 1) * 100) + '% taller than the slide, so it has to be shrunk to fit. Cut words: fewer bullets, shorter sentences, or one card less.');
    if (inner.scrollWidth > inner.clientWidth + 3) out.push('Something is wider than the slide.');
  }
  const short = (t) => t.trim().replace(/\\s+/g, ' ').slice(0, 50);
  slide.querySelectorAll('h2,h3,p,li,td,th,.gw-row-items>div').forEach((el) => {
    const t = el.innerText || ''; if (!t.trim()) return;
    if (el.scrollWidth > el.clientWidth + 3) out.push('"' + short(t) + '" does not fit the width of its box.');
    if (el.tagName === 'H2') { const lh = parseFloat(getComputedStyle(el).lineHeight) || 1; const lines = Math.round(el.getBoundingClientRect().height / lh); if (lines > 2) out.push('The title runs to ' + lines + ' lines; make it shorter.'); }
  });
  const cards = [...slide.querySelectorAll('.gw-card')];
  if (cards.length > 1) { const lens = cards.map((c) => (c.innerText || '').length); const mx = Math.max(...lens), mn = Math.min(...lens); if (mn > 0 && mx > mn * 2.2) out.push('One card has more than twice the text of another; balance them.'); }
  return out;
}`;

/* Render ONE slide of the live deck (by its data-sid): the layout check, then the capture as it will
   export (shrink-to-fit applied). Returns { file, issues }. */
export async function captureOne({ url, sid, expected, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: "new", args: launchArgs() });
  try {
    const page = await openDeck(browser, url, expected);
    const idx = await page.evaluate((s) => [...document.querySelectorAll(".pp-slide")].findIndex((el) => el.getAttribute("data-sid") === s), sid);
    if (idx < 0) throw new Error(`slide ${sid} is not in the deck`);
    await page.evaluate((i) => { const el = document.querySelectorAll(".pp-slide")[i]; el.classList.add("in"); window.scrollTo({ top: el.offsetTop, behavior: "instant" }); }, idx);
    await sleep(400);
    const issues = await page.evaluate(`(${CHECK})(${idx})`);
    const file = path.join(outDir, `slide-${sid}.png`);
    await captureSlide(page, idx, file);
    await page.close();
    return { file, issues: Array.isArray(issues) ? issues : [] };
  } finally { await browser.close().catch(() => {}); }
}

/* Capture all slides of the deck at `url` (which must render `expected` .pp-slide sections).
   Returns the ordered list of PNG paths. With `sigKeys`, also captures the closing page once per
   presenter key via ?sig=<key> and returns { slides, closings: { key: png } }. */
export async function captureDeck({ url, expected, outDir, sigKeys = [], log = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: "new", args: launchArgs() });
  try {
    const page = await openDeck(browser, url, expected);
    const n = await page.evaluate(() => document.querySelectorAll(".pp-slide").length);
    const slides = [];
    for (let i = 0; i < n; i++) {
      const f = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
      const id = await captureSlide(page, i, f);
      slides.push(f);
      log(`Captured slide ${i + 1}/${n} (${id})`);
    }
    await page.close();
    const closings = {};
    for (const key of sigKeys) {
      try {
        const p2 = await openDeck(browser, url + (url.includes("?") ? "&" : "?") + "sig=" + key, expected);
        const f = path.join(outDir, `closing-${key}.png`);
        const n2 = await p2.evaluate(() => document.querySelectorAll(".pp-slide").length);
        await captureSlide(p2, n2 - 1, f);
        closings[key] = f;
        await p2.close();
        log(`Captured closing page for ${key}`);
      } catch (e) { log(`Closing variant ${key} skipped: ${String(e).slice(0, 80)}`); }
    }
    return { slides, closings };
  } finally { await browser.close().catch(() => {}); }
}

export async function buildPptx(files, out) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PP169", width: 13.333, height: 7.5 });
  pptx.layout = "PP169";
  for (const f of files) {
    const s = pptx.addSlide();
    s.addImage({ path: f, x: 0, y: 0, w: 13.333, h: 7.5 });
  }
  await pptx.writeFile({ fileName: out });
}

export async function buildPdf(files, out, quality = 88) {
  const doc = await PDFDocument.create();
  for (const f of files) {
    const jpg = await sharp(f).jpeg({ quality }).toBuffer();
    const im = await doc.embedJpg(jpg);
    const pg = doc.addPage([3200, 1800]);
    pg.drawImage(im, { x: 0, y: 0, width: 3200, height: 1800 });
  }
  fs.writeFileSync(out, await doc.save());
}

/* Build <slug>.pptx/.pdf (+ --<key> variants) into every target dir. */
export async function assembleExports({ slug, slides, closings = {}, targets, log = () => {} }) {
  const tmp = fs.mkdtempSync("/tmp/engage-exp-");
  const sets = [["", slides]];
  for (const [key, png] of Object.entries(closings)) sets.push([`--${key}`, [...slides.slice(0, -1), png]]);
  const made = [];
  for (const [suffix, files] of sets) {
    const pptx = path.join(tmp, `${slug}${suffix}.pptx`), pdf = path.join(tmp, `${slug}${suffix}.pdf`);
    await buildPptx(files, pptx);
    await buildPdf(files, pdf);
    made.push(pptx, pdf);
    log(`Built ${slug}${suffix}.pptx + .pdf (${files.length} pages)`);
  }
  for (const dir of targets) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of made) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return made.map((f) => path.basename(f));
}

/* The /p/<slug>/index.html wrapper (same pills as the relay's viewer: PPTX, PDF, Share, Full screen, Presentations, + Edit). */
export function viewerHTML(slug, title, editable = true) {
  const icon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>';
  const pen = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const t = String(title).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const app = `https://${appDomain()}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t} — Acme</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,-apple-system,sans-serif;background:#fff}
.d{position:fixed;top:20px;right:22px;z-index:10;display:flex;gap:8px}
.d a{display:inline-flex;align-items:center;gap:7px;padding:9px 15px 9px 12px;border-radius:999px;background:rgba(255,255,255,.92);border:1px solid #ecebf5;color:#0f172a;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;font-weight:600;text-decoration:none;box-shadow:0 14px 40px #0f172a17;backdrop-filter:blur(8px);transition:color .2s,border-color .2s;white-space:nowrap}
.d a:hover{color:#8b5cf6;border-color:#ddd6fe}
.d a.edit{background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;border:0;box-shadow:0 14px 40px rgba(139,92,246,.4)}
.d a.edit:hover{color:#fff;filter:brightness(1.06)}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head>
<body><div class="d">${editable ? `<a class="edit" href="${app}/presentations?edit=${slug}" target="_top">${pen}<span>Edit</span></a>` : ""}<a href="./${slug}.pptx" download>${icon}<span>PPTX</span></a><a href="./${slug}.pdf" download>${icon}<span>PDF</span></a><a href="#" onclick="navigator.clipboard.writeText('${app}/public/presentations/${slug}');this.querySelector('span').textContent='COPIED';return false"><span>SHARE</span></a><a href="#" onclick="(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());return false"><span>FULL SCREEN</span></a><a href="${app}/presentations" target="_top"><span>&lsaquo; PRESENTATIONS</span></a></div>
<iframe id="dk" src="deck/" title="${t}"></iframe>
<script>var _f=document.getElementById('dk');_f.src='deck/'+(location.hash||'');</script></body></html>`;
}
