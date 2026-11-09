#!/usr/bin/env node
/* ============================================================================
   shoot.mjs  --  Engine v2 vision-QA capture.
   Loads a rendered deck and screenshots every slide at 3 viewports
   (390 phone / 834 tablet / 1440 desktop) after its GSAP timeline settles.
   Output PNGs feed the critique step (critique.mjs) and human review.

   Usage: node qa/shoot.mjs --deck builds/smoke.html --outdir qa/shots/smoke
   ============================================================================ */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; }
const DECK = path.resolve(arg("deck"));
const OUTDIR = path.resolve(arg("outdir", "qa/shots"));

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
];

fs.mkdirSync(OUTDIR, { recursive: true });

const browser = await chromium.launch();
const results = [];
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(DECK).href, { waitUntil: "load" });
    await page.waitForTimeout(600); // fonts + gsap init
    const ids = await page.$$eval(".slide", (els) => els.map((e) => e.id));
    for (let i = 0; i < ids.length; i++) {
      await page.evaluate((idx) => {
        const s = document.querySelectorAll(".slide")[idx];
        s.scrollIntoView({ behavior: "auto", block: "start" });
      }, i);
      await page.waitForTimeout(1500); // let the slide's timeline finish
      const file = path.join(OUTDIR, `${vp.name}-${String(i + 1).padStart(2, "0")}-${ids[i]}.png`);
      await page.screenshot({ path: file });
      results.push(file);
    }
    // capture any console errors as a signal
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Captured ${results.length} screenshots -> ${OUTDIR}`);
