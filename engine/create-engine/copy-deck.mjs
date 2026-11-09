/* COPY MODE — faithful "keep the good slides" deck: render each source page to a high-res image and
   wrap it in our deck shell (sidenav, progress, keyboard/touch nav, mobile) via generate.mjs --deckjson.
   No AI, ~0 tokens, ~1 min. Best for sources that are ALREADY designed presentations (PDF/PPTX).
   Usage: node copy-deck.mjs --file <pdf> --title "..." --out <deckDir> [--cover hybrid] */
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const FILE = arg("file"), TITLE = arg("title", "Presentation"), OUT = arg("out"), COVER = arg("cover", "hybrid");
const PY = process.env.INGEST_PY || "python3";
if (!FILE || !OUT) { console.error("need --file and --out"); process.exit(1); }
const assets = path.join(OUT, "assets"); fs.mkdirSync(assets, { recursive: true });

// 1) render every page to a crisp PNG + grab a short nav title (largest text span) — all in one python pass
console.log("@@STAGE read"); console.log("@@LOG Rendering your slides…");
const py = `
import fitz, json, sys, os
src, assets = sys.argv[1], sys.argv[2]
doc = fitz.open(src)
slides = []
for i, page in enumerate(doc):
    r = page.rect
    sc = min(1920.0 / r.width, 1920.0 / r.height) if r.width and r.height else 2.0
    page.get_pixmap(matrix=fitz.Matrix(sc, sc)).save(os.path.join(assets, f"page{i+1:02d}.png"))
    # short title = the largest-font text on the page (fallback: first line)
    title = ""
    try:
        big = 0.0
        d = page.get_text("dict")
        for b in d.get("blocks", []):
            for l in b.get("lines", []):
                for s in l.get("spans", []):
                    t = (s.get("text") or "").strip()
                    if t and len(t) > 1 and s.get("size", 0) > big:
                        big = s.get("size", 0); title = t
        if not title:
            title = (page.get_text().strip().split(chr(10)) or [""])[0]
    except Exception:
        pass
    slides.append({"type": "page", "image": f"page{i+1:02d}.png", "title": (title or f"Slide {i+1}")[:60]})
print(json.dumps({"title": os.path.splitext(os.path.basename(src))[0], "slides": slides}))
`;
let deckJson;
try {
  const out = execFileSync("arch", ["-arm64", PY, "-c", py, FILE, assets], { maxBuffer: 1 << 28 });
  deckJson = JSON.parse(out.toString());
} catch (e) { console.error("render failed:", String(e).slice(0, 300)); process.exit(1); }
deckJson.title = TITLE;
console.log(`@@SLIDES ${deckJson.slides.length}`);
const specFile = path.join(OUT, "copy-spec.json");
fs.writeFileSync(specFile, JSON.stringify(deckJson));

// 2) render the branded shell around the page images (deterministic, no AI)
console.log("@@STAGE write"); console.log("@@LOG Wrapping in your deck shell…");
const deckDir = path.join(OUT, "deck"); fs.mkdirSync(deckDir, { recursive: true });
execFileSync("node", [path.join(__dir, "generate.mjs"), "--deckjson", specFile, "--assets", assets, "--title", TITLE, "--out", deckDir, "--cover", COVER],
  { stdio: "inherit", env: process.env });
// keep deck.json where the exporter / genbox expect it
try { fs.copyFileSync(path.join(deckDir, "deck.json"), path.join(deckDir, "deck.json")); } catch {}
console.log(`COPY DECK -> ${deckDir}`);
