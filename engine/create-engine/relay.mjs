/* Local Create relay (runs on a local Mac, which has the ingest/render/export tooling + Canva).
   Polls the app for a queued Create job, generates the deck, deploys it public, imports to
   Canva, and reports done. Env: ANTHROPIC_API_KEY, RELAY_SECRET, APP_URL / APP_DOMAIN, VPS_SSH.
   Run persistently.
   node relay.mjs   (loops; ctrl-c to stop) */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL ?? `https://${process.env.APP_DOMAIN ?? "app.example.com"}`;
const VPS = process.env.VPS_SSH ?? "root@<VPS_HOST>";
const SECRET = (process.env.RELAY_SECRET || fs.readFileSync("/tmp/relay_secret.txt","utf8")).trim();
const CANVA = process.env.CANVA_PY || path.join(os.homedir(), "presentation-agent", "canva", "canva.py");
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: "utf8", maxBuffer: 1 << 28, ...o });

// push a live progress patch to the app (best-effort; never blocks the build)
const prog = (id, patch) => fetch(`${APP}/api/create/progress`, {
  method: "POST", headers: { "x-relay-secret": SECRET, "Content-Type": "application/json" },
  body: JSON.stringify({ id, ...patch }),
}).catch(() => {});

// run build-one.mjs streaming: parse @@STAGE/@@SLIDES/@@SLIDE/@@LOG markers into progress patches,
// forward everything else as a log line. Resolves on exit 0, rejects otherwise.
function runBuild(id, args) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", args, { cwd: __dir });
    let buf = "", tail = "";
    const handle = (chunk, isErr) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trimEnd(); buf = buf.slice(nl + 1);
        if (!line) continue;
        process.stdout.write(line + "\n");
        let m;
        if ((m = line.match(/^@@STAGE (\w+)/))) prog(id, { stage: m[1] });
        else if ((m = line.match(/^@@SLIDES (\d+)/))) prog(id, { slidesTotal: +m[1] });
        else if ((m = line.match(/^@@SLIDE (\d+)/))) prog(id, { slidesDone: +m[1] });
        else if ((m = line.match(/^@@LOG (.+)/))) prog(id, { log: m[1] });
        else if (!isErr) prog(id, { log: line.slice(0, 160) });
      }
      tail = buf;
    };
    p.stdout.on("data", (c) => handle(c, false));
    p.stderr.on("data", (c) => handle(c, true));
    p.on("error", reject);
    p.on("close", (code) => { if (tail.trim()) process.stdout.write(tail + "\n"); code === 0 ? resolve() : reject(new Error("build-one exited " + code)); });
  });
}

