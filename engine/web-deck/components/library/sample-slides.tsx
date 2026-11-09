"use client";

/* Sample slide library (original content removed).

   Stands in for the generated master-slide files (intro-slides.tsx, sales-slides.tsx and their
   vertical variants, produced by scripts/gen-library.py) and the library.json catalogue, which are
   not part of this export. Same export shape the library index expects:
     <DECK>_SLIDES : Record<slideId, (sid) => ReactNode>   one renderer per master slide
     <DECK>_CSS    : string                                the master deck's own stylesheet
     INTRO_Runtime : component                             mount-time work for the intro decks
     SAMPLE_LIB    : { decks: LibDeck[] }                  the catalogue (deck order = body order)
   Every slide is a .pp-slide <section> carrying data-sid={sid}, so a Saved copy ("<sid>~<savedId>")
   renders the same markup under its own id. */

import type { ReactNode } from "react";

type Render = (sid: string) => ReactNode;

/* catalogue: two sample masters plus the Short Pack, whose six slides the engage page renders itself */
export const SAMPLE_LIB = {
  decks: [
    {
      id: "intro", title: "Introduction deck (sample)", blurb: "Who we are and what we do.",
      slides: [
        { sid: "intro-overview", id: "overview", label: "Overview", title: "Lorem ipsum overview" },
        { sid: "intro-team", id: "team", label: "Team", title: "The team behind it" },
      ],
    },
    {
      id: "sales", title: "Sales deck (sample)", blurb: "Value and outcomes.",
      slides: [
        { sid: "sales-value", id: "value", label: "Value", title: "Lorem ipsum value", dark: true },
      ],
    },
    {
      id: "shortpack", title: "Short Pack",
      slides: [
        { sid: "cost", id: "cost", label: "The problem", title: "The problem", dark: true },
        { sid: "modules", id: "modules", label: "One platform", title: "One platform" },
        { sid: "flow", id: "flow", label: "The workflow", title: "The workflow", dark: true },
        { sid: "compare", id: "compare", label: "Today vs Acme", title: "Today vs Acme" },
        { sid: "proof", id: "proof", label: "Proof", title: "Proof" },
        { sid: "golive", id: "golive", label: "Go live", title: "Go live" },
      ],
    },
  ],
};

export const INTRO_SLIDES: Record<string, Render> = {
  overview: (sid) => (
    <section className="pp-slide pp-soft" id={sid} data-sid={sid} data-fit>
      <div className="pp-inner">
        <span className="eyebrow r">Overview</span>
        <h2 className="h2 r">Lorem ipsum <span className="grad-move">dolor sit amet</span></h2>
        <p className="lead r">Consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
      </div>
    </section>
  ),
  team: (sid) => (
    <section className="pp-slide" id={sid} data-sid={sid} data-fit>
      <div className="pp-inner">
        <span className="eyebrow r">Team</span>
        <h2 className="h2 r">The team <span className="grad-move">behind it</span></h2>
        <div className="intro-team stagger">
          {[["Jane Doe", "Sales Director"], ["John Smith", "Account Executive"], ["Alex Lee", "Chief Executive Officer"]].map(([n, t]) => (
            <div className="intro-person" key={n}><img src="/avatars/placeholder.png" alt={n} /><b>{n}</b><span>{t}</span></div>
          ))}
        </div>
      </div>
    </section>
  ),
};
export const INTRO_CSS = `
.intro-team{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;margin-top:2rem}
.intro-person{display:flex;flex-direction:column;align-items:center;gap:.4rem;text-align:center}
.intro-person img{width:120px;height:120px;border-radius:50%;object-fit:cover}
.intro-person span{color:var(--muted)}
`;
/* the real intro decks scale their embedded product screens on mount; the sample has none */
export function INTRO_Runtime() {
  return null;
}

export const SALES_SLIDES: Record<string, Render> = {
  value: (sid) => (
    <section className="pp-slide msl-dk" id={sid} data-sid={sid} data-fit>
      <div className="pp-inner">
        <span className="eyebrow r">Value</span>
        <h2 className="h2 r">Lorem ipsum <span className="grad-move">value</span></h2>
        <ul className="bullets stagger">
          <li>Lorem ipsum dolor sit amet</li>
          <li>Consectetur adipiscing elit</li>
          <li>Sed do eiusmod tempor incididunt</li>
        </ul>
      </div>
    </section>
  ),
};
export const SALES_CSS = `
.pp-slide.msl-dk .bullets li{color:rgba(255,255,255,.82)}
`;
