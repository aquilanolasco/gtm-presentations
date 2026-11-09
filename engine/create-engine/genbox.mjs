/* Generate Box — local 4-lane bench: four strategies for "drop a doc, get a branded deck".
   http://localhost:8123           -> hub with the four lanes
   /lane/gamma   Ours (Gamma quality): engine + balanced Brand-Kit palette + vision QA loop
   /lane/hybrid  Hybrid: gamma + bespoke "novel" slide fallback for layouts no template fits
   /lane/pptx    Anthropic pptx skill (headless Claude Code -> native PPTX -> PDF preview)
   presenton     runs separately in Docker at http://localhost:5001 (hub links to it)
   All local. Nothing publishes. Env from relay.env (Anthropic). */
import { createServer } from "node:http";
import { spawn, execFileSync, execFile } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8123;
const ROOT = path.join(os.tmpdir(), "genbox");
fs.mkdirSync(ROOT, { recursive: true });

for (const f of [path.join(os.homedir(), "Library/Application Support/pp-create-relay/relay.env"), path.join(__dir, "relay.env")]) {
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=("?)(.*)\2\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
    }
    console.log("env loaded from", f); break;
  }
}
const RUI = process.env.EXPORT_DIR || path.join(os.homedir(), "presentation-agent", "export");
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/local/bin/soffice"].find((p) => fs.existsSync(p));
// claude CLI: not on PATH here; use the newest VS Code extension's bundled native binary
const CLAUDE = (() => {
  try {
    const extDir = path.join(os.homedir(), ".vscode/extensions");
    const vers = fs.readdirSync(extDir).filter((d) => d.startsWith("anthropic.claude-code-")).sort();
    for (let i = vers.length - 1; i >= 0; i--) {
      const bin = path.join(extDir, vers[i], "resources/native-binary/claude");
      if (fs.existsSync(bin)) return bin;
    }
  } catch {}
  return "claude";
})();
console.log("claude cli:", CLAUDE);

const jobs = {}; // id -> {status, log[], title, mode, slides?, error?, exports?}
// persist job state so a server restart never orphans a running browser session
const persist = () => { try { for (const [id, j] of Object.entries(jobs)) fs.writeFileSync(path.join(ROOT, id, "job.json"), JSON.stringify({ ...j, _approve: undefined })); } catch {} };
setInterval(persist, 4000).unref();
try {
  for (const id of fs.readdirSync(ROOT)) {
    const f = path.join(ROOT, id, "job.json");
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      // anything that was mid-flight when the server died: if its output exists, mark ready; else failed
      if (!["ready", "failed", "outline_ready"].includes(j.status)) {
        if (j.mode === "pptx" && fs.existsSync(path.join(ROOT, id, "deck.pptx"))) { j.status = "ready"; j.pdf = fs.existsSync(path.join(ROOT, id, "deck.pdf")); j.log.push("Recovered after restart: PPTX was completed."); }
        else if (fs.existsSync(path.join(ROOT, id, "deck", "index.html"))) { j.status = "ready"; j.log.push("Recovered after restart."); }
        else { j.status = "failed"; j.error = "interrupted by a server restart"; }
      }
      if (j.status === "outline_ready") { j.status = "failed"; j.error = "outline approval interrupted by restart, please re-run"; }
      jobs[id] = j;
    } catch {}
  }
  console.log("recovered", Object.keys(jobs).length, "job(s)");
} catch {}
const okExt = ["pdf", "pptx", "docx", "txt", "md", "png", "jpg", "jpeg"];
const SONNET = { CREATE_MODEL: "claude-sonnet-5", GEN_MODEL: "claude-sonnet-5" };
const MODES = { gamma: { GEN_STYLE2: "1" }, hybrid: { GEN_STYLE2: "1", GEN_NOVEL: "1", GEN_V5: "1", ...SONNET }, best: { GEN_STYLE2: "1", GEN_NOVEL: "1", GEN_V5: "1", ...SONNET }, base: {}, pptx: null, presenton: null };

