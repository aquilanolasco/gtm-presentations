# Acme brand lock (composer grounding)

<!-- sample rules (original brand content removed). Replace with your own brand lock. -->

The composer is grounded on this file. It writes a validated **deck spec (JSON)**, never HTML. Every choice must stay inside these rails.

## Palette (locked, from tokens.css)
- Primary `#3b82f6`, Accent `#8b5cf6`, Dark `#0f172a`, Positive `#10b981`.
- Ink `#111827` (headings), Body `#4b5563`, Muted `#9ca3af`, Border `#e5e7eb`, Soft border `#f3f4f6`, White `#ffffff`.
- Brand gradient (text accents + pill buttons ONLY, never dark background floods): `linear-gradient(90deg,#8b5cf6,#3b82f6)`.
- Soft gradient (card backgrounds, right panels): `linear-gradient(135deg,#f5f3ff,#eff6ff)`.
- The renderer never emits raw hex; it emits `var(--pp-*)`. `validate-brand.py` enforces this.

## Typography
- Web: **Inter** (300-700) for everything, **JetBrains Mono** for numbers/tags/labels.
- On-image AI type: one designated brand display font ONLY. Never a web font.
- `text-wrap: balance` on all headings and paragraphs. No orphans.
- `white-space: nowrap` on every CTA / pill button.
- No em-dashes. No emojis.

## Voice
- Fragments over full sentences for headlines. Max ~5 lines body per slide. One idea per slide.
- Specific numbers ("1,200 customers" not "thousands"). Active voice, present tense. Positive framing. Audience-first.
- Banned words: leverage, synergy, unlock, moreover, "in conclusion", "it's worth noting".

## Slide-type discipline
- Only the 11 canonical types in `slide-types.csv` (they map 1:1 to the master template and the deck-spec schema). No invented layouts in `template` mode.
- First slide is always `cover` (device mockup alone, no scene on top). Last is always `call-to-action`.
- Every asset is an `assetRef{id, role}` whose `id` exists in `../manifest.json`. Unknown id = hard fail, not a broken image.
- Copy limits (schema-enforced): headline <=120, body <=420, <=4 stats, <=6 bullets, feature-highlight needs >=3 cards.

## Assets
- Never alter, recreate, or distort logos or brand characters. Use files as-is.
- Brand characters: bottom-right, 65-75% height, overlapping UI for depth. Never change geometry/palette.
- Cover device: one device mockup, alone. Artboards are floating cards or dimmed backgrounds, never full-bleed.
- Legacy brand folders (`Brandkit`) are excluded from the manifest and must never appear.

## Narrative
- Pull a base structure from `data/slide-strategies.csv` (the brand-native arcs, e.g. Product Pitch / Conference Keynote / Customer Value Story, plus the generic SaaS arcs for reference).
- Per slide, the emotion + default animation come from `slide-types.csv`. Analytics slides count up; cards stagger; cover and CTA use hero-reveal.
- Light brand override: the lifted `slide-color-logic.csv` assumes dark surfaces. Acme decks are light (white bg, ink text). Treat its "dark-surface" rows as "elevated white surface"; only the CTA right panel goes dark.
