// Dev harness: run the whole engage pipeline for one prospect WITHOUT the app or the DB.
//   node engage-test.mjs <url> <slug> [notes...]     (on the VPS, from /var/www/acme-gtm-workers/engage)
// Writes /var/www/presentation-public/<slug>/ exactly like the worker would, then prints the links.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoutAny } from "./engage-scout.mjs";
import { writeIntro } from "./engage-writer.mjs";
import { captureDeck, assembleExports, viewerHTML } from "./engage-export.mjs";
import { prepareLogo, prepareHero, darkenLogo } from "./engage-assets.mjs";
import { collectCandidates, chooseLogo, pickBrandColor, collectHeroCandidates, chooseHero } from "./engage-logosearch.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
for (const envFile of [path.join(__dir, "..", ".env")]) {
  try { for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } } catch {}
}
const [url, slug, ...noteParts] = process.argv.slice(2);
if (!url || !slug) { console.error("usage: node engage-test.mjs <url> <slug> [notes]"); process.exit(2); }
const PUBLIC = "/var/www/presentation-public", EXPORTS = "/var/www/presentation-exports";
const SITE = `https://${process.env.APP_DOMAIN ?? "app.example.com"}`;
const deckDir = path.join(PUBLIC, slug, "deck");
fs.mkdirSync(deckDir, { recursive: true });
const log = (l) => console.log(new Date().toISOString().slice(11, 19), l);
const t0 = Date.now();

const cacheFile = `/tmp/scout-${slug}.json`;
let scout;
if (fs.existsSync(cacheFile) && process.argv.includes("--cached")) scout = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
else { scout = await scoutAny(url, { deep: true }); fs.writeFileSync(cacheFile, JSON.stringify(scout)); }
log(`scouted ${scout.name} (${scout.logos.length} logos, ${scout.heroes.length} photos, ${(scout.pages || []).length} subpages)`);

const reuse = process.argv.includes("--nowrite") && fs.existsSync(path.join(deckDir, "spec.json"));
let spec, body = ["cost", "modules", "flow", "compare", "proof", "golive"];
if (reuse) {
  spec = JSON.parse(fs.readFileSync(path.join(deckDir, "spec.json"), "utf8")); body = spec.body || body; log("reusing spec.json");
  if (process.argv.includes("--relogo")) {
    const client = spec.client;
    const cands = await collectCandidates({ scout, client, domain: scout.domain, log });
    const choice = await chooseLogo(cands, client, { log });
    const order = [choice.pick, choice.backup].filter((n) => n > 0).map((n) => cands[n - 1]);
    let lg = null;
    for (const c of order) { try { const got = await prepareLogo(c.url, deckDir, scout.url); if (!got.onDark) { lg = got; log(`logo from ${c.source} ${c.host || ""}`); break; } } catch (e) { log("skip " + String(e).slice(0, 50)); } }
    if (!lg) { const primary = (scout.logos || [])[0]?.url; if (!primary) throw new Error("no logo"); lg = await prepareLogo(primary, deckDir, scout.url); log("using the site primary logo"); }
    if (lg.onDark) { const hex = pickBrandColor(scout.brandColors); lg.file = await darkenLogo(deckDir, lg.file, hex); log(`recoloured white logo to ${hex}`); }
    for (const f of ["logo.png", "logo.svg"]) if (f !== lg.file) { try { fs.rmSync(path.join(deckDir, f)); } catch {} }
    spec.logo = lg.file; spec.logoOnDark = false;
    if (process.argv.includes("--rehero")) {
      const hc = await collectHeroCandidates({ scout, log });
      const pk = hc.length ? await chooseHero(hc, client, { log }) : { pick: 0 };
      let hero = null;
      if (pk.pick) hero = await prepareHero(hc[pk.pick - 1].url, deckDir, scout.url);
      if (!hero) { try { fs.rmSync(path.join(deckDir, "hero.webp")); } catch {} }
      spec.hero = hero || undefined;
    }
    fs.writeFileSync(path.join(deckDir, "spec.json"), JSON.stringify(spec, null, 2));
    log(`logo now ${lg.file}`);
  }
}
else {
const logo = await prepareLogo(scout.logos[0].url, deckDir, scout.url);
log(`logo ${logo.file} onDark=${logo.onDark}`);
let hero = null;
for (const h of scout.heroes.slice(0, 4)) { try { hero = await prepareHero(h.url, deckDir, scout.url); if (hero) break; } catch (e) { log("hero skip " + String(e).slice(0, 60)); } }
log(`hero ${hero}`);

const brief = { url, client: scout.name, notes: noteParts.join(" "), presenter: { name: "Jane Doe", title: "Commercial Director", email: "jane@example.com", phone: "+1 555 0100", avatar: "/avatars/placeholder.png", booking: "https://cal.example.com/jane" } };
const written = await writeIntro(scout, brief, { log });
log(`written: ${written.intro.map((s) => s.type + ":" + s.label).join(", ")} | ${JSON.stringify(written.usage)}`);
spec = { title: `${written.client} Sales Deck`, client: written.client, short: written.short, eyebrow: written.eyebrow, subtitle: written.subtitle, chips: written.chips, logo: logo.file, logoOnDark: logo.onDark, hero: hero || undefined, preparedBy: brief.presenter.name, date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), intro: written.intro, body, presenter: brief.presenter, exportSlug: slug };
}
fs.copyFileSync(path.join(PUBLIC, "_engage", "deck", "engage.html"), path.join(deckDir, "index.html"));
fs.writeFileSync(path.join(deckDir, "spec.json"), JSON.stringify(spec, null, 2));
fs.writeFileSync(path.join(PUBLIC, slug, "index.html"), viewerHTML(slug, spec.title, true));
const expected = 1 + spec.intro.length + body.length + 1;
log(`deck written, ${expected} slides; capturing`);
const shots = `/tmp/engage-shots-${slug}`; fs.rmSync(shots, { recursive: true, force: true });
const { slides, closings } = await captureDeck({ url: `${SITE}/p/${slug}/deck/?export=${Date.now()}`, expected, outDir: shots, sigKeys: process.argv.includes("--nosig") ? [] : ["jane", "john", "alex", "sam"], log });
await assembleExports({ slug, slides, closings, targets: [path.join(EXPORTS, slug), path.join(PUBLIC, slug)], log });
log(`done in ${Math.round((Date.now() - t0) / 1000)}s -> ${SITE}/p/${slug}/   shots in ${shots}`);
