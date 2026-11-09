"use client";

import { DeckShell, Section } from "@/components/deck/DeckShell";
import { asset } from "@/lib/asset";
import "@/components/deck/kit.css";
import "./gen.css";

// A generated deck rendered THROUGH the real master shell (DeckShell): it inherits the left
// sidenav, right rail, arrows, cross-fading backgrounds, logo and top chrome. Only the slide
// bodies come from the AI spec — same components/CSS as the master decks, just different text.

type Stat = { value?: string; label?: string; heading?: string; text?: string };
type Slide = {
  type: string; title?: string; subtitle?: string; label?: string;
  points?: string[]; items?: string[]; stats?: Stat[]; cards?: Stat[]; steps?: Stat[];
  hero?: Stat; quote?: string; author?: string; asideHeading?: string; asideText?: string;
  screen?: string; chips?: string[]; text?: string;
};
type Spec = { title?: string; slides: Slide[] };

const SCREENS = ["home", "invoices", "purchase-orders", "recipes", "inventory", "budgets", "suppliers", "reports"];

// turn [text](url) into links, escape nothing (React handles it)
function md(t?: string) {
  if (!t) return null;
  const parts = String(t).split(/(\[[^\]]+\]\(https?:[^)]+\))/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[([^\]]+)\]\((https?:[^)]+)\)$/);
    return m ? <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a> : <span key={i}>{p}</span>;
  });
}
// last word of the cover title in the animated brand gradient (like the master "buy")
function gradLast(t?: string) {
  const w = String(t || "").trim().split(/\s+/);
  if (w.length < 2) return <span className="grad-move">{t}</span>;
  const last = w.pop();
  return <>{w.join(" ")} <span className="grad-move">{last}</span></>;
}

const arr = <T,>(x?: T[]): T[] => Array.isArray(x) ? x : [];

function navLabel(s: Slide): string {
  if (s.type === "cover") return "Overview";
  if (s.type === "cta") return "Get started";
  return (s.title || s.label || s.type).replace(/[.:].*$/, "").slice(0, 26);
}

function SlideBody({ s }: { s: Slide }) {
  switch (s.type) {
    case "cover": case "title":
      return (
        <div className="pp-inner pp-split gen-cover">
          <div>
            <div className="eyebrow">Sample product tagline</div>
            <h1 className="title">{gradLast(s.title)}</h1>
            {s.subtitle && <p className="lead">{md(s.subtitle)}</p>}
          </div>
          <div className="gen-emblem-wrap">
            <div className="gen-emblem-glow" />
            <img className="gen-emblem" src={asset("/brand/logo-placeholder.svg")} alt="Acme" />
          </div>
        </div>
      );
    case "section":
      return <div className="pp-inner">{s.label && <div className="eyebrow">{s.label}</div>}<h2 className="title gen-section-h">{md(s.title)}</h2></div>;
    case "kpi":
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><div className="cfo-band">{arr(s.stats).slice(0, 4).map((x, i) => <div key={i}><div className="v">{x.value}</div><div className="l">{md(x.label)}</div></div>)}</div></div>;
    case "bento": {
      const h = s.hero || {};
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><div className="solve-grid"><div className="solve-hero">{h.value && <div className="big">{h.value}</div>}<h3>{md(h.heading)}</h3><p>{md(h.text)}</p></div>{arr(s.cards).slice(0, 3).map((c, i) => <div key={i} className="solve-card">{c.value && <div className="n">{c.value}</div>}<h3>{md(c.heading)}</h3><p>{md(c.text)}</p></div>)}</div></div>;
    }
    case "features": {
      const cs = arr(s.cards).slice(0, 4);
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><div className="mod-grid">{cs.map((c, i) => <div key={i} className={`mod-card${cs.length <= 2 ? " wide" : ""}`}><div className="mn">{String(i + 1).padStart(2, "0")}</div><h3>{md(c.heading)}</h3><p>{md(c.text)}</p></div>)}</div></div>;
    }
    case "steps": {
      const st = arr(s.steps).slice(0, 4);
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><div className={st.length > 3 ? "steps4" : "steps6"}>{st.map((x, i) => <div key={i} className="step"><div className="k">STEP {i + 1}</div><h3>{md(x.heading)}</h3><p>{md(x.text)}</p></div>)}</div></div>;
    }
    case "split":
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><div className="split2"><ul className="bullets">{arr(s.points).map((p, i) => <li key={i}>{md(p)}</li>)}</ul>{(s.asideHeading || s.asideText) && <div className="solve-hero">{s.asideHeading && <h3>{md(s.asideHeading)}</h3>}{s.asideText && <p>{md(s.asideText)}</p>}</div>}</div></div>;
    case "proof":
      return <div className="pp-inner"><div className="res-row"><div className="res-quote"><blockquote>{md(s.quote)}</blockquote>{s.author && <cite><b>{s.author}</b></cite>}</div>{arr(s.stats).length > 0 && <div className="res-side">{arr(s.stats).slice(0, 2).map((x, i) => <div key={i} className="res-mini"><div className="v">{x.value}</div><div className="l">{md(x.label)}</div></div>)}</div>}</div></div>;
    case "quote":
      return <div className="pp-inner"><blockquote className="gen-quote">{md(s.quote)}</blockquote>{s.author && <cite className="gen-cite">{s.author}</cite>}</div>;
    case "chips":
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><div className="chiprow gen-chips-l">{arr(s.items).map((it, i) => <span key={i} className="chip">{it}</span>)}</div></div>;
    case "showcase": {
      const scr = SCREENS.includes(s.screen || "") ? s.screen! : "home";
      return <div className="pp-inner gen-sw"><div className="gen-sw-copy"><h2 className="h2">{md(s.title)}</h2>{arr(s.points).length > 0 ? <ul className="bullets">{arr(s.points).map((p, i) => <li key={i}>{md(p)}</li>)}</ul> : s.text && <p className="lead">{md(s.text)}</p>}</div><div className="gen-sw-panel"><img src={asset(`/screens/poster-${scr}.webp`)} alt="Acme" /></div></div>;
    }
    case "agenda":
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><div className="steps4">{arr(s.items).slice(0, 6).map((it, i) => <div key={i} className="step"><div className="k">{String(i + 1).padStart(2, "0")}</div><h3>{md(it)}</h3></div>)}</div></div>;
    case "cta":
      return <div className="pp-inner gen-cta"><div className="eyebrow">Sample product tagline</div><h2 className="title gen-section-h">{md(s.title)}</h2>{s.subtitle && <p className="lead">{md(s.subtitle)}</p>}{arr(s.chips).length > 0 && <div className="chiprow gen-chips-l">{arr(s.chips).map((c, i) => <span key={i} className="chip">{c}</span>)}</div>}</div>;
    default:
      return <div className="pp-inner"><h2 className="h2">{md(s.title)}</h2><p className="lead">{md(s.text)}</p></div>;
  }
}

export default function GenDeckClient({ spec }: { spec: Spec }) {
  const sections: Section[] = spec.slides.map((s, i) => ({ id: `s${i}`, label: navLabel(s) }));
  const isGrad = (t: string) => t === "section" || t === "cta";
  return (
    <DeckShell sections={sections}>
      {spec.slides.map((s, i) => (
        <section key={i} id={`s${i}`} className={`pp-slide gen-slide${isGrad(s.type) ? " pp-grad" : ""}${s.type === "cover" ? " pp-soft" : ""}`}>
          <SlideBody s={s} />
        </section>
      ))}
    </DeckShell>
  );
}