function stream(j, cmd, args, env, onClose) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env } });
  let buf = "";
  const onData = (c) => {
    buf += c.toString(); let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      const m = line.match(/^@@LOG (.+)/);
      if (m) j.log.push(m[1]);
      else if (!line.startsWith("@@")) j.log.push(line.slice(0, 160));
    }
  };
  p.stdout.on("data", onData); p.stderr.on("data", onData);
  p.on("close", onClose);
  return p;
}

function runEngineJob(id, srcFile, title, cover, mode, wantOutline) {
  const j = jobs[id];
  const work = path.join(ROOT, id);
  const assets = path.join(work, "assets"); const deck = path.join(work, "deck");
  fs.mkdirSync(assets, { recursive: true }); fs.mkdirSync(deck, { recursive: true });
  const env = MODES[mode] || {};
  j.status = "reading"; j.log.push("Reading your file…");
  let ing;
  try {
    const out = execFileSync("arch", ["-arm64", process.env.INGEST_PY || "python3", path.join(__dir, "ingest.py"), srcFile, assets], { maxBuffer: 1 << 28 });
    ing = path.join(work, "ing.json"); fs.writeFileSync(ing, out);
  } catch (e) { j.status = "failed"; j.error = "ingest: " + String(e).slice(0, 300); return; }
  if (wantOutline) {
    // outline-approval phase (best lane): cheap text pass, then wait for POST /approve/<id>
    j.status = "outlining"; j.log.push("Proposing an outline for your approval…");
    stream(j, "node", [path.join(__dir, "generate.mjs"), "--outline", "--ingest", ing, "--assets", assets, "--title", title, "--out", work], env, (oc) => {
      const of = path.join(work, "outline.json");
      if (oc !== 0 || !fs.existsSync(of)) { j.log.push("Outline pass failed; generating directly."); startGenerate(); return; }
      try { j.outline = JSON.parse(fs.readFileSync(of, "utf8")).outline || []; } catch { j.outline = []; }
      if (!j.outline.length) { startGenerate(); return; }
      j.status = "outline_ready"; j.log.push("Outline ready. Review it above, then approve to continue.");
    });
    j._approve = (edited) => {
      try { fs.writeFileSync(path.join(work, "outline.json"), JSON.stringify({ outline: edited }, null, 1)); } catch {}
      j.log.push("Outline approved. Designing your slides…");
      startGenerate(path.join(work, "outline.json"));
    };
    return;
  }
  startGenerate();
  function startGenerate(outlineFile) {
  j.status = "writing"; j.log.push(mode === "gamma" ? "Designing your slides with AI…" : "Designing slides (templates + bespoke fallback)…");
  const genArgs = [path.join(__dir, "generate.mjs"), "--ingest", ing, "--assets", assets, "--title", title, "--out", deck, "--cover", cover];
  if (outlineFile) genArgs.push("--outlinehint", outlineFile);
  stream(j, "node", genArgs, env, (code) => {
    if (code !== 0 || !fs.existsSync(path.join(deck, "index.html"))) { j.status = "failed"; j.error = "generate exited " + code; return; }
    try { j.slides = JSON.parse(fs.readFileSync(path.join(deck, "deck.json"), "utf8")).slides.length; } catch {}
    // vision QA pass (both gamma + hybrid lanes)
    j.status = "qa"; j.log.push("Design QA: screenshotting every slide and fixing weak ones…");
    stream(j, "node", [path.join(__dir, "qa-pass.mjs"), "--work", work, "--title", title, "--cover", cover], env, (qc) => {
      if (qc !== 0) j.log.push("QA pass had trouble; keeping the pre-QA deck.");
      try { j.tokens = JSON.parse(fs.readFileSync(path.join(deck, "tokens.json"), "utf8")); } catch {}
      j.seconds = Math.round((Date.now() - (j.t0 || Date.now())) / 1000);
      j.status = "ready"; j.log.push(`Done in ${j.seconds}s.` + (j.tokens ? ` Tokens in=${j.tokens.in} out=${j.tokens.out}.` : ""));
    });
  });
  }
}

