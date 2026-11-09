#!/usr/bin/env node
/* ============================================================================
   compose.mjs -- Engine v2 composer orchestrator.
   Assembles the grounding payload (system prompt + brand rules + slide-types +
   slim asset index + schema) and, if an API key is present, calls Claude Opus to
   produce a deck spec, then HARD-VALIDATES it against the schema and retries with
   the errors fed back (max 3). Without a key it writes the full prompt to
   composer/out/prompt.txt so the spec can be authored manually or by an agent.

   Usage:
     node composer/compose.mjs --brief path/to/brief.json --out builds/deck.json
   Env: ANTHROPIC_API_KEY (+ optional COMPOSER_MODEL, default claude-opus-4-8)
   ============================================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const DS = path.join(root, "design-system");
function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; }
const BRIEF = arg("brief");
const OUT = arg("out", "builds/deck.json");

// ---- slim asset index (what the model may reference) -----------------------
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const assetIndex = manifest.assets
  .filter((a) => !a.noDeckUse && a.type !== "font")
  .map((a) => ({ id: a.aliases[0] || a.id, role: a.role, category: a.category, tags: (a.tags || []).slice(0, 6) }));

// ---- grounding payload ------------------------------------------------------
const system = fs.readFileSync(path.join(__dirname, "system-prompt.md"), "utf8");
const brandRules = fs.readFileSync(path.join(DS, "brand-rules.md"), "utf8");
const slideTypes = fs.readFileSync(path.join(DS, "slide-types.csv"), "utf8");
const strategies = fs.readFileSync(path.join(DS, "data/slide-strategies.csv"), "utf8");
const schema = fs.readFileSync(path.join(root, "deck-spec.schema.json"), "utf8");
const brief = BRIEF ? fs.readFileSync(path.resolve(BRIEF), "utf8") : "(no brief file given)";

const userPayload = [
  "## BRAND RULES\n" + brandRules,
  "## SLIDE TYPES (the only 11 allowed; map beats to these)\n```csv\n" + slideTypes + "\n```",
  "## NARRATIVE STRATEGIES\n```csv\n" + strategies + "\n```",
  "## ASSET INDEX (reference ids ONLY from here)\n```json\n" + JSON.stringify(assetIndex) + "\n```",
  "## DECK-SPEC SCHEMA (your output must validate against this)\n```json\n" + schema + "\n```",
  "## CONTENT BRIEF\n```json\n" + brief + "\n```",
  "Produce the deck spec JSON now. Output only the JSON.",
].join("\n\n");

// ---- validator --------------------------------------------------------------
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(schema));

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.COMPOSER_MODEL || "claude-opus-4-8";

async function callModel(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 32000, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== "system") }),
  });
  if (!res.ok) throw new Error(`Model API ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

function extractJSON(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  return JSON.parse(text.slice(s, e + 1));
}

if (!KEY) {
  const outdir = path.join(__dirname, "out");
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, "system.txt"), system);
  fs.writeFileSync(path.join(outdir, "prompt.txt"), userPayload);
  console.log("No ANTHROPIC_API_KEY set. Wrote grounding to composer/out/{system,prompt}.txt");
  console.log("Author the spec against these (an agent can act as the composer), save to", OUT);
  process.exit(0);
}

let messages = [{ role: "system", content: system }, { role: "user", content: userPayload }];
let spec = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  const text = await callModel(messages);
  try {
    spec = extractJSON(text);
  } catch (e) {
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: "That was not valid JSON. Output ONLY the JSON object." });
    continue;
  }
  if (validate(spec)) break;
  const errs = validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
  console.warn(`Attempt ${attempt}: schema errors -> ${errs}`);
  messages.push({ role: "assistant", content: JSON.stringify(spec) });
  messages.push({ role: "user", content: `The spec failed schema validation: ${errs}. Fix and output only the corrected JSON.` });
  spec = null;
}
if (!spec || !validate(spec)) { console.error("Failed to produce a valid spec after 3 attempts."); process.exit(1); }
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(path.resolve(OUT), JSON.stringify(spec, null, 2));
console.log(`Composed + validated deck spec -> ${OUT} (${spec.slides.length} slides)`);
