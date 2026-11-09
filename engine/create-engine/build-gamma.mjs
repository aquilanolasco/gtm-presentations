/* Build a deck via the GAMMA GENERATE API, using the brand's custom Gamma theme (GAMMA_THEME_ID).
   Produces the SAME <work> layout the relay already knows how to deploy, so the relay's deploy /
   thumb / done machinery is reused unchanged:
     <work>/exports/<slug>.pptx        downloaded from Gamma (native, editable, brand font embedded)
     <work>/exports/<slug>.pdf         soffice PPTX->PDF
     <work>/exports/slides/01.png      soffice first-slide PNG (relay downsizes -> thumb.png)
     <work>/deck/index.html            branded splash (preview pane); Present opens the Gamma url
     <work>/deck/deck.json             { slides:[...] } so the relay can read slideCount
     <work>/gamma-meta.json            { gammaUrl } for the relay to report to /api/create/done
   Usage: node build-gamma.mjs --file <path> --title "..." --slug <slug> --work <dir>
   Env:   GAMMA_API_KEY, GAMMA_THEME_ID, INGEST_PY (arm64 python), SOFFICE (optional path). */
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const FILE = arg("file"), TITLE = arg("title", "Presentation"), SLUG = arg("slug"), WORK = arg("work");
if (!FILE || !SLUG || !WORK) { console.error("usage: --file <path> --title <t> --slug <slug> --work <dir>"); process.exit(1); }

const KEY = process.env.GAMMA_API_KEY;
const THEME = process.env.GAMMA_THEME_ID;
if (!KEY) { console.error("GAMMA_API_KEY missing"); process.exit(1); }
const PY = process.env.INGEST_PY || "python3";
const API = "https://public-api.gamma.app/v1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const assets = path.join(WORK, "assets"); const deck = path.join(WORK, "deck");
const exp = path.join(WORK, "exports"); const slides = path.join(exp, "slides");
[assets, deck, exp, slides].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// 1) ingest the source to plain text (handles PDF/PPTX/DOCX/audio/text/image via ingest.py)
console.log("@@STAGE read");
console.log("@@LOG Reading your content…");
let inputText = "";
try {
  const out = execFileSync("arch", ["-arm64", PY, path.join(__dir, "ingest.py"), FILE, assets], { maxBuffer: 1 << 28 });
  const data = JSON.parse(out.toString());
  inputText = (data.pages || []).map((p) => (p.text || "").trim()).filter(Boolean).join("\n\n").trim();
} catch (e) {
  // text/markdown sources: just read the file
  try { inputText = fs.readFileSync(FILE, "utf8").trim(); } catch { /* ignore */ }
  if (!inputText) console.log("@@LOG ingest note:", String(e).slice(0, 120));
}
if (!inputText) inputText = TITLE;
inputText = inputText.slice(0, 40000); // Gamma inputText ceiling; keep it sane