function runCopyJob(id, srcFile, title) {
  const j = jobs[id]; const work = path.join(ROOT, id); const deck = path.join(work, "deck");
  fs.mkdirSync(deck, { recursive: true });
  j.status = "writing"; j.log.push("Keeping your original slides, wrapping them in the deck shell…");
  stream(j, "node", [path.join(__dir, "copy-deck.mjs"), "--file", srcFile, "--title", title, "--out", work, "--cover", "hybrid"], {}, (code) => {
    if (code !== 0 || !fs.existsSync(path.join(deck, "index.html"))) { j.status = "failed"; j.error = "copy exited " + code; return; }
    try { j.slides = JSON.parse(fs.readFileSync(path.join(deck, "deck.json"), "utf8")).slides.length; } catch {}
    j.seconds = Math.round((Date.now() - (j.t0 || Date.now())) / 1000);
    j.status = "ready"; j.log.push(`Done in ${j.seconds}s (0 AI tokens).`);
  });
}

function runPptxJob(id, srcFile, title) {
  const j = jobs[id];
  const work = path.join(ROOT, id); fs.mkdirSync(work, { recursive: true });
  const out = path.join(work, "deck.pptx");
  j.status = "writing"; j.log.push("Anthropic pptx skill via headless Claude Code (this takes several minutes)…");
  const prompt = `Use the pptx skill to create a presentation from the file at ${srcFile}. Save the finished deck to ${out}. Brand requirements (Acme): deep ink #0f172a for headings, body #333d52; accents: purple #8b5cf6, light purple #8b5cf6, blue #3b82f6, violet #7c3aed, azure #0ea5e9, teal #14b8a6, rose #f43f5e (use the purple-to-blue range predominantly, other accents sparingly); white backgrounds; modern, minimal, generous whitespace; sentence fragments for headlines; no em-dashes; no emojis. Cover the source content faithfully and use its images where possible. Title: ${title}.`;
  const watcher = setInterval(() => {
    if (j.status !== "writing") { clearInterval(watcher); return; }
    if (fs.existsSync(out)) { j.log.push("PPTX file detected."); }
  }, 20000);
  execFile(CLAUDE, ["-p", prompt, "--allowedTools", "Skill,Bash,Read,Write,Edit,Glob,Grep", "--permission-mode", "acceptEdits"], { cwd: work, timeout: 20 * 60 * 1000, maxBuffer: 1 << 26, env: process.env }, (err) => {
    clearInterval(watcher);
    if (!fs.existsSync(out)) { j.status = "failed"; j.error = "skill produced no pptx" + (err ? ` (${String(err).slice(0, 120)})` : ""); return; }
    j.log.push("PPTX created. Rendering preview…");
    if (SOFFICE) {
      execFile(SOFFICE, ["--headless", "--convert-to", "pdf", "--outdir", work, out], { timeout: 180000 }, () => {
        j.pdf = fs.existsSync(path.join(work, "deck.pdf"));
        j.status = "ready"; j.log.push("Done.");
      });
    } else { j.pdf = false; j.status = "ready"; j.log.push("Done (no LibreOffice; download the PPTX to view)."); }
  });
}

