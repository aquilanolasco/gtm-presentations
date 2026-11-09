# Vision QA rubric (Engine v2)

The loop: `shoot.mjs` captures every slide at 390 / 834 / 1440px -> a vision pass (Claude) scores each shot against this rubric -> patch the renderer/CSS or the spec -> re-shoot. Max 3 iterations, then ship with logged warnings (never loop forever). `validate-brand.py` runs alongside as the hard brand gate.

Score each screenshot PASS / FIX. Any FIX blocks that iteration.

## Layout
- No content overflow or clipping at any viewport. Nothing runs under the sidebar/topbar.
- No orphans or awkward wraps in headings/paragraphs (text-wrap:balance should hold).
- Right-panel visuals are visible, in frame, and not blown out (source assets can be 3000px+; every image capped to its cell).
- Single-column slides: content is a centered, readable block, not full-bleed edge-to-edge text.
- Cards/stats/people grids align on a shared baseline; even columns, no 2+1 collapse when 3 fit.

## Brand
- Palette is brand tokens only (validate-brand.py is the hard gate). Gradient used for accents/pills and one dark CTA panel, never as a background flood.
- Fonts: Inter + JetBrains Mono only on web. No on-image display font on web.
- No em-dashes. No emojis. CTAs on one line (nowrap).
- Logos/characters unaltered and correctly placed (cover device alone; character bottom-right overlapping UI).

## Motion (desktop capture after settle)
- Every slide's content is fully revealed after its timeline (nothing stuck at opacity 0 from a mis-set from/fromTo).
- Count-up stats land on their real value. Cover + CTA headlines fully visible (SplitText did not strip the accent word).
- prefers-reduced-motion: all content visible with no animation (separate capture if needed).

## Content
- Headline <=120, body <=420, <=4 stats, <=6 bullets, feature-highlight >=3 cards (schema-enforced, but confirm visually).
- One idea per slide. Specific numbers. Active voice. Audience-appropriate.

## Known non-issues
- The `arial` font warning from validate-brand is a false positive (text inside an embedded SVG data-URI, not our CSS).
