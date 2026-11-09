#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Acme brand / token validator  --  Engine v2.

Retargeted from the UI/UX Pro Max html-token-validator to the LOCKED brand
palette + brand rules. A rendered web deck that fails this is not brand-compliant
and must not ship. Run in the vision-QA loop and before any deploy.

  python validate-brand.py path/to/deck.html [more.html ...]

Checks (errors block, warnings advise):
  1. Imports tokens.css (the single source of truth).
  2. No raw hex / rgb / hsl colors OUTSIDE the :root token block, @font-face, or
     <script> (Chart.js needs literal colors). A small brand rgba allowlist is
     permitted for transparency (CSS has no var() opacity shortcut everywhere).
  3. No web font other than Inter, JetBrains Mono, system fallbacks.
     The on-image brand font (ON_IMAGE_FONT) must never appear as a web font-family.
  4. Brand rules: no em-dashes, no emojis, text-wrap:balance present on heading/p
     rules, white-space:nowrap present where CTA/pill classes are styled.

Exit code 0 = clean, 1 = at least one error.
"""

import re
import sys
from pathlib import Path

# Brand colors allowed as rgba() for transparency (r,g,b of the locked palette + b/w).
ALLOWED_RGBA = [
    (139, 92, 246),   # accent       #8b5cf6 (purple + light purple)
    (59, 130, 246),   # primary      #3b82f6 (blue)
    (15, 23, 42),     # dark         #0f172a
    (16, 185, 129),   # green        #10b981
    (17, 24, 39),     # ink          #111827
    (0, 0, 0),
    (255, 255, 255),
]
# On-image-only display font (never allowed as a web font). Set to your brand's.
ON_IMAGE_FONT = "brand display"
ALLOWED_FONT_TOKENS = {"inter", "jetbrains mono", "system-ui", "-apple-system",
                       "segoe ui", "roboto", "sans-serif", "ui-monospace",
                       "sfmono-regular", "menlo", "monospace"}
EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF←-⇿⌀-⏿]"
)


def strip_regions(css_or_html):
    """Remove :root{...}, @font-face{...}, and <script>...</script> so literal
    colors there are not flagged. Returns text with those regions blanked."""
    text = css_or_html
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.S | re.I)
    text = re.sub(r":root\s*\{.*?\}", " ", text, flags=re.S)
    text = re.sub(r"@font-face\s*\{.*?\}", " ", text, flags=re.S)
    # data: URIs and external image URLs can contain hex-like noise
    text = re.sub(r"url\([^)]*\)", " ", text, flags=re.I)
    return text


def rgba_allowed(m):
    r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return (r, g, b) in ALLOWED_RGBA


def validate(path):
    errors, warnings = [], []
    html = Path(path).read_text(encoding="utf-8", errors="replace")

    if "tokens.css" not in html:
        errors.append("Missing tokens.css import (the single source of truth).")

    scan = strip_regions(html)

    for m in re.finditer(r"#[0-9A-Fa-f]{3,8}\b", scan):
        errors.append(f"Raw hex color '{m.group(0)}' outside :root. Use var(--pp-*).")
    for m in re.finditer(r"\brgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)", scan):
        errors.append(f"Raw rgb() '{m.group(0)}'. Use a token.")
    for m in re.finditer(r"\brgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)", scan):
        if not rgba_allowed(m):
            errors.append(f"Non-brand rgba '{m.group(0)}'.")
    for m in re.finditer(r"\bhsla?\([^)]+\)", scan):
        errors.append(f"Raw hsl() '{m.group(0)}'. Use a token.")

    for m in re.finditer(r"font-family:\s*([^;{}]+)", html, flags=re.I):
        decl = m.group(1)
        if "var(" in decl:
            continue
        fams = [f.strip().strip('"\'').lower() for f in decl.split(",") if f.strip()]
        for fam in fams:
            if ON_IMAGE_FONT in fam:
                errors.append("On-image brand font used as a web font. It is ON-IMAGE only.")
            elif fam and fam not in ALLOWED_FONT_TOKENS:
                warnings.append(f"Non-standard web font '{fam}'. Prefer var(--pp-font-sans/mono).")

    if "—" in html:
        errors.append("Em-dash present. Use comma, period, parentheses, or colon.")
    emoji = EMOJI_RE.findall(html)
    if emoji:
        errors.append(f"Emoji present ({len(emoji)} found). No emojis anywhere.")

    if "text-wrap:balance" not in html.replace(" ", "") :
        warnings.append("No text-wrap:balance rule found. Required on all headings + paragraphs.")
    if re.search(r"\.(cta|pill)", html) and "white-space:nowrap" not in html.replace(" ", ""):
        warnings.append("CTA/pill class present but no white-space:nowrap rule found.")

    return errors, warnings


def main():
    files = sys.argv[1:]
    if not files:
        print("usage: validate-brand.py <file.html> [more.html ...]")
        sys.exit(2)
    total_err = 0
    for f in files:
        errors, warnings = validate(f)
        status = "PASS" if not errors else "FAIL"
        print(f"\n[{status}] {f}")
        for e in errors:
            print(f"  ERROR   {e}")
        for w in warnings:
            print(f"  warn    {w}")
        total_err += len(errors)
    print(f"\n{'CLEAN' if total_err == 0 else str(total_err) + ' error(s)'}")
    sys.exit(1 if total_err else 0)


if __name__ == "__main__":
    main()