const PRESENTON = "http://localhost:5001";
async function runPresentonJob(id, srcFile, title) {
  const j = jobs[id];
  try {
    j.status = "reading"; j.log.push("Uploading to Presenton…");
    const fd = new FormData();
    fd.append("files", new Blob([fs.readFileSync(srcFile)]), path.basename(srcFile));
    const up = await (await fetch(`${PRESENTON}/api/v1/ppt/files/upload`, { method: "POST", body: fd })).json();
    const paths = Array.isArray(up) ? up : (up.files || up.paths || []);
    if (!paths.length) throw new Error("upload returned no file path");
    j.status = "writing"; j.log.push("Presenton is generating (outline, slides, export)…");
    const gen = await (await fetch(`${PRESENTON}/api/v1/ppt/presentation/generate/async`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Create a presentation titled "${title}" from the attached document. Cover its content faithfully.`,
        files: paths, language: "English", template: "general", export_as: "pdf",
        instructions: "Brand: Acme. Deep ink #0f172a headings, purple #8b5cf6 / blue #3b82f6 accents, white backgrounds, modern minimal, concise fragments, no em-dashes, no emojis.",
      }),
    })).json();
    const taskId = gen.id || gen.task_id || gen.presentation_id;
    if (!taskId) throw new Error("no task id: " + JSON.stringify(gen).slice(0, 200));
    let last = "";
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await (await fetch(`${PRESENTON}/api/v1/ppt/presentation/status/${taskId}`)).json();
      const msg = st.message || st.status || "";
      if (msg && msg !== last) { j.log.push(String(msg).slice(0, 140)); last = msg; }
      const state = String(st.status || "").toLowerCase();
      if (["completed", "success", "done"].includes(state)) {
        j.presentonId = st.presentation_id || (st.data && st.data.presentation_id) || taskId;
        j.pdfPath = st.path || (st.data && st.data.path) || null;
        j.status = "ready"; j.log.push("Done.");
        return;
      }
      if (["failed", "error"].includes(state)) throw new Error(String(st.message || "generation failed").slice(0, 200));
    }
    throw new Error("timed out after 20 min");
  } catch (e) { j.status = "failed"; j.error = String(e).slice(0, 300); }
}

function runExport(id) {
  const j = jobs[id]; const work = path.join(ROOT, id);
  const exp = path.join(work, "exports"); fs.mkdirSync(exp, { recursive: true });
  j.status = "exporting"; j.log.push("Exporting PPTX + PDF…");
  const p = spawn("node", [path.join(RUI, "export-deck.mjs"), path.join(work, "deck"), "", id, exp, j.title], { env: process.env });
  p.on("close", (code) => { j.status = "ready"; j.exports = code === 0; j.log.push(code === 0 ? "Exports ready." : "Export failed."); });
}

const MIME = { ".html": "text/html", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".json": "application/json", ".pdf": "application/pdf", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

const srv = createServer(async (req, res) => {
  const u = decodeURIComponent((req.url || "/").split("?")[0]);
  if (req.method === "POST" && u === "/generate") {
    const fname = String(req.headers["x-filename"] || "upload.pdf").replace(/[^\w.\- ]/g, "");
    const title = String(req.headers["x-title"] || fname.replace(/\.[^.]+$/, "")).slice(0, 90) || "Presentation";
    const cover = ["gradient", "light", "dark", "master", "device", "hybrid"].includes(String(req.headers["x-cover"])) ? String(req.headers["x-cover"]) : "master";
    const mode = ["gamma", "hybrid", "pptx", "base", "best", "copy"].includes(String(req.headers["x-mode"])) ? String(req.headers["x-mode"]) : "gamma";
    const wantOutline = String(req.headers["x-outline"]) === "1";
    const ext = (fname.split(".").pop() || "").toLowerCase();
    if (!okExt.includes(ext)) { res.writeHead(400).end("unsupported type"); return; }
    const id = mode + Date.now().toString(36);
    const dir = path.join(ROOT, id); fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, "source." + ext);
    const ws = fs.createWriteStream(src);
    req.pipe(ws);
    ws.on("finish", () => {
      jobs[id] = { status: "queued", log: [], title, mode, t0: Date.now() };
      setImmediate(() => {
        try { mode === "copy" ? runCopyJob(id, src, title) : mode === "pptx" ? runPptxJob(id, src, title) : runEngineJob(id, src, title, cover, mode, wantOutline); }
        catch (e) { jobs[id].status = "failed"; jobs[id].error = String(e).slice(0, 300); }
      });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id }));
    });
    return;
  }
  if (u.startsWith("/status/")) {
    const j = jobs[u.slice(8)];
    res.writeHead(j ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(j || { error: "unknown job" }));
    return;
  }
  if (u.startsWith("/export/")) {
    const id = u.slice(8); const j = jobs[id];
    if (!j || j.status !== "ready" || j.mode === "pptx") { res.writeHead(400).end("not exportable"); return; }
    runExport(id);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && u.startsWith("/approve/")) {
    const id = u.slice(9); const j = jobs[id];
    if (!j || j.status !== "outline_ready" || !j._approve) { res.writeHead(400).end("not awaiting approval"); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let edited = j.outline;
      try { const parsed = JSON.parse(body || "{}"); if (Array.isArray(parsed.outline)) edited = parsed.outline; } catch {}
      j._approve(edited);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method === "POST" && u.startsWith("/exportnative/")) {
    const id = u.slice(14); const j = jobs[id];
    const work = path.join(ROOT, id);
    const deckJson = path.join(work, "deck", "deck.json");
    if (!j || !fs.existsSync(deckJson)) { res.writeHead(400).end("no deck"); return; }
    j.native = undefined; j.log.push("Building native editable PPTX…");
    execFile("node", [path.join(__dir, "pptx-native.mjs"), "--deck", deckJson, "--assets", path.join(work, "assets"), "--out", path.join(work, "deck-native.pptx"), "--title", j.title], { timeout: 120000, env: process.env }, (err) => {
      j.native = !err && fs.existsSync(path.join(work, "deck-native.pptx"));
      j.log.push(j.native ? "Editable PPTX ready." : "Native PPTX failed.");
    });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }
  if (u === "/phealth") {
    try { const r = await fetch("http://localhost:5001", { signal: AbortSignal.timeout(1500) }); res.end(JSON.stringify({ up: r.ok })); }
    catch { res.end(JSON.stringify({ up: false })); }
    return;
  }
  if (u.startsWith("/deck/")) {
    const [, , id, ...rest] = u.split("/");
    const j = jobs[id];
    if (j && j.mode === "presenton") {
      const target = j.presentonId ? `${PRESENTON}/presentation?id=${j.presentonId}` : PRESENTON;
      res.writeHead(302, { location: target }).end();
      return;
    }
    if (j && j.mode === "pptx" && (rest.join("/") === "" || rest.join("/") === "index.html")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><meta charset="utf-8"><title>${j.title}</title><body style="margin:0;font-family:Inter,system-ui,sans-serif">${j.pdf ? `<iframe src="/file/${id}/deck.pdf" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>` : `<div style="padding:3rem"><h2>PPTX ready</h2><p><a href="/file/${id}/deck.pptx" download>Download deck.pptx</a> (no LibreOffice on this Mac for inline preview)</p></div>`}</body>`);
      return;
    }
    let f = path.join(ROOT, id, "deck", rest.join("/") || "index.html");
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
    return;
  }
  if (u.startsWith("/file/")) {
    const [, , id, name] = u.split("/");
    const base = path.join(ROOT, id);
    const f = [path.join(base, "exports", name), path.join(base, name)].find((x) => fs.existsSync(x));
    if (!f) { res.writeHead(404).end(); return; }
    const dl = path.extname(f) !== ".pdf";
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", ...(dl ? { "content-disposition": `attachment; filename="${name}"` } : {}) });
    fs.createReadStream(f).pipe(res);
    return;
  }
  if (u.startsWith("/lane/")) {
    res.writeHead(200, { "content-type": "text/html" });
    fs.createReadStream(path.join(__dir, "genbox.html")).pipe(res);
    return;
  }
  if (u === "/" || u === "/index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    fs.createReadStream(path.join(__dir, "genhub.html")).pipe(res);
    return;
  }
  res.writeHead(404).end();
});
srv.listen(PORT, () => console.log(`Generate Box hub -> http://localhost:${PORT}`));
