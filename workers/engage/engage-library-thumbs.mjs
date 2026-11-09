// Thumbnails for the Create pane's slide picker: every slide of every library deck, captured from the
// deployed engage template's library view (/p/_engage/deck/?lib=<deck>: cover, the deck's slides in
// order, closing), resized to 480px WebP at /var/www/presentation-public/_library/<sid>.webp, which the
// app shows at /p/_library/<sid>.webp. Run after every engage template deploy that changes a master.
//   node engage-library-thumbs.mjs            # all decks
//   node engage-library-thumbs.mjs intro      # one deck
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { captureDeck } from "./engage-export.mjs";

const LIB = JSON.parse(fs.readFileSync(new URL("./engage-library.json", import.meta.url), "utf8"));
const OUT = "/var/www/presentation-public/_library";
const SITE = `https://${process.env.APP_DOMAIN ?? "app.example.com"}`;
fs.mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);

for (const deck of LIB.decks) {
  if (want.length && !want.includes(deck.id)) continue;
  const expected = deck.slides.length + 2;
  const shots = fs.mkdtempSync("/tmp/engage-lib-");
  try {
    const { slides } = await captureDeck({
      url: `${SITE}/p/_engage/deck/?lib=${deck.id}&export=${Date.now()}`,
      expected, outDir: shots, log: (l) => console.log(`[${deck.id}] ${l}`),
    });
    const body = slides.slice(1, -1); // drop the cover and the closing page
    if (body.length !== deck.slides.length) console.log(`[${deck.id}] WARNING captured ${body.length} body slides, the library lists ${deck.slides.length}`);
    for (let i = 0; i < Math.min(body.length, deck.slides.length); i++) {
      const sid = deck.slides[i].sid;
      await sharp(body[i]).resize({ width: 480 }).webp({ quality: 80 }).toFile(path.join(OUT, `${sid}.webp`));
      console.log(`[${deck.id}] ${sid}.webp`);
    }
  } finally { fs.rmSync(shots, { recursive: true, force: true }); }
}
console.log("done");