// 2) kick off a Gamma generation on the brand theme
console.log("@@STAGE write");
console.log("@@LOG Building your deck with Gamma…");
const body = {
  inputText,
  textMode: "generate",            // let Gamma structure + write a proper deck from the content
  format: "presentation",
  ...(THEME ? { themeId: THEME } : {}),
  additionalInstructions:
    "Audience: <target audience>. Tone: confident, warm, direct. " +
    "Short punchy headlines, concrete specifics, active voice. No jargon, no em-dashes, no emojis. " +
    "Keep Acme brand voice.",
  exportAs: "pptx",
};
const post = await fetch(`${API}/generations`, {
  method: "POST", headers: { "X-API-KEY": KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
if (!post.ok) { console.error("Gamma POST failed", post.status, (await post.text()).slice(0, 300)); process.exit(1); }
const { generationId } = await post.json();
if (!generationId) { console.error("Gamma returned no generationId"); process.exit(1); }
console.log("@@LOG Gamma is designing your slides…");

// 3) poll until the generation completes (Gamma builds server-side; typically 30-120s)
let gammaUrl = "", exportUrl = "";
for (let i = 0; i < 90; i++) {
  await sleep(5000);
  const g = await fetch(`${API}/generations/${generationId}`, { headers: { "X-API-KEY": KEY } });
  if (!g.ok) continue;
  const j = await g.json();
  if (j.status === "completed") { gammaUrl = j.gammaUrl || ""; exportUrl = j.exportUrl || ""; break; }
  if (j.status === "failed" || j.status === "error") { console.error("Gamma generation failed", JSON.stringify(j).slice(0, 300)); process.exit(1); }
  if (i % 2 === 0) console.log("@@LOG Still designing…");
}
if (!exportUrl) { console.error("Gamma generation timed out without an export"); process.exit(1); }

// 4) download the native PPTX export
console.log("@@STAGE export");
console.log("@@LOG Downloading your PowerPoint…");
const pptxPath = path.join(exp, `${SLUG}.pptx`);
const dl = await fetch(exportUrl);
if (!dl.ok) { console.error("PPTX download failed", dl.status); process.exit(1); }
fs.writeFileSync(pptxPath, Buffer.from(await dl.arrayBuffer()));

// 5) thumbnail: Gamma's PPTX does not load in LibreOffice, so instead of rendering slide 1 we pull
//    the slide's own cover image straight out of the PPTX and hand it to the relay as slides/01.png
//    (the relay downsizes it to thumb.png). PDF is skipped for Gamma decks in v1 (PPTX is primary).
const pdfReady = false;
try {
  const rels = execFileSync("unzip", ["-p", pptxPath, "ppt/slides/_rels/slide1.xml.rels"]).toString();
  const media = [...rels.matchAll(/Target="\.\.\/(media\/[^"]+)"/g)].map((m) => "ppt/" + m[1]).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));
  let best = null, bestSize = 0;
  for (const n of media) {
    try { const l = execFileSync("unzip", ["-l", pptxPath, n]).toString(); const sz = parseInt((l.match(/\n\s*(\d+)/) || [])[1] || "0", 10); if (sz > bestSize) { bestSize = sz; best = n; } } catch { /* skip */ }
  }
  if (best) {
    const raw = execFileSync("unzip", ["-p", pptxPath, best], { maxBuffer: 1 << 28 });
    const tmp = path.join(slides, "cover." + best.split(".").pop());
    fs.writeFileSync(tmp, raw);
    try { execFileSync("sips", ["-s", "format", "png", "-Z", "1200", tmp, "--out", path.join(slides, "01.png")], { stdio: "ignore" }); }
    catch { fs.copyFileSync(tmp, path.join(slides, "01.png")); }
  }
} catch (e) { console.log("@@LOG thumb skipped:", String(e).slice(0, 80)); }

// 6) slide count (count slideN.xml in the pptx) + a minimal deck.json the relay reads
let slideCount = 0;
try {
  const names = execFileSync("unzip", ["-Z1", pptxPath]).toString();
  slideCount = (names.match(/ppt\/slides\/slide\d+\.xml/g) || []).length;
} catch { /* leave 0 */ }
console.log(`@@SLIDES ${slideCount || 1}`);
for (let i = 1; i <= slideCount; i++) console.log(`@@SLIDE ${i}`);
fs.writeFileSync(path.join(deck, "deck.json"), JSON.stringify({ slides: Array.from({ length: slideCount || 1 }, (_, i) => ({ n: i })) }));

// 7) branded splash for the preview pane (Gamma decks can't be iframed, so we show a clean opener)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
fs.writeFileSync(path.join(deck, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(TITLE)} — Acme</title>
<style>*{box-sizing:border-box}html,body{margin:0;height:100%}
body{display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 120% at 20% 10%,#efe7ff,transparent 60%),radial-gradient(120% 120% at 90% 90%,#e6eeff,transparent 55%),#faf9ff;font-family:system-ui,-apple-system,sans-serif;color:#0f172a;text-align:center;padding:2rem}
.c{max-width:520px}.badge{font:600 .7rem/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8b5cf6}
h1{font-size:1.9rem;letter-spacing:-.02em;margin:.6rem 0 .4rem;text-wrap:balance}p{color:#4b5563;line-height:1.5;text-wrap:balance}
.btn{display:inline-flex;align-items:center;gap:.5rem;margin-top:1.3rem;padding:.85rem 1.5rem;border-radius:999px;background:linear-gradient(135deg,#8b5cf6,#8b5cf6,#3b82f6);color:#fff;font-weight:600;text-decoration:none;box-shadow:0 12px 30px rgba(139,92,246,.35);white-space:nowrap}
.sub{margin-top:.9rem}.sub a{color:#8b5cf6;font-size:.85rem;text-decoration:none;margin:0 .5rem}</style></head>
<body><div class="c"><div class="badge">Built with Gamma</div><h1>${esc(TITLE)}</h1>
<p>This deck is hosted in Gamma so it stays fully editable. Open it to present, or download the PowerPoint and PDF.</p>
<a class="btn" href="${esc(gammaUrl)}" target="_top" rel="noopener">Open presentation &rsaquo;</a>
<div class="sub"><a href="../${esc(SLUG)}.pptx" download>Download PPTX</a>${pdfReady ? `<a href="../${esc(SLUG)}.pdf" download>Download PDF</a>` : ""}</div></div></body></html>`);

// 8) meta for the relay to report gammaUrl + pdfReady
fs.writeFileSync(path.join(WORK, "gamma-meta.json"), JSON.stringify({ gammaUrl, pdfReady, slideCount }));
console.log("@@STAGE publish");
console.log(`DONE-GAMMA ${SLUG} slides=${slideCount} url=${gammaUrl}`);
