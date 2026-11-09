// Prospect brand assets for an engagement deck: fetch the logo (URL, data URL or an uploaded file),
// trim it, tell white artwork from dark, recolour a white logo when no dark version exists (never a
// badge or container behind it), and prepare a cover photo. Shared by the worker
// and the test harness.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export async function fetchBin(url, referer) {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error("bad data url");
    return { buf: m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3])), ct: m[1] || "" };
  }
  const r = await fetch(url, { headers: { "User-Agent": UA, Referer: referer || url, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`fetch ${r.status} ${url.slice(0, 80)}`);
  return { buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get("content-type") || "" };
}

// true when the artwork is white / very pale (invisible on the light cover)
export async function looksLight(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let dark = 0, light = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3]; if (a < 40) continue; n++;
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (l < 140) dark++; else if (l > 215) light++;
  }
  if (!n) return false;
  return dark / n < 0.03 && light / n > 0.5;
}

const hexToRgb = (hex) => { const m = String(hex || "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [15, 23, 42]; };

/* Paint every visible pixel of the artwork in one colour, keeping the alpha (a white wordmark on a
   transparent background becomes the same wordmark in the brand's dark colour or black). */
export async function recolourRaster(png, hex) {
  const [r, g, b] = hexToRgb(hex);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) { if (data[i + 3] < 8) continue; data[i] = r; data[i + 1] = g; data[i + 2] = b; }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

/* Swap the white fills / strokes in an SVG for the colour. Returns null when the SVG does not paint
   with explicit white (then the caller rasterises and recolours the pixels instead). */
export function recolourSvg(svgText, hex) {
  const WHITE = /(#fff(?:fff)?\b|\bwhite\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,[^)]*\))/gi;
  if (!WHITE.test(svgText)) return null;
  return svgText.replace(WHITE, hex);
}

/* Give a prepared (white) logo a dark colour. SVG first by text, pixels as the fallback; returns the
   new file name (an SVG that had to be rasterised comes back as logo.png). */
export async function darkenLogo(deckDir, file, hex) {
  const p = path.join(deckDir, file);
  if (file.endsWith(".svg")) {
    const txt = fs.readFileSync(p, "utf8");
    const swapped = recolourSvg(txt, hex);
    if (swapped) {
      try {
        const png = await sharp(Buffer.from(swapped), { density: 144 }).resize({ width: 900, fit: "inside" }).png().toBuffer();
        if (!(await looksLight(png))) { fs.writeFileSync(p, swapped); return file; }
      } catch { /* fall through to the raster route */ }
    }
    const raster = await sharp(fs.readFileSync(p), { density: 192 }).resize({ width: 1400, height: 700, fit: "inside" }).png().toBuffer();
    fs.writeFileSync(path.join(deckDir, "logo.png"), await recolourRaster(raster, hex));
    try { fs.rmSync(p); } catch { /* keep going */ }
    return "logo.png";
  }
  fs.writeFileSync(p, await recolourRaster(fs.readFileSync(p), hex));
  return file;
}

export async function prepareLogo(src, deckDir, referer, spoolDir) {
  let buf, ct = "";
  if (src.startsWith("spool:")) buf = fs.readFileSync(path.join(spoolDir, path.basename(src.slice(6))));
  else ({ buf, ct } = await fetchBin(src, referer));
  const head = buf.subarray(0, 400).toString("utf8");
  const isSvg = /svg/.test(ct) || /^\s*(<\?xml|<svg|<!DOCTYPE svg)/i.test(head);
  if (isSvg) {
    fs.writeFileSync(path.join(deckDir, "logo.svg"), buf);
    let onDark = false;
    try { onDark = await looksLight(await sharp(buf, { density: 144 }).resize({ width: 900, fit: "inside" }).png().toBuffer()); } catch { /* unparsable svg: assume dark artwork */ }
    return { file: "logo.svg", onDark };
  }
  let out;
  try { out = await sharp(buf).ensureAlpha().trim({ threshold: 18 }).resize({ width: 1400, height: 700, fit: "inside", withoutEnlargement: true }).png().toBuffer(); }
  catch { out = await sharp(buf).ensureAlpha().resize({ width: 1400, height: 700, fit: "inside", withoutEnlargement: true }).png().toBuffer(); }
  const meta = await sharp(out).metadata();
  if (!meta.width || meta.width < 24 || meta.height < 10) throw new Error("logo image too small");
  fs.writeFileSync(path.join(deckDir, "logo.png"), out);
  return { file: "logo.png", onDark: await looksLight(out) };
}

/* Cover photo. `src` is a URL, a data URL, or spool:<file> for the rep's own upload (read from spoolDir).
   Candidates the engine found must be a decent landscape photo or they are dropped (null). A photo the
   rep chose or uploaded (`chosen`) is always used: a portrait or panoramic one is centre-cropped to 4:3,
   and only something tiny is refused. Portrait phone photos are rotated per their EXIF first. */
export async function prepareHero(src, deckDir, referer, spoolDir, { chosen = false } = {}) {
  let buf;
  if (src.startsWith("spool:")) buf = fs.readFileSync(path.join(spoolDir, path.basename(src.slice(6))));
  else ({ buf } = await fetchBin(src, referer));
  const img = sharp(buf).rotate();
  const m = await img.metadata();
  const w = m.orientation >= 5 ? m.height : m.width, h = m.orientation >= 5 ? m.width : m.height;
  if (!w || !h) return null;
  const ratio = w / h;
  if (!chosen) {
    if (w < 640 || h < 360) return null;
    if (ratio > 3.2 || ratio < 0.7) return null;
    await img.resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(deckDir, "hero.webp"));
    return "hero.webp";
  }
  if (w < 320 || h < 240) throw new Error("that photo is too small for the cover (at least 640 by 480 pixels)");
  const out = ratio > 2.2 || ratio < 0.9
    ? img.resize({ width: Math.min(1600, w), height: Math.round(Math.min(1600, w) * 3 / 4), fit: "cover", position: "attention" })
    : img.resize({ width: 1600, withoutEnlargement: true });
  await out.webp({ quality: 84 }).toFile(path.join(deckDir, "hero.webp"));
  return "hero.webp";
}

