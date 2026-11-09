# Engine v2 design system (fusion layer)

Self-contained design brain for the composer + renderers. It **fuses** the Acme brand lock with the lifted UI/UX Pro Max slide intelligence. Nothing here depends on the `.claude/skills/` install location; this folder is what the generation worker ships with.

> Export note: `slide-types.csv` and `data/*.csv` are not included in this export. `scripts/search.py` and `scripts/slide_search_core.py` expect them next to this README (`slide-types.csv`) and under `data/`. The palette in `tokens.css` / `tokens.json` is a neutral sample.

## What is OURS (kept)
- **Brand lock:** `tokens.css` (source of truth, `var(--pp-*)`), `tokens.json` (three-layer, feeds PPTX/Canva), `brand-rules.md` (palette, voice, asset rules).
- **Slide contract:** `slide-types.csv` = the 11 canonical types, 1:1 with the master template and `../deck-spec.schema.json`. The composer picks from these; it never invents a layout.
- **Asset resolution:** every assetRef resolves against `../manifest.json` (hard-fail on unknown id).
- **Animation:** the schema's 8 GSAP choreography presets; defaults per type live in `slide-types.csv`.

## What is THEIRS (lifted from UI/UX Pro Max, MIT)
- `data/*.csv` (8 knowledge tables): layouts, layout-logic, typography, color-logic, charts, copy formulas, strategies, backgrounds. Reference knowledge the composer queries. **We appended 3 brand-native strategies** to `slide-strategies.csv` (rows 16-18).
- `scripts/slide_search_core.py`: the BM25 engine (unmodified).

## The fusion glue (new)
- `scripts/search.py`: wraps the BM25 core and grounds it in our 11 types. `--type <canonical>` returns the mapped layout/copy/chart/animation guidance for a slide; a free-text query returns the best-fit canonical type plus knowledge hits.
- `scripts/validate-brand.py`: token/brand validator retargeted to the locked palette + fonts + brand rules (em-dash, emoji, text-wrap:balance, nowrap CTAs). Runs in the vision-QA loop and before deploy.

## Usage
```bash
cd scripts
python3 search.py --type analytics-dash-ai        # grounded guidance for one slide type
python3 search.py "customer onboarding story"     # free text -> best-fit type + knowledge
python3 validate-brand.py ../../builds/my-deck.html
```

## Light-brand note
The lifted `slide-color-logic.csv` assumes dark surfaces (its origin is dark SaaS decks). Acme is a **light** brand: white backgrounds, ink text, gradient used only for accents/pills and one dark CTA panel. `brand-rules.md` documents the override; the renderer and validator enforce it.
