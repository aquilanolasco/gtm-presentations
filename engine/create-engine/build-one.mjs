/* Drive one Create job locally: file -> ingest -> generate -> export (PDF/PPTX).
   Produces <work>/deck (index.html + assets) and <work>/exports (<slug>.pdf/.pptx).
   Usage: node build-one.mjs --file <path> --title "..." --slug <slug> --work <dir> */
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const FILE = arg("file"), TITLE = arg("title", "Presentation"), SLUG = arg("slug"), WORK = arg("work"), COVER = arg("cover", "gradient");
// MODE = "quick" (fast frame, simple templates only) or "full" (reconstruct diagrams + redesign). build-one is
// the one place that configures the engine per mode, so the relay just passes --mode.
const MODE = (arg("mode", "full") === "quick") ? "quick" : "full";
// The "Create with Claude" engine runs on Opus 5 (the flagship) for the strongest structure, writing
// and bespoke-slide design. build-one is only ever invoked for engine=claude now (Gamma has its own
// path), so this model choice is the Claude engine's, and full mode turns on V5 brand rules + novel slides.
const GEN_ENV = { ...process.env, GEN_STYLE2: "1", CREATE_MODEL: "anthropic/claude-opus-5", GEN_MODEL: "anthropic/claude-opus-5",
  ...(MODE === "full" ? { GEN_NOVEL: "1", GEN_V5: "1" } : { GEN_NOVEL: "", GEN_V5: "" }) };
// EXPORT_DIR/INGEST_PY let the self-contained launchd bundle point at its own export tooling +
// arm64 framework python (outside ~/Documents). Defaults keep the in-place dev run unchanged.
const RUI = process.env.EXPORT_DIR || path.join(os.homedir(), "presentation-agent", "export");
const PY = process.env.INGEST_PY || "python3";

const assets = path.join(WORK, "assets"); const deck = path.join(WORK, "deck"); const exp = path.join(WORK, "exports");
fs.mkdirSync(assets, { recursive: true }); fs.mkdirSync(deck, { recursive: true }); fs.mkdirSync(exp, { recursive: true });

// 1) ingest -> content JSON
console.log("@@STAGE read");
console.log("@@LOG Reading your file…");
const ing = path.join(WORK, "ing.json");
const ingOut = execFileSync("arch", ["-arm64", PY, path.join(__dir, "ingest.py"), FILE, assets], { maxBuffer: 1 << 28 });
fs.writeFileSync(ing, ingOut);
console.log("ingested");

// 2) generate branded deck (AI structure + deterministic render)
console.log("@@STAGE write");
console.log(MODE === "quick" ? "@@LOG Quick Build, framing your content…" : "@@LOG Full Build, reconstructing every slide…");
execFileSync("node", [path.join(__dir, "generate.mjs"), "--ingest", ing, "--assets", assets, "--title", TITLE, "--out", deck, "--cover", COVER, ...(MODE === "quick" ? ["--quick"] : [])],
  { stdio: "inherit", env: GEN_ENV });

// 3) serve the deck at /p/<slug>/deck and export PDF+PPTX with the shared pipeline
//    (rebuild the deck files under a matching base so links/assets resolve on the public path)
console.log("@@STAGE export");
execFileSync("node", [path.join(RUI, "export-deck.mjs"), deck, "", SLUG, exp, TITLE],
  { stdio: "inherit", env: process.env });

// 4) rebuild the PPTX as a fully EDITABLE file (native text boxes + detached/movable images), overwriting the
//    flat screenshot PPTX. NON-FATAL: on any failure the flat PPTX from step 3 stays in place, so a download
//    is always available. (The PDF is left as-is — a PDF is a fixed document, not an editable format.)
try {
  console.log("@@LOG Making the PowerPoint editable…");
  execFileSync("node", [path.join(RUI, "export-pptx-editable.mjs"), deck, "", SLUG, exp, TITLE],
    { stdio: "inherit", env: process.env });
} catch (e) {
  console.log("@@LOG editable PPTX step failed, keeping the flat PPTX:", String(e).slice(0, 140));
}

console.log("BUILT", SLUG, "->", WORK);
