#!/usr/bin/env python3
"""Ingest ANY file into structured content for deck generation.
PDF/PPTX/DOCX -> native extraction (text + images + links). Audio -> local Whisper transcription.
Text/Markdown/HTML/code/CSV/JSON -> read as text. Images -> embedded + referenced.
Usage: python3 ingest.py <file> <assets_dir>   ->  prints JSON to stdout"""
import sys, os, json, re, html, subprocess

TEXTY = {".txt", ".md", ".markdown", ".rst", ".csv", ".tsv", ".json", ".yaml", ".yml",
         ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp",
         ".h", ".css", ".scss", ".sh", ".sql", ".xml", ".log", ".ini", ".toml", ".env"}
HTMLY = {".html", ".htm"}
AUDIO = {".webm", ".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac", ".mp4"}
IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff"}


def _is_black_or_uniform(pix):
    """True for near-black or near-uniform-colour images (artefacts / decorative fills), which
    should not be offered to the model or rendered. Uses a downsampled sample for speed."""
    try:
        n = pix.n
        data = pix.samples
        step = max(1, (len(data) // n) // 900)  # sample ~900 pixels regardless of size
        chans = [[] for _ in range(min(n, 3))]
        lum = []
        i = 0
        px = 0
        while i + n <= len(data):
            r = data[i]; g = data[i + 1] if n > 1 else r; bl = data[i + 2] if n > 2 else r
            for c, v in enumerate((r, g, bl)[:len(chans)]):
                chans[c].append(v)
            lum.append(0.299 * r + 0.587 * g + 0.114 * bl)
            px += 1
            i += n * step
        if not lum:
            return False
        mean_lum = sum(lum) / len(lum)
        # per-channel spread (max-min) as a cheap variance proxy
        spread = max((max(c) - min(c)) for c in chans if c) if chans and chans[0] else 0
        if mean_lum < 16:          # near-black poster / dark artefact
            return True
        if spread < 14:            # near-uniform solid colour (background block / swatch)
            return True
        return False
    except Exception:
        return False


def _dekey_black_bg(fp):
    """Clean an image that has a solid BLACK background. If its corners are near-black, flood-fill
    the connected black to transparent so a subject renders cleanly on white slides. Returns False
    (skip this image) when, after keying, it is still overwhelmingly near-black with no real subject
    (an off/empty device frame or black placeholder). Returns True to keep."""
    try:
        from PIL import Image, ImageDraw
        im = Image.open(fp).convert("RGBA")
        w, h = im.size
        px = im.load()
        # sample a grid to check whether corners/background are black + measure black fraction
        def lum(p):
            return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
        corners = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2), (w // 2, 1), (w // 2, h - 2)]
        cornerdark = sum(1 for x, y in corners if px[x, y][3] > 180 and lum(px[x, y]) < 26)
        if cornerdark >= 3:
            for x, y in ([(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]):
                try:
                    ImageDraw.floodfill(im, (x, y), (0, 0, 0, 0), thresh=45)
                except Exception:
                    pass
            im.save(fp)
            px = im.load()
        # after keying: fraction of OPAQUE pixels that are still near-black. A real subject (screens,
        # logos, characters) has bright/colourful opaque pixels; a black-box artefact does not.
        sx = max(1, w // 40); sy = max(1, h // 40)
        opaque = darkop = 0
        for y in range(0, h, sy):
            for x in range(0, w, sx):
                p = px[x, y]
                if p[3] > 180:
                    opaque += 1
                    if lum(p) < 30:
                        darkop += 1
        if opaque and darkop / opaque > 0.75:
            return False  # still a black box / empty frame -> reject
        return True
    except Exception:
        return True


def ingest_pdf(path, assets):
    import fitz  # PyMuPDF
    doc = fitz.open(path)
    pages, imgno = [], 0
    for pi, page in enumerate(doc):
        text = page.get_text("text").strip()
        pw, ph = max(page.rect.width, 1), max(page.rect.height, 1)
        links = []
        for l in page.get_links():
            uri = l.get("uri")
            if uri:
                r = l.get("from")
                anchor = page.get_textbox(r).strip() if r else ""
                links.append({"text": anchor or uri, "url": uri})
        # bbox per image xref, so the model can map each extracted file to its position on the page
        bbox = {}
        try:
            for d in page.get_image_info(xrefs=True):
                if d.get("xref"):
                    bbox[d["xref"]] = d.get("bbox")
        except Exception:
            pass
        images, drawn = [], []
        for img in page.get_images(full=True):
            xref = img[0]
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha >= 4:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                # apply the soft mask (transparency) when present, else masked images
                # (logos, wreaths, cut-outs) come out on a solid black background
                smask = img[1]
                if smask > 0:
                    try:
                        pix = fitz.Pixmap(pix, fitz.Pixmap(doc, smask))
                    except Exception:
                        pass
                if pix.width < 60 or pix.height < 60:
                    continue
                # skip artefacts + decorative fills: near-black posters (video placeholders) and
                # near-uniform solid-colour rectangles (background blocks, gradient swatches).
                # Real photos / screenshots / illustrations have high per-channel variance and survive.
                if _is_black_or_uniform(pix):
                    continue
                imgno += 1
                fn = f"img{imgno:03d}.png"
                fp = os.path.join(assets, fn)
                pix.save(fp)
                # subjects on a solid black bg -> transparent; reject residual black-box artefacts
                if not _dekey_black_bg(fp):
                    try: os.remove(fp)
                    except Exception: pass
                    imgno -= 1
                    continue
                rec = {"file": fn, "w": pix.width, "h": pix.height}
                b = bbox.get(xref)
                if b:
                    rec["x"] = round((b[0] + b[2]) / 2 / pw * 100)
                    rec["y"] = round((b[1] + b[3]) / 2 / ph * 100)
                    # coverage of the page: a flattened whole-slide image (common in exported decks) covers
                    # most of the page. Such an image is NOT a separable headshot/logo — flag it so people/
                    # celebration slides don't crop the entire slide into a circle.
                    cov = abs((b[2] - b[0]) * (b[3] - b[1])) / (pw * ph)
                    if cov >= 0.6:
                        rec["fullpage"] = True
                    drawn.append((fn, b))
                images.append(rec)
            except Exception:
                continue
        # render the whole page to a JPEG for vision, with each extracted image LABELLED by filename at its
        # position, so the model can pick the exact file for each thing it sees (e.g. read "img026" off a headshot).
        page_image = None
        # CLEAN high-res render of the untouched page (no debug labels) — used by hybrid mode to KEEP
        # intricate diagrams (networks, dense timelines, roadmaps) as crisp originals instead of a shaky
        # AI reconstruction. Rendered here, BEFORE the red filename labels are drawn on the page.
        page_clean = None
        try:
            cz = min(2400.0 / pw, 3.0)
            cpm = page.get_pixmap(matrix=fitz.Matrix(cz, cz), alpha=False)
            cfn = f"pageclean-{pi + 1:03d}.png"
            cpm.save(os.path.join(assets, cfn))
            page_clean = cfn
        except Exception:
            page_clean = None
        try:
            fs = max(7.0, pw * 0.013)
            for fn, b in drawn:
                lbl = fn.replace(".png", "")
                try:
                    page.draw_rect(fitz.Rect(b[0], b[1], b[0] + fs * 0.62 * (len(lbl) + 1), b[1] + fs * 1.35),
                                   color=(0.9, 0, 0), fill=(1, 1, 0.85), width=0.4)
                    page.insert_text((b[0] + fs * 0.3, b[1] + fs), lbl, fontsize=fs, color=(0.85, 0, 0))
                except Exception:
                    pass
            zoom = min(1500.0 / pw, 2.0)
            pm = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            pfn = f"page-{pi + 1:03d}.jpg"
            with open(os.path.join(assets, pfn), "wb") as f:
                f.write(pm.tobytes("jpg", jpg_quality=72))
            page_image = pfn
        except Exception:
            page_image = None
        pages.append({"index": pi, "text": text, "links": links, "images": images, "page_image": page_image, "page_clean": page_clean})
    return {"kind": "pdf", "pageCount": len(pages), "pages": pages}


def ingest_pptx(path, assets):
    from pptx import Presentation
    prs = Presentation(path)
    pages, imgno = [], 0
    for si, slide in enumerate(prs.slides):
        texts, links, images = [], [], []
        for sh in slide.shapes:
            if sh.has_text_frame:
                t = sh.text_frame.text.strip()
                if t:
                    texts.append(t)
                for p in sh.text_frame.paragraphs:
                    for run in p.runs:
                        if run.hyperlink and run.hyperlink.address:
                            links.append({"text": run.text or run.hyperlink.address, "url": run.hyperlink.address})
            if sh.shape_type == 13:
                try:
                    imgno += 1
                    img = sh.image
                    fn = f"img{imgno:03d}.{img.ext or 'png'}"
                    with open(os.path.join(assets, fn), "wb") as f:
                        f.write(img.blob)
                    images.append({"file": fn})
                except Exception:
                    pass
        pages.append({"index": si, "text": "\n".join(texts), "links": links, "images": images})
    return {"kind": "pptx", "pageCount": len(pages), "pages": pages}


def ingest_docx(path, assets):
    import docx
    d = docx.Document(path)
    parts = []
    for p in d.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        style = (p.style.name or "").lower()
        parts.append(("# " + t) if "heading" in style else t)
    # tables
    for tbl in d.tables:
        for row in tbl.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    imgno = 0
    for rel in d.part.rels.values():
        if "image" in rel.reltype:
            try:
                imgno += 1
                blob = rel.target_part.blob
                ext = (rel.target_ref.split(".")[-1] or "png").lower()
                fn = f"img{imgno:03d}.{ext}"
                with open(os.path.join(assets, fn), "wb") as f:
                    f.write(blob)
            except Exception:
                pass
    return {"kind": "docx", "pageCount": 1, "pages": [{"index": 0, "text": "\n".join(parts), "links": _urls("\n".join(parts)), "images": []}]}


def transcribe(path):
    """Local Whisper transcription (Apple Silicon mlx first, then openai-whisper)."""
    try:
        import mlx_whisper
        r = mlx_whisper.transcribe(path, path_or_hf_repo="mlx-community/whisper-base.en-mlx")
        return (r.get("text") or "").strip()
    except Exception:
        pass
    try:
        import whisper
        model = whisper.load_model("base")
        return (model.transcribe(path).get("text") or "").strip()
    except Exception as e:
        return f"[audio could not be transcribed: {e}]"


def _urls(text):
    return [{"text": u, "url": u} for u in re.findall(r"https?://[^\s)\"'<>]+", text)][:40]


def ingest_text(path, raw_is_html=False):
    with open(path, "r", errors="replace") as f:
        text = f.read()
    links = []
    if raw_is_html:
        for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', text, re.I | re.S):
            u = m.group(1)
            if u.startswith("http"):
                links.append({"text": html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip() or u, "url": u})
        text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
        text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", text))
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    if not links:
        links = _urls(text)
    return {"kind": "text", "pageCount": 1, "pages": [{"index": 0, "text": text.strip(), "links": links[:40], "images": []}]}


def ingest_image(path, assets):
    import shutil
    fn = "img001" + os.path.splitext(path)[1].lower()
    try:
        shutil.copy(path, os.path.join(assets, fn))
    except Exception:
        fn = None
    return {"kind": "image", "pageCount": 1, "pages": [{"index": 0, "text": "", "links": [],
            "images": [{"file": fn}] if fn else []}]}


def main():
    path, assets = sys.argv[1], sys.argv[2]
    os.makedirs(assets, exist_ok=True)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        data = ingest_pdf(path, assets)
    elif ext == ".pptx":
        data = ingest_pptx(path, assets)
    elif ext == ".docx":
        data = ingest_docx(path, assets)
    elif ext in AUDIO:
        txt = transcribe(path)
        data = {"kind": "audio", "pageCount": 1, "pages": [{"index": 0, "text": txt, "links": _urls(txt), "images": []}]}
    elif ext in IMAGE:
        data = ingest_image(path, assets)
    elif ext in HTMLY:
        data = ingest_text(path, raw_is_html=True)
    else:
        data = ingest_text(path)  # txt/md/code/csv/json/unknown -> read as text
    print(json.dumps(data))


if __name__ == "__main__":
    main()
