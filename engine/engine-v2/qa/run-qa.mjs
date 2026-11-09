#!/usr/bin/env node
/* run-qa.mjs -- one command: render is assumed done; capture 3 viewports + run the
   brand gate + emit a report the vision critic (Claude) reads against rubric.md.
   Usage: node qa/run-qa.mjs --deck builds/example-deck.html --outdir qa/shots/example-deck */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; }
const DECK = arg("deck");
const OUTDIR = arg("outdir", "qa/shots/deck");
if (!DECK) { console.error("Required: --deck <html>"); process.exit(2); }

console.log("1/2 Capturing screenshots...");
execFileSync("node", [path.join(__dirname, "shoot.mjs"), "--deck", DECK, "--outdir", OUTDIR], { stdio: "inherit", cwd: root });

console.log("2/2 Brand gate...");
let brandOk = true;
try {
  execFileSync("python3", [path.join(root, "design-system/scripts/validate-brand.py"), DECK], { stdio: "inherit", cwd: root });
} catch { brandOk = false; }

const shots = fs.readdirSync(path.resolve(root, OUTDIR)).filter((f) => f.endsWith(".png")).sort();
const report = { deck: DECK, brandGate: brandOk ? "PASS" : "FAIL", shots: shots.length, files: shots };
fs.writeFileSync(path.resolve(root, OUTDIR, "report.json"), JSON.stringify(report, null, 2));
console.log(`\nQA report: ${OUTDIR}/report.json  |  brand=${report.brandGate}  shots=${report.shots}`);
console.log("Next: vision-critique each shot in", OUTDIR, "against qa/rubric.md; patch; re-run. Max 3 iterations.");