function viewerHTML(slug, title, hasPdf = true, editable = false) {
  // top rail matches the master decks' .v2-ctl control pills exactly (mono uppercase, white, bordered)
  const icon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>';
  const pen = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Acme</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,-apple-system,sans-serif;background:#fff}
/* buttons float top-right OVER the deck (no separate top bar, no second logo) — matches the master decks;
   the only logo on screen is the deck's own top-left logo inside the iframe */
.d{position:fixed;top:20px;right:22px;z-index:10;display:flex;gap:8px}
.d a{display:inline-flex;align-items:center;gap:7px;padding:9px 15px 9px 12px;border-radius:999px;background:rgba(255,255,255,.92);border:1px solid #ecebf5;color:#0f1424;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;font-weight:600;text-decoration:none;box-shadow:0 14px 40px #0f142417;backdrop-filter:blur(8px);transition:color .2s,border-color .2s}
.d a:hover{color:#8b5cf6;border-color:#dcd4ff}
.d a.edit{background:linear-gradient(135deg,#8b5cf6,#8b5cf6,#3b82f6);color:#fff;border:0;box-shadow:0 14px 40px rgba(139,92,246,.4)}
.d a.edit:hover{color:#fff;filter:brightness(1.06)}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head>
<body><div class="d">${editable ? `<a class="edit" href="${APP}/presentations?edit=${slug}" target="_top">${pen}<span>Edit</span></a>` : ""}<a href="./${slug}.pptx" download>${icon}<span>PPTX</span></a>${hasPdf ? `<a href="./${slug}.pdf" download>${icon}<span>PDF</span></a>` : ""}<a href="#" onclick="navigator.clipboard.writeText(location.href);this.querySelector('span').textContent='COPIED';return false"><span>SHARE</span></a><a href="#" onclick="(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());return false"><span>FULL SCREEN</span></a><a href="${APP}/presentations" target="_top"><span>&lsaquo; PRESENTATIONS</span></a></div>
<iframe id="dk" src="deck/" title="${title}"></iframe>
<script>var _f=document.getElementById('dk'),_c=new URLSearchParams(location.search).get('cur');_f.src='deck/'+(_c?('?cur='+encodeURIComponent(_c)):'')+(location.hash||'');
addEventListener('message',function(e){if(e.data&&e.data.type==='ppCur'){try{var u=new URL(location.href);u.searchParams.set('cur',e.data.cur);history.replaceState(null,'',u)}catch(x){}}});</script></body></html>`;
}

async function poll() {
  const r = await fetch(`${APP}/api/create/next`, { headers: { "x-relay-secret": SECRET } });
  if (!r.ok) { console.log("poll", r.status); return; }
  const { job } = await r.json();
  if (!job) return;
  console.log("JOB", job.id, job.title);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "create-"));
  const src = path.join(work, `source.${job.ext}`);
  try {
    if (job.edit) {
      // EDIT job: re-render the deck from the edited spec (+ optional AI op), reusing the deck's existing assets.
      await prog(job.id, { stage: "edit", log: "Applying your edits…" });
      sh("scp", ["-q", `${VPS}:/var/www/presentation-spool/${job.id}/edit.json`, path.join(work, "edit.json")]);
      const spec = JSON.parse(fs.readFileSync(path.join(work, "edit.json"), "utf8"));
      const assets = path.join(work, "assets"); fs.mkdirSync(assets, { recursive: true });
      // the deck's source images live in the published deck's assets — pull them so re-render can reference them
      try { sh("rsync", ["-az", `${VPS}:/var/www/presentation-public/${job.slug}/deck/assets/`, assets + "/"]); } catch {}
      const specFile = path.join(work, "deck-spec.json");
      fs.writeFileSync(specFile, JSON.stringify(spec.deck));
      const deckDir = path.join(work, "deck");
      const gen = path.join(__dir, "generate.mjs");
      const genArgs = spec.op
        ? [gen, "--editdeck", specFile, "--slide", String(spec.op.slide), "--instruction", spec.op.instruction, "--assets", assets, "--title", job.title, "--out", deckDir, "--cover", job.cover || "master"]
        : [gen, "--deckjson", specFile, "--assets", assets, "--title", job.title, "--out", deckDir, "--cover", job.cover || "master"];
      await runBuild(job.id, genArgs);
      await prog(job.id, { stage: "export", log: "Capturing slides…" });
      const exp = path.join(work, "exports"); fs.mkdirSync(exp, { recursive: true });
      const exportDir = process.env.EXPORT_DIR || path.join(os.homedir(), "presentation-agent", "export");
      sh("node", [path.join(exportDir, "export-deck.mjs"), deckDir, "", job.slug, exp, job.title]);
    } else {
      // 1) pull the uploaded source from the VPS spool
      await prog(job.id, { stage: "read", log: "Fetching your file…" });
      sh("scp", ["-q", `${VPS}:/var/www/presentation-spool/${job.id}/source.${job.ext}`, src]);
      // 2) build with the engine the user chose: "gamma" (Gamma API) or "claude" (in-app HTML deck).
      //    Both stream @@STAGE/@@SLIDE/@@LOG progress and leave the same work/ layout for deploy.
      if (job.engine === "gamma") {
        await runBuild(job.id, [path.join(__dir, "build-gamma.mjs"), "--file", src, "--title", job.title, "--slug", job.slug, "--work", work]);
      } else {
        await runBuild(job.id, [path.join(__dir, "build-one.mjs"), "--file", src, "--title", job.title, "--slug", job.slug, "--work", work, "--cover", job.cover || "gradient", "--mode", job.mode === "quick" ? "quick" : "full"]);
      }
    }
    // 3) deploy: public deck + viewer + exports (public + authed)
    await prog(job.id, { stage: "publish", log: "Publishing your deck…" });
    sh("ssh", [VPS, `mkdir -p /var/www/presentation-public/${job.slug}/deck /var/www/presentation-exports/${job.slug}`]);
    sh("rsync", ["-az", "--delete", path.join(work, "deck") + "/", `${VPS}:/var/www/presentation-public/${job.slug}/deck/`]);
    const pdf = path.join(work, "exports", `${job.slug}.pdf`), pptx = path.join(work, "exports", `${job.slug}.pptx`);
    // Gamma decks ship PPTX only (no PDF in v1), so only rsync the PDF when it exists.
    const expFiles = [pptx, ...(fs.existsSync(pdf) ? [pdf] : [])];
    sh("rsync", ["-az", ...expFiles, `${VPS}:/var/www/presentation-public/${job.slug}/`]);
    sh("rsync", ["-az", ...expFiles, `${VPS}:/var/www/presentation-exports/${job.slug}/`]);
    fs.writeFileSync(path.join(work, "index.html"), viewerHTML(job.slug, job.title, fs.existsSync(pdf), job.engine !== "gamma"));
    sh("scp", ["-q", path.join(work, "index.html"), `${VPS}:/var/www/presentation-public/${job.slug}/index.html`]);
    // real brand logo for the viewer header (not text)
    try {
      const logo = path.join(process.env.BRAND_ASSETS_DIR || "", "acme", "logo.png");
      if (fs.existsSync(logo)) sh("scp", ["-q", logo, `${VPS}:/var/www/presentation-public/${job.slug}/logo.png`]);
    } catch {}
    // thumbnail: downscale the first captured slide and publish it for the My Decks card
    let thumbReady = false;
    try {
      const s1 = path.join(work, "exports", "slides", "01.png");
      const thumb = path.join(work, "thumb.png");
      if (fs.existsSync(s1)) {
        sh("sips", ["-Z", "900", s1, "--out", thumb]);
        sh("scp", ["-q", thumb, `${VPS}:/var/www/presentation-public/${job.slug}/thumb.png`]);
        thumbReady = true;
      }
    } catch (e) { console.log("thumb skipped:", String(e).slice(0, 60)); }
    // (Canva import intentionally removed — decided later; generation must never push to Canva.)
    // slide count
    let slideCount = 0; try { slideCount = JSON.parse(fs.readFileSync(path.join(work, "deck", "deck.json"), "utf8")).slides.length; } catch {}
    // Gamma decks report the hosted gamma.app url (Present / Edit on Gamma) + whether a PDF exists.
    let gammaUrl = null, pdfReady = fs.existsSync(pdf);
    try { const meta = JSON.parse(fs.readFileSync(path.join(work, "gamma-meta.json"), "utf8")); gammaUrl = meta.gammaUrl || null; if (typeof meta.pdfReady === "boolean") pdfReady = meta.pdfReady; } catch {}
    // 4) report done
    await fetch(`${APP}/api/create/done`, { method: "POST", headers: { "x-relay-secret": SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id, status: "ready", slideCount, deckUrl: `/p/${job.slug}/`, pptxReady: true, pdfReady, thumbReady, ...(gammaUrl ? { gammaUrl } : {}) }) });
    console.log("DONE", job.slug, "->", `${APP}/p/${job.slug}/`);
  } catch (e) {
    console.error("FAILED", job.id, String(e).slice(0, 200));
    await fetch(`${APP}/api/create/done`, { method: "POST", headers: { "x-relay-secret": SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id, status: "failed", statusMsg: String(e).slice(0, 180) }) });
  } finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch {} }
}

console.log("Create relay running. Polling", APP);
while (true) { try { await poll(); } catch (e) { console.error("loop err", String(e).slice(0, 120)); } await new Promise((r) => setTimeout(r, 5000)); }
