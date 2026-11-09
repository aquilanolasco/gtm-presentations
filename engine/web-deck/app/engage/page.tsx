"use client";

/* Engagement sales deck TEMPLATE (the Create-from-Master engine's output).

   One build of this route serves EVERY prospect deck. Everything prospect-specific comes from a
   `spec.json` that sits next to the deck's index.html (written by the engage worker on the VPS),
   fetched at runtime: co-branded cover (Acme + the prospect's logo), native intro slides
   written for that prospect (strategy cards, tinted value cards, commercial terms, a competitor
   checklist), then the Short Pack master body and the closing CTA signed by the rep who created
   the deck. The master body below is the Short Pack, shared verbatim by every generated deck so
   the family reads as one. (All copy in this export is sample copy; original content removed.)

   Build once (shared assets, see deploy-engage-template.sh):
     DECK_EXPORT=1 DECK_BASE_PATH=/p/_engage/deck ASSET_PREFIX=/p/_engage/deck NEXT_PUBLIC_DECK_BASE_PATH=/p/_engage/deck npm run build
   Each deck dir then holds a copy of out/engage.html as index.html + spec.json + logo/hero files. */

import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { DeckShell, Counter, type Section, type EditNav } from "@/components/deck/DeckShell";
import DeckExports from "@/components/deck/DeckExports";
import { ClosingCTA, type DeckCreator } from "@/components/deck/closing-cta";
// currency-ctx / currency-control: live currency conversion of the deck's figures. lib/asset: base-path helper.
import { CurrencyProvider } from "@/components/sales/currency-ctx";
import CurrencyControl from "@/components/sales/currency-control";
import { LIBRARY, entryOf, baseOf, normalizeBody, isLibraryRendered, LibraryStyles, LibrarySlide, LibraryRuntime } from "@/components/library";
import { asset } from "@/lib/asset";
import { ShoppingCart, Tag, FileText, CheckCircle2, PiggyBank, ChefHat, CalendarClock, type LucideIcon } from "lucide-react";
import "@/components/deck/kit.css";

/* ---------- spec ---------- */
type Presenter = { name: string; title: string; email: string; phone?: string; avatar: string; booking?: string };
type SlideBase = { id: string; label: string; eyebrow?: string; title: string };
export type CardsSlide = SlideBase & { type: "cards"; cards: { h: string; items: string[] }[]; rows?: { k: string; items: { b: string; t: string }[] }[] };
export type TintsSlide = SlideBase & { type: "tints"; cards: { k?: string; h: string; p: string }[] };
export type TermsSlide = SlideBase & { type: "terms"; cards: { k: string; big: string; h: string; p: string; items?: string[] }[] };
export type ChecklistSlide = SlideBase & { type: "checklist"; columns: string[]; rows: { label: string; cells: (0 | 1)[] }[]; note?: string };
export type ImageSlide = { type: "image"; id: string; label: string; img: string; alt?: string };
export type IntroSlide = CardsSlide | TintsSlide | TermsSlide | ChecklistSlide | ImageSlide;
export type BodyId = "cost" | "modules" | "flow" | "compare" | "proof" | "golive";
export type EngageSpec = {
  title?: string;
  client: string;            // full prospect name ("Example Hotels")
  short?: string;            // short form for headlines ("Example")
  eyebrow?: string;
  subtitle: string;
  chips?: string[];
  logo: string;              // "logo.png" (next to the deck) or an absolute URL
  logoOnDark?: boolean;      // informational only (the worker recolours white artwork; no badge is ever drawn)
  hero?: string;             // optional property photo for the split cover
  preparedBy: string;
  date: string;
  intro: IntroSlide[];
  body?: string[];           // the slides after the opening slides: library sids (the catalogue in components/library), or "<sid>~<savedId>" for a rep's Saved slide; default = the Short Pack
  bodyLabels?: Record<string, string>; // nav labels for Saved slides (their saved name), written by the worker
  presenter?: Presenter;
  exportSlug?: string;
  /* Slide Editor layer (written by the GTM app / engage worker, never by the writer):
     slides the rep hid from the presentation, and slides the rep added (placed after `after`) */
  hidden?: string[];
  extra?: { after: string; slide: IntroSlide }[];
  /* legacy (first engage build): intro slides as images */
  introSlides?: { img: string; label: string; alt?: string }[];
};


/* The download signature roster (the Presentations module's "Download signature" picker and the
   viewer's picker use these keys). The export worker captures the closing page once per key via
   ?sig=<key>, so every generated deck ships the same --<key> variants as the master decks. */
// sample presenters (original roster removed)
const ROSTER: Record<string, Presenter> = {
  jane: { name: "Jane Doe", title: "Sales Director", email: "jane@example.com", phone: "+1 555 0100", avatar: "/avatars/placeholder.png", booking: "https://cal.example.com/jane" },
  john: { name: "John Smith", title: "Account Executive", email: "john@example.com", phone: "+1 555 0101", avatar: "/avatars/placeholder.png", booking: "https://cal.example.com/john" },
  alex: { name: "Alex Lee", title: "Chief Executive Officer", email: "alex@example.com", phone: "+1 555 0102", avatar: "/avatars/placeholder.png", booking: "https://cal.example.com/alex" },
  sam: { name: "Sam Taylor", title: "Head of Account Management", email: "sam@example.com", avatar: "/avatars/placeholder.png", booking: "https://cal.example.com/sam" },
};
const DEFAULT_PRESENTER: Presenter = ROSTER.jane;

/* Demo spec: what the template shows when no spec.json sits next to it (local dev / template preview). */
// sample copy (original content removed)
const DEFAULT_SPEC: EngageSpec = {
  client: "Example Hotels",
  short: "Example",
  eyebrow: "Operations strategy",
  subtitle: "Lorem ipsum dolor sit amet, consectetur adipiscing elit: sed do eiusmod tempor incididunt ut labore et dolore, run from one platform.",
  chips: ["Prepared for Example Hotels", "Sample product tagline"],
  logo: asset("/brand/logo-placeholder.svg"),
  hero: asset("/brand/logo-placeholder.svg"),
  preparedBy: "Jane Doe",
  date: "1 January 2026",
  intro: [
    { type: "cards", id: "strategy", label: "The strategy", eyebrow: "The strategy", title: "A plan built around [[how Example runs]]",
      cards: [
        { h: "Operational profile", items: ["Lorem ipsum dolor sit amet", "Consectetur adipiscing elit, sed do eiusmod", "Tempor incididunt ut labore et dolore"] },
        { h: "The opportunity", items: ["Ut enim ad minim veniam", "Quis nostrud exercitation ullamco", "Laboris nisi ut aliquip ex ea commodo"] },
        { h: "Integrations", items: ["Duis aute irure dolor", "In reprehenderit in voluptate", "Velit esse cillum dolore eu fugiat"] },
      ],
      rows: [
        { k: "Core platform", items: [{ b: "Feature one", t: "Lorem ipsum dolor sit amet." }, { b: "Feature two", t: "Consectetur adipiscing elit." }, { b: "Feature three", t: "Sed do eiusmod tempor." }] },
        { k: "Service commitments", items: [{ b: "Commitment one", t: "and ut labore et dolore." }, { b: "Commitment two", t: "and magna aliqua ut enim." }, { b: "Commitment three", t: "ad minim veniam, quis nostrud." }] },
      ] },
    { type: "tints", id: "ops", label: "Operations", eyebrow: "Operations", title: "Cost control, [[built in]]",
      cards: [
        { h: "Capability one", p: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore." },
        { h: "Capability two", p: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo." },
        { h: "Proven at scale", p: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur." },
      ] },
  ],
  presenter: ROSTER.jane,
  exportSlug: "acme-engage",
};

function normalize(raw: Partial<EngageSpec>): EngageSpec {
  // a real spec (it names a client) never inherits the demo's prospect fields (logo, hero, copy):
  // only an empty spec falls back to the demo deck
  const s: EngageSpec = (raw.client ? { preparedBy: "Acme", date: "", subtitle: "", logo: "", ...raw } : { ...DEFAULT_SPEC, ...raw }) as EngageSpec;
  // legacy image-only intro slides (the first engage build) still render
  if ((!s.intro || !s.intro.length) && raw.introSlides?.length) {
    s.intro = raw.introSlides.map((x, i) => ({ type: "image" as const, id: `intro${i}`, label: x.label, img: x.img, alt: x.alt }));
  }
  if (!Array.isArray(s.intro)) s.intro = [];
  s.body = normalizeBody(s.body); // known library slides only, legacy bare ids = the Short Pack, library order
  if (!s.short) s.short = s.client;
  s.hidden = Array.isArray(s.hidden) ? s.hidden.filter((x): x is string => typeof x === "string") : [];
  s.extra = Array.isArray(s.extra) ? s.extra.filter((x) => x && typeof x.after === "string" && x.slide && typeof x.slide.id === "string") : [];
  return s;
}

/* a `[[gradient]]` marker inside a title becomes the moving brand-gradient span */
function rich(s: string) {
  const parts = s.split(/\[\[(.+?)\]\]/g);
  return parts.map((p, i) => (i % 2 ? <span key={i} className="grad-move">{p}</span> : <Fragment key={i}>{p}</Fragment>));
}
/* spec image paths: "logo.png" lives next to the deck, "/x" is site-absolute, http(s) and data: pass through */
const img = (p?: string) => (!p ? "" : /^(https?:)?\/\/|^data:|^\.\//.test(p) || p.startsWith("/") ? p : `./${p}`);

const TINT = ["gw-c-teal", "gw-c-violet", "gw-c-blue"];

type Row = { icon: LucideIcon; job: string; old: string; now: string; bars: number[]; win: string };
// sample copy (original content removed)
const COMPARE: Row[] = [
  { icon: ShoppingCart, job: "Task one", old: "Lorem ipsum dolor sit", now: "Amet consectetur adipiscing", bars: [1, .78, .5, .22], win: "Faster" },
  { icon: Tag, job: "Task two", old: "Sed do eiusmod tempor", now: "Incididunt ut labore et dolore", bars: [1, .93, .9, .88], win: "X% off" },
  { icon: FileText, job: "Task three", old: "Ut enim ad minim veniam", now: "Quis nostrud exercitation", bars: [1, .62, .3, .03], win: "$X to $Y" },
  { icon: CheckCircle2, job: "Task four", old: "Duis aute irure dolor", now: "In reprehenderit in voluptate", bars: [.2, .5, .8, 1], win: "Automatic" },
  { icon: PiggyBank, job: "Task five", old: "Velit esse cillum dolore", now: "Eu fugiat nulla pariatur", bars: [.25, .55, .8, 1], win: "Earlier" },
  { icon: ChefHat, job: "Task six", old: "Excepteur sint occaecat", now: "Cupidatat non proident", bars: [.3, .55, .82, 1], win: "Live" },
  { icon: CalendarClock, job: "Task seven", old: "Sunt in culpa qui officia", now: "Deserunt mollit anim id est", bars: [1, .7, .42, .2], win: "Days" },
];
const GOLIVE: [string, string, string][] = [
  ["01", "Step one", "Lorem ipsum dolor sit amet, consectetur adipiscing elit."],
  ["02", "Step two", "Sed do eiusmod tempor incididunt ut labore et dolore."],
  ["03", "Step three", "Ut enim ad minim veniam, quis nostrud exercitation."],
  ["04", "Step four", "Duis aute irure dolor in reprehenderit in voluptate."],
];

/* Sample stand-ins for the Short Pack graphics. The original components/sales/cost-viz,
   gradient-cards and workflow-board (company content) are not part of this export; these keep the
   same export names and the class hooks the styles below target. */
const SampleViz = () => (
  <div className="cv"><div className="cv-track"><span className="cv-fill" style={{ width: "62%" }} /></div></div>
);
const LagViz = SampleViz, LeakViz = SampleViz, HoursViz = SampleViz, MarginViz = SampleViz, BreakdownViz = SampleViz;
function GradientCards() {
  const cards: [string, string, string, string, string][] = [
    ["01", "Module one", "10x", "#3b82f6", "#8b5cf6"],
    ["02", "Module two", "24/7", "#8b5cf6", "#3b82f6"],
    ["03", "Module three", "99%", "#3b82f6", "#10b981"],
    ["04", "Module four", "1 view", "#8b5cf6", "#10b981"],
  ];
  return (
    <div className="gc-grid">
      {cards.map(([n, h, stat, from, to]) => (
        <div className="gc" key={n} style={{ "--from": from, "--to": to } as CSSProperties}>
          <div className="gc-face"><span className="gc-sheen" /><span className="gc-n">{n}</span><h3>{h}</h3><div className="gc-stat">{stat}</div><p>Lorem ipsum dolor sit amet.</p></div>
        </div>
      ))}
    </div>
  );
}
function WorkflowBoard() {
  const steps = ["Stage one", "Stage two", "Stage three", "Stage four", "Stage five", "Stage six"];
  return (
    <div className="wb">
      {steps.map((t, i) => (
        <div className="wb-node" key={t} style={{ left: `${4 + (i % 3) * 33}%`, top: i < 3 ? "12%" : "56%" }}>
          <span className="wb-k">{String(i + 1).padStart(2, "0")}</span><b>{t}</b><p>Lorem ipsum dolor sit amet.</p>
        </div>
      ))}
    </div>
  );
}

export default function EngageDeck() {
  const [spec, setSpec] = useState<EngageSpec | null>(null);
  // Slide Editor session: the GTM app opens the deck with ?edit=1 inside its editor frame. Every slide
  // renders (hidden ones dimmed and badged) and the left nav grows an eye (hide / show) and a + (add).
  const [edit] = useState<boolean>(() => { try { return /[?&]edit=1/.test(window.location.search); } catch { return false; } });
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const fallback = (): EngageSpec => {
      try { const s = process.env.NEXT_PUBLIC_ENGAGE_SPEC; if (s) return normalize(JSON.parse(s)); } catch { /* no build-time spec */ }
      return normalize({});
    };
    // ?lib=<deck id | all>: the slide library on its own, no prospect (the Create pane's thumbnails are
    // captured from this view: /p/_engage/deck/?lib=intro, ?lib=sales, ?lib=shortpack)
    let lib = "";
    try { lib = new URLSearchParams(window.location.search).get("lib") || ""; } catch { /* no window */ }
    if (lib) {
      const decks = LIBRARY.filter((d) => lib === "all" || d.id === lib);
      setSpec(normalize({
        client: "Acme", short: "Acme", eyebrow: "Slide library", subtitle: decks.map((d) => d.title).join(", ") || "No such deck",
        chips: ["Slide library"], logo: asset("/brand/logo-placeholder.svg"), preparedBy: "Acme", date: "", intro: [],
        body: decks.flatMap((d) => d.slides.map((s) => s.sid)), exportSlug: "acme-library",
      }));
      setHidden([]);
      return () => { alive = false; };
    }
    // spec.json is resolved against the deck's own URL (/p/<slug>/deck/spec.json)
    fetch(`spec.json?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) { const n = normalize(j); setSpec(n); setHidden(n.hidden || []); } })
      .catch(() => { if (alive) setSpec(fallback()); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (spec) document.title = spec.title || `Acme & ${spec.client}`; }, [spec]);
  // Engagement decks carry stable slide ids (data-sid). The edit runtime keys its saved words, sizes
  // and photos by them, so hiding or adding a slide never shifts another slide's edits.
  useEffect(() => { document.documentElement.setAttribute("data-engage", "1"); }, []);
  // The edit runtime (/pp-edit.js, served by the GTM app) applies the deck's saved edits.json on every
  // view. In an editor session the app injects it itself; this covers Present, the public link and export.
  useEffect(() => {
    if (!spec || document.querySelector("script[data-ppedit]")) return;
    const s = document.createElement("script"); s.src = "/pp-edit.js"; s.setAttribute("data-ppedit", "1"); document.body.appendChild(s);
  }, [spec]);
  // editor: badge the hidden slides on the canvas (they stay visible to the rep, dimmed)
  useEffect(() => {
    if (!edit) return;
    document.querySelectorAll<HTMLElement>(".pp-slide[data-sid]").forEach((el) => el.classList.toggle("pp-hidden-slide", hidden.includes(el.dataset.sid || "")));
  }, [edit, hidden, spec]);

  // DeckShell measures its slides once on mount, so it only mounts once the spec (and every slide) exists.
  if (!spec) return <div className="pp" style={{ minHeight: "100vh", background: "#fff" }} />;

  // The slide sequence: cover, the written intro slides, the library slides the rep ticked (the master
  // decks and the Short Pack, in library order; a Saved slide sits right after its master), closing.
  // Every added slide is placed after its anchor. Outside the editor, hidden slides are dropped from the
  // sequence entirely, so Present, the public link and the PowerPoint / PDF exports never show them.
  type Item = { id: string; label: string; dark?: boolean; slide?: IntroSlide; lib?: boolean };
  const seq: Item[] = [
    { id: "cover", label: "Overview" },
    ...spec.intro.map((s) => ({ id: s.id, label: s.label, slide: s })),
    ...(spec.body || []).map((sid) => ({ id: sid, label: spec.bodyLabels?.[sid] || entryOf(sid)?.label || sid, dark: entryOf(sid)?.dark, lib: isLibraryRendered(sid) })),
    { id: "close", label: "Get in touch" },
  ];
  for (const x of spec.extra || []) {
    if (seq.some((i) => i.id === x.slide.id)) continue;
    const at = seq.findIndex((i) => i.id === x.after);
    seq.splice(at >= 0 ? at + 1 : seq.length - 1, 0, { id: x.slide.id, label: x.slide.label, slide: x.slide });
  }
  const items = edit ? seq : seq.filter((i) => !hidden.includes(i.id));
  const sections: Section[] = items.map(({ id, label, dark }) => ({ id, label, dark }));
  // which masters' stylesheets (and mount-time runtime) the page needs
  const libDecks = Array.from(new Set(items.filter((i) => i.lib).map((i) => entryOf(i.id)!.deck)));
  const editNav: EditNav | undefined = edit ? {
    hidden,
    onToggleHidden: (id) => setHidden((h) => {
      const n = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
      try { window.parent.postMessage({ type: "ppHidden", hidden: n }, "*"); } catch { /* standalone */ }
      return n;
    }),
    onAdd: (after, afterLabel) => { try { window.parent.postMessage({ type: "ppAddSlide", after, afterLabel }, "*"); } catch { /* standalone */ } },
    // a master slide (library or Short Pack), as edited here, can be kept as a Saved slide for the next deck
    canSave: (id) => !!entryOf(id),
    onSave: (sid, label) => { try { window.parent.postMessage({ type: "ppSaveSlide", sid, label }, "*"); } catch { /* standalone */ } },
  } : undefined;
  // ?sig=<key> swaps the closing-page signature (used by the export worker for the --<key> download variants)
  let sig = "";
  try { sig = new URLSearchParams(window.location.search).get("sig") || ""; } catch { /* no window */ }
  const p = (sig && ROSTER[sig]) || spec.presenter || DEFAULT_PRESENTER;
  const creator: DeckCreator = { name: p.name, title: p.title, email: p.email, phone: p.phone, avatar: p.avatar, booking: p.booking ? { href: p.booking } : undefined };
  const exportSlug = spec.exportSlug || "acme-engage";

  // every fixed slide is built once here and then laid out in sequence order below; the Short Pack's six
  // are functions of their id, so a Saved copy ("cost~k3f9") renders beside the original
  const parts: Record<string, ReactNode> = {};
  const partFns: Record<string, (sid: string) => ReactNode> = {};

  // 01 cover: Acme + prospect lockup, title, lead, chips, byline. With a hero photo it splits.
  parts.cover = (
      <section className="pp-slide pp-soft pp-hide-logo" id="cover" data-sid="cover" style={{ overflow: "hidden" }}>
        {(() => {
          const left = (
            <>
              <div className="gw-lockup gw-lockup-duo r">
                <img className="gw-lockup-logo gw-lk-pp" src={asset("/brand/logo-placeholder.svg")} alt="Acme" />
                <span className="gw-lockup-div" />
                {/* never a badge or container behind the client logo: the worker supplies a dark or
                    coloured version, recoloured to black when the brand has none */}
                <img className="gw-lockup-logo gw-lk-client" src={img(spec.logo)} alt={spec.client} />
              </div>
              <div className="gw-cover-mid r">
                <span className="eyebrow">{spec.eyebrow || "Partnership strategy"}</span>
                <h1 className="title">Acme &amp; <span className="grad-move">{spec.client}</span></h1>
                <p className="lead">{spec.subtitle}</p>
                <div className="sp-chips gw-chips-line">
                  {(spec.chips && spec.chips.length ? spec.chips : [`Prepared for ${spec.client}`, "Sample product tagline"]).map((c, i) => (
                    <span key={i} className="sp-chip">{c}</span>
                  ))}
                </div>
              </div>
              <div className="gw-byline r">
                <span className="gw-by-name">Prepared by {spec.preparedBy}</span>
                <span className="gw-by-date">{spec.date}</span>
              </div>
            </>
          );
          return spec.hero ? (
            <div className="pp-inner gw-cover2">
              <div className="gw-cover2-l">{left}</div>
              <div className="gw-cover2-r r"><img className="gw-hero" src={img(spec.hero)} alt={spec.client} /></div>
            </div>
          ) : (
            <div className="pp-inner gw-cover-stack">{left}</div>
          );
        })()}
      </section>
  );

  // the prospect-specific intro slides (and every slide the rep added), rebuilt natively
  const renderIntro = (s: IntroSlide): ReactNode => {
        if (s.type === "image") {
          return (
            <section key={s.id} className="pp-slide pp-soft pp-hide-logo" id={s.id} data-sid={s.id} style={{ padding: "0 clamp(1.5rem,3.5vw,4rem) 0 clamp(13.5rem,15.5vw,15.5rem)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              <img className="gw-imgslide" src={img(s.img)} alt={s.alt || s.label} />
            </section>
          );
        }
        const head = (
          <>
            <span className="eyebrow r">{s.eyebrow || s.label}</span>
            <h2 className="h2 r">{rich(s.title)}</h2>
          </>
        );
        if (s.type === "cards") {
          return (
            <section key={s.id} className="pp-slide pp-soft" id={s.id} data-sid={s.id} data-fit>
              <div className="pp-inner">
                {head}
                <div className="gw-cards stagger" style={s.cards.length !== 3 ? { gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, s.cards.length))},1fr)` } : undefined}>
                  {s.cards.map((c, i) => (
                    <div className="gw-card" key={i}>
                      <h3>{c.h}</h3>
                      <ul>{c.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
                    </div>
                  ))}
                </div>
                {s.rows && s.rows.length > 0 && (
                  <div className={`gw-rows stagger${s.rows.length === 1 ? " n1" : ""}`}>
                    {s.rows.map((r, i) => (
                      <div className="gw-row" key={i}>
                        <span className="gw-row-k">{r.k}</span>
                        <div className="gw-row-items" style={r.items.length !== 3 ? { gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, r.items.length))},1fr)` } : undefined}>
                          {r.items.map((it, j) => <div key={j}><b>{it.b}</b>{it.t}</div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        }
        if (s.type === "tints") {
          const n = s.cards.length;
          return (
            <section key={s.id} className="pp-slide pp-soft" id={s.id} data-sid={s.id} data-fit>
              <div className="pp-inner">
                {head}
                <div className={`gw-fnb stagger${n === 2 ? " n2" : n >= 4 ? " n4" : ""}`}>
                  {s.cards.map((c, i) => (
                    <div className={`gw-card ${TINT[i % 3]}`} key={i}>
                      {c.k && <span className="en-pk">{c.k}</span>}
                      <h3>{c.h}</h3>
                      <p>{c.p}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        if (s.type === "terms") {
          return (
            <section key={s.id} className="pp-slide pp-soft" id={s.id} data-sid={s.id} data-fit>
              <div className="pp-inner">
                {head}
                <div className={`en-terms stagger${s.cards.length >= 3 ? " n3" : ""}`}>
                  {s.cards.map((c, i) => (
                    <div className="gw-card en-tcard" key={i}>
                      <span className="en-pk">{c.k}</span>
                      <div className="en-big">{c.big}</div>
                      <h3>{c.h}</h3>
                      <p>{c.p}</p>
                      {c.items && c.items.length > 0 && <ul>{c.items.map((it, j) => <li key={j}>{it}</li>)}</ul>}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        }
        // checklist: our product first column, competitors after
        return (
          <section key={s.id} className="pp-slide pp-soft" id={s.id} data-sid={s.id} data-fit>
            <div className="pp-inner">
              {head}
              <table className="gw-cmp r">
                <thead>
                  <tr><th>Capability</th><th className="pp">Acme</th>{s.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {s.rows.map((row, ri) => (
                    <tr key={ri}>
                      <td>{row.label}</td>
                      {row.cells.map((v, ci) => {
                        const isPP = ci === 0;
                        return <td key={ci} className={isPP ? "pp" : ""}>{v ? <span className={`gw-tick ${isPP ? "gw-tick-pp" : "gw-tick-comp"}`}>&#10003;</span> : <span className="gw-x">&#10005;</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.note && <p className="gw-note r">{s.note}</p>}
            </div>
          </section>
        );
  };

  // master body: the Short Pack (sample copy, original content removed)
  partFns.cost = (sid) => (
        <section className="pp-slide msl-dk" id={sid} data-sid={sid} data-fit>
          <div className="pp-inner">
            <span className="eyebrow r">The problem</span>
            <h2 className="h2 r">Lorem ipsum is <span className="grad-move">dolor sit amet</span> by the time you see it</h2>
            <div className="sp-cost">
              <div className="sp-cost-hero r">
                <span className="l">Key metric</span>
                <div className="v">$X</div>
                <h3>Lorem ipsum dolor sit amet</h3>
                <p>Consectetur adipiscing elit. Sed do eiusmod tempor incididunt, every time.</p>
                <div className="split">
                  <div className="v" style={{ fontSize: "clamp(1.8rem,3vw,3rem)" }}>$Y</div>
                  <p style={{ marginTop: ".2rem" }}>On Acme</p>
                </div>
              </div>
              <div className="sp-cost-grid stagger">
                <div className="sp-cost-card"><div className="n">N days</div><h3>Lorem ipsum dolor</h3><LagViz /></div>
                <div className="sp-cost-card"><div className="n">N hrs</div><h3>Sit amet consectetur</h3><HoursViz /></div>
                <div className="sp-cost-card"><div className="n">N%</div><h3>Adipiscing elit sed</h3><LeakViz /></div>
                <div className="sp-cost-card"><div className="n">X = ?</div><h3>Do eiusmod tempor</h3><MarginViz /></div>
                <div className="sp-addup">
                  <span>Add it up: lorem ipsum dolor sit amet, <b>$X a year</b> consectetur adipiscing elit.</span>
                  <BreakdownViz />
                </div>
              </div>
            </div>
          </div>
        </section>
  );

  partFns.modules = (sid) => (
        <section className="pp-slide pp-grad" id={sid} data-sid={sid} data-fit>
          <div className="pp-inner">
            <span className="eyebrow r">One platform</span>
            <h2 className="h2 r">Lorem ipsum modules, <span className="grad-move">one login</span></h2>
            <GradientCards />
            <div className="sp-covers r">
              <h3>Lorem ipsum dolor sit amet.</h3>
              <p>Category one, category two, category three, category four. Consectetur adipiscing elit, sed do eiusmod tempor.</p>
            </div>
          </div>
        </section>
  );

  partFns.flow = (sid) => (
        <section className="pp-slide msl-dk" id={sid} data-sid={sid} data-fit>
          <div className="pp-inner">
            <span className="eyebrow r">The workflow</span>
            <h2 className="h2 r">One flow, <span className="grad-move">end to end</span>, controls built in</h2>
            <p className="lead r" style={{ color: "rgba(255,255,255,.7)", maxWidth: "82ch" }}>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore.</p>
            <WorkflowBoard />
          </div>
        </section>
  );

  partFns.compare = (sid) => (
        <section className="pp-slide" id={sid} data-sid={sid} data-fit>
          <div className="pp-inner">
            <span className="eyebrow r">Today vs Acme</span>
            <h2 className="h2 r">Same work. <span className="grad-move">Different outcome.</span></h2>
            <div className="sp-cmp r">
              <div className="sp-cmp-row"><span>The job</span><span>How it runs today</span><span>On Acme</span><span>Shift</span></div>
              {COMPARE.map((r) => {
                const Icon = r.icon;
                const max = Math.max(...r.bars);
                return (
                  <div className="sp-cmp-row" key={r.job}>
                    <span className="k"><span className="sp-cmp-ic"><Icon size={15} strokeWidth={2} /></span>{r.job}</span>
                    <span className="old">{r.old}</span>
                    <span className="new">{r.now}</span>
                    <span className="sp-cmp-g">
                      <span className="sp-cmp-bars">
                        {r.bars.map((b, i) => (
                          <i key={i} style={{ height: `${Math.max(12, (b / max) * 100)}%` }} className={i === r.bars.length - 1 ? "last" : ""} />
                        ))}
                      </span>
                      <b>{r.win}</b>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
  );

  partFns.proof = (sid) => (
        <section className="pp-slide" id={sid} data-sid={sid} data-fit>
          <div className="pp-inner">
            <span className="eyebrow r">Proof</span>
            <h2 className="h2 r">The numbers that matter <span className="grad-move">to your team</span></h2>
            <div className="sp-proof stagger">
              <div><div className="v"><Counter to={50} suffix="%" /></div><div className="l">Lorem ipsum dolor sit amet</div></div>
              <div><div className="v"><Counter to={40} suffix="%" /></div><div className="l">Consectetur adipiscing elit</div></div>
              <div><div className="v">X-Y%</div><div className="l">Sed do eiusmod tempor</div></div>
              <div><div className="v"><Counter to={6} /> mo</div><div className="l">Incididunt ut labore et dolore</div></div>
            </div>
            <div className="res-row stagger">
              <div className="res-quote">
                <blockquote>&ldquo;Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.&rdquo;</blockquote>
                <cite>Sample Customer, Example Hotels</cite>
              </div>
              <div className="res-side">
                <div className="res-mini"><div className="v">$XK+</div><div className="l">Lorem ipsum dolor sit</div></div>
                <div className="res-mini"><div className="v">N FTE</div><div className="l">Amet consectetur adipiscing</div></div>
              </div>
            </div>
          </div>
        </section>
  );

  partFns.golive = (sid) => (
        <section className="pp-slide" id={sid} data-sid={sid} data-fit>
          <div className="pp-inner">
            <span className="eyebrow r">Go live</span>
            <h2 className="h2 r">Live in <span className="grad-move">weeks</span>, with our team doing the lifting</h2>
            <p className="lead r" style={{ maxWidth: "88ch" }}>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam.</p>
            <div className="sp-steps stagger">
              {GOLIVE.map(([k, t, d]) => (
                <div className="sp-step" key={k}><div className="k">{k}</div><h3>{t}</h3><p>{d}</p></div>
              ))}
            </div>
            <div className="sp-chips r" style={{ justifyContent: "flex-start" }}>
              <span className="sp-chip">Sample chip one</span>
              <span className="sp-chip">Sample chip two</span>
              <span className="sp-chip">Sample chip three</span>
            </div>
          </div>
        </section>
  );

  parts.close = <ClosingCTA creator={creator} />;

  return (
    <CurrencyProvider base="USD">
    <DeckShell sections={sections} edit={editNav} modGradLogo>
      <div className="v2-topctl">
        {/* figures are written in USD; the control (or the viewer bar around the deck) converts them live */}
        <CurrencyControl />
        <DeckExports slug={exportSlug} /><button className="v2-ctl" aria-label="Toggle full screen" onClick={() => {
          const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
          const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
          if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen)?.call(document); }
          else { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); }
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
          <span>Full screen</span>
        </button>
        <a className="v2-back" target="_top" href={`https://${process.env.NEXT_PUBLIC_APP_DOMAIN ?? "app.example.com"}/presentations`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Presentations
        </a>
      </div>

      <style>{`
        .v2-topctl{position:fixed;top:16px;right:22px;z-index:9999;display:flex;align-items:center;gap:8px}
        .v2-back,.v2-ctl{display:inline-flex;align-items:center;gap:7px;padding:9px 15px 9px 12px;border-radius:999px;background:rgba(255,255,255,.92);border:1px solid var(--border);color:var(--ink);font-family:var(--mono);font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;font-weight:600;text-decoration:none;cursor:pointer;box-shadow:var(--shadow-sm);backdrop-filter:blur(8px);white-space:nowrap}
        .v2-back svg,.v2-ctl svg{width:13px;height:13px}
        .pp-slide.msl-dk,.pp-slide.pp-grad{background:transparent}
        .pp-slide.msl-dk,.pp-slide.msl-dk h2,.pp-slide.msl-dk h3{color:#fff}
        .pp-slide.msl-dk .eyebrow{color:#a78dff}
        .pp-slide.msl-dk p{color:rgba(255,255,255,.72)}

        /* cover */
        #cover .title{font-size:clamp(2.2rem,4.2vw,4.3rem);line-height:1.02}
        #cover .lead{font-size:clamp(.95rem,1.35vw,1.5rem);margin-top:.7rem;line-height:1.4}
        #cover .eyebrow{margin-bottom:.55rem;font-size:clamp(.68rem,.9vw,.95rem)}
        .sp-chips{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:clamp(.6rem,1.2vh,1rem);justify-content:center}
        .sp-chip{font-family:var(--mono);font-size:clamp(.66rem,.92vw,1rem);font-weight:700;color:var(--purple);background:#f5f3ff;border-radius:999px;padding:.6rem 1.2rem;white-space:nowrap}

        /* cost slide: colourful animated graphics under each number */
        .cv{margin-top:.7rem}
        .cv-legend{display:flex;justify-content:space-between;margin-top:.4rem;
          font-family:var(--mono);font-size:clamp(.5rem,.62vw,.66rem);letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.45)}
        .cv-legend .hot{color:#ff6b8a}
        .cv-track{position:relative;height:9px;border-radius:5px;background:rgba(255,255,255,.12);overflow:visible}
        .cv-fill{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#3dc9f4,#8b5cf6,#ff6b8a)}
        .cv-tick{position:absolute;top:-3px;width:1px;height:15px;background:rgba(255,255,255,.22)}
        .cv-flag{position:absolute;right:-4px;top:-5px;width:19px;height:19px;border-radius:50%;background:#ff6b8a;box-shadow:0 0 0 5px rgba(255,107,138,.22)}
        .cv-leak{display:flex;align-items:center;gap:.8rem}
        .cv-leak svg{width:clamp(52px,5vw,68px);height:auto;flex:0 0 auto}
        .cv-ring-bg{fill:none;stroke:rgba(255,255,255,.13);stroke-width:7}
        .cv-ring-hot{fill:none;stroke:#ff6b8a;stroke-width:7;stroke-linecap:round}
        .cv-leak-l{display:flex;flex-direction:column}
        .cv-leak-l b{font-family:var(--disp);font-weight:400;font-size:clamp(1.1rem,1.6vw,1.6rem);color:#ff6b8a;line-height:1}
        .cv-leak-l span{font-size:clamp(.66rem,.8vw,.86rem);color:rgba(255,255,255,.55);margin-top:.2rem}
        .cv-stack{display:flex;height:13px;border-radius:7px;overflow:hidden;background:rgba(255,255,255,.1)}
        .cv-stack.tall{height:19px}
        .cv-seg{display:block;height:100%}
        .cv-a{background:#8b5cf6}.cv-b{background:#8b5cf6}.cv-c{background:#3b82f6}.cv-d{background:#3dc9f4}
        .cv-keys{display:flex;flex-wrap:wrap;gap:.45rem .9rem;margin-top:.5rem}
        .cv-keys span{display:inline-flex;align-items:center;gap:.35rem;font-size:clamp(.6rem,.74vw,.78rem);color:rgba(255,255,255,.6);white-space:nowrap}
        .cv-keys i{width:8px;height:8px;border-radius:2px;display:inline-block}
        .cv-margin{position:relative}
        .cv-margin svg{width:100%;height:clamp(34px,4.6vh,50px);display:block}
        .cv-q{position:absolute;right:2%;top:14%;font-family:var(--disp);font-size:clamp(1rem,1.5vw,1.5rem);color:#ff6b8a}
        .cv-break{margin-top:.6rem}
        .sp-addup{display:flex;flex-direction:column;gap:.2rem}

        /* cost */
        .sp-cost{display:grid;grid-template-columns:1fr 1.6fr;gap:clamp(.8rem,1.6vw,1.5rem);margin-top:clamp(1rem,2vh,1.6rem)}
        .sp-cost-hero{background:linear-gradient(150deg,#8b5cf6,#8b5cf6 55%,#3b82f6);border-radius:22px;padding:clamp(1.1rem,1.9vw,1.9rem);display:flex;flex-direction:column}
        .sp-cost-hero .l{font-family:var(--mono);font-size:clamp(.56rem,.7vw,.74rem);letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.8)}
        .sp-cost-hero .v{font-family:var(--disp);font-weight:400;font-size:clamp(3rem,5.4vw,5.4rem);line-height:1;color:#fff;margin-top:.3rem}
        .sp-cost-hero h3{color:#fff;font-size:clamp(1rem,1.3vw,1.35rem);margin-top:.5rem}
        .sp-cost-hero p{color:rgba(255,255,255,.85);font-size:clamp(.78rem,.94vw,1rem);line-height:1.4;margin-top:.4rem}
        .sp-cost-hero .split{margin-top:auto;padding-top:clamp(.8rem,1.6vh,1.3rem);border-top:1px solid rgba(255,255,255,.28)}
        .sp-cost-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(.8rem,1.6vw,1.5rem)}
        .sp-cost-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);border-radius:20px;padding:clamp(.9rem,1.6vw,1.5rem)}
        .sp-cost-card .n{font-family:var(--disp);font-weight:400;font-size:clamp(1.7rem,2.9vw,2.9rem);line-height:1;
          background:linear-gradient(90deg,#c9a9ff,#7fa5ff);-webkit-background-clip:text;background-clip:text;color:transparent}
        .sp-cost-card h3{font-size:clamp(.92rem,1.15vw,1.2rem);margin-top:.45rem;color:#fff}
        .sp-cost-card p{font-size:clamp(.74rem,.9vw,.96rem);color:rgba(255,255,255,.6);line-height:1.35;margin-top:.3rem}
        .sp-addup{grid-column:span 2;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);border-radius:18px;padding:clamp(.8rem,1.3vw,1.2rem);
          font-size:clamp(.8rem,.98vw,1.05rem);color:rgba(255,255,255,.82)}
        .sp-addup b{color:#fff}

        /* modules: on the brand gradient, white heading, white cards (id^= so a Saved copy, modules~k3f9, matches too) */
        [id^="modules"] .h2{color:#fff}
        [id^="modules"] .eyebrow{color:rgba(255,255,255,.92)}
        [id^="modules"] .h2 .grad-move{color:#fff;-webkit-text-fill-color:#fff;background:none;animation:none}
        .sp-covers{margin-top:clamp(.9rem,1.8vh,1.5rem);background:#fff;border-radius:20px;padding:clamp(1rem,1.7vw,1.6rem);color:var(--ink);box-shadow:0 20px 44px -20px rgba(23,18,54,.5)}
        .sp-covers h3{color:var(--ink);font-size:clamp(1.05rem,1.4vw,1.45rem)}
        .sp-covers p{color:var(--body);font-size:clamp(.8rem,.98vw,1.05rem);margin-top:.4rem}

        /* seven modules: 3D gradient cards */
        .gc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(.7rem,1.3vw,1.2rem);margin-top:clamp(1rem,2vh,1.7rem);perspective:1200px}
        .gc{--rx:0deg;--ry:0deg;--mx:50%;--my:50%;transform-style:preserve-3d}
        .gc-face{position:relative;overflow:hidden;border-radius:20px;padding:clamp(.9rem,1.5vw,1.4rem);background:#fff;
          transform:rotateX(var(--rx)) rotateY(var(--ry));transform-style:preserve-3d;transition:transform .25s var(--ease),box-shadow .25s var(--ease);box-shadow:0 20px 44px -20px rgba(23,18,54,.5)}
        .gc:hover .gc-face{box-shadow:0 30px 60px -22px rgba(23,18,54,.6)}
        .gc-sheen{position:absolute;inset:0;pointer-events:none;background:radial-gradient(220px 180px at var(--mx) var(--my),color-mix(in srgb,var(--from) 16%,transparent),transparent 68%)}
        .gc-n{position:relative;font-family:var(--mono);font-size:clamp(.56rem,.7vw,.74rem);letter-spacing:.16em;color:var(--from);font-weight:700}
        .gc-face h3{position:relative;color:var(--ink);font-size:clamp(1rem,1.25vw,1.3rem);margin-top:.3rem}
        .gc-stat{position:relative;font-family:var(--disp);font-weight:400;font-size:clamp(1.5rem,2.4vw,2.4rem);line-height:1;margin-top:.6rem;
          background:linear-gradient(120deg,var(--from),var(--to));-webkit-background-clip:text;background-clip:text;color:transparent}
        .gc-face p{position:relative;font-size:clamp(.7rem,.86vw,.92rem);color:var(--body)!important;margin-top:.25rem;line-height:1.3}

        /* order to payment: draggable workflow board */
        .wb{position:relative;width:100%;height:min(46vh,440px);margin-top:clamp(1rem,2vh,1.7rem);border:1px solid rgba(255,255,255,.12);border-radius:22px;background:
            radial-gradient(circle at 1px 1px,rgba(255,255,255,.10) 1px,transparent 0) 0 0/26px 26px,rgba(255,255,255,.02);overflow:hidden;touch-action:none;user-select:none}
        .wb-edges{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
        .wb-edge{fill:none;stroke:url(#wbE);stroke-width:2;opacity:.7}
        .wb-pulse{fill:#fff;filter:drop-shadow(0 0 6px rgba(139,92,246,.9))}
        .wb-node{position:absolute;width:21%;min-width:150px;cursor:grab;background:rgba(18,16,38,.94);border:1px solid rgba(255,255,255,.16);border-radius:16px;
          padding:clamp(.6rem,1vw,.9rem);box-shadow:0 14px 30px -14px rgba(0,0,0,.8);backdrop-filter:blur(6px)}
        .wb-node.dragging{cursor:grabbing;border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.28),0 18px 40px -14px rgba(0,0,0,.9);z-index:5}
        .wb-ic{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:linear-gradient(140deg,#8b5cf6,#3b82f6);color:#fff}
        .wb-k{display:block;font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;color:#a78dff;margin-top:.5rem}
        .wb-node b{display:block;font-family:var(--disp);font-weight:344;color:#fff;font-size:clamp(.92rem,1.15vw,1.2rem);margin-top:.1rem}
        .wb-node p{font-size:clamp(.66rem,.8vw,.86rem);color:rgba(255,255,255,.6)!important;line-height:1.3;margin-top:.25rem}
        .wb-tag{position:absolute;top:-10px;right:10px;font-family:var(--mono);font-size:.55rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f1424;background:#3dc9f4;border-radius:999px;padding:.24rem .55rem;white-space:nowrap}
        .wb-port{position:absolute;top:50%;width:9px;height:9px;margin-top:-4.5px;border-radius:50%;background:#12102a;border:2px solid rgba(255,255,255,.5)}
        .wb-port.in{left:-5px}
        .wb-port.out{right:-5px}
        .wb-hint{position:absolute;left:14px;bottom:10px;font-family:var(--mono);font-size:.6rem;letter-spacing:.08em;color:rgba(255,255,255,.32)}

        /* compare */
        .sp-cmp{margin-top:clamp(1rem,2vh,1.6rem);border:1px solid var(--border);border-radius:22px;overflow:hidden;background:#fff;box-shadow:var(--shadow-sm)}
        .sp-cmp-row{display:grid;grid-template-columns:1.05fr 1.2fr 1.2fr .5fr;align-items:center;gap:clamp(.6rem,1.4vw,1.6rem);
          padding:clamp(.5rem,.9vh,.9rem) clamp(.9rem,1.6vw,1.7rem);border-top:1px solid var(--border);font-size:clamp(.8rem,.98vw,1.04rem)}
        .sp-cmp-row:first-child{border-top:0;background:var(--grad-soft);font-family:var(--mono);font-size:clamp(.6rem,.74vw,.78rem);letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--ink)}
        .sp-cmp-row .k{color:var(--ink);font-weight:600;display:flex;align-items:center;gap:.55rem}
        .sp-cmp-row .old{color:var(--muted)}
        .sp-cmp-row .new{color:var(--ink)}
        .sp-cmp-ic{flex:0 0 auto;width:26px;height:26px;border-radius:8px;background:var(--grad-soft);color:var(--purple);display:flex;align-items:center;justify-content:center}
        .sp-cmp-g{display:flex;align-items:center;gap:.6rem;justify-content:flex-end}
        .sp-cmp-bars{display:flex;align-items:flex-end;gap:2.5px;height:26px}
        .sp-cmp-bars i{width:6px;border-radius:2px 2px 0 0;background:#e2ddf6;display:block}
        .sp-cmp-bars i.last{background:var(--grad)}
        .sp-cmp-g b{font-family:var(--mono);font-size:clamp(.56rem,.7vw,.74rem);font-weight:700;color:var(--purple);white-space:nowrap}

        /* proof */
        .sp-proof{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(.7rem,1.3vw,1.2rem);margin-top:clamp(1rem,2vh,1.6rem)}
        .sp-proof>div{background:var(--grad-deep);border-radius:20px;padding:clamp(1rem,1.7vw,1.7rem);box-shadow:var(--shadow)}
        .sp-proof .v{font-family:var(--disp);font-weight:400;font-size:clamp(1.9rem,3.1vw,3.1rem);line-height:1;color:#fff}
        .sp-proof .l{font-size:clamp(.78rem,.94vw,1rem);color:rgba(255,255,255,.85);margin-top:.4rem;line-height:1.3}

        /* go live */
        .sp-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(.7rem,1.3vw,1.3rem);margin-top:clamp(1rem,2vh,1.7rem)}
        .sp-step{background:#fff;border:1px solid var(--border);border-radius:20px;padding:clamp(1rem,1.6vw,1.6rem);box-shadow:var(--shadow-sm)}
        .sp-step .k{font-family:var(--mono);font-weight:700;letter-spacing:.08em;color:var(--purple);font-size:clamp(.68rem,.84vw,.9rem)}
        .sp-step h3{font-size:clamp(1rem,1.25vw,1.3rem);margin-top:.4rem}
        .sp-step p{font-size:clamp(.78rem,.94vw,1rem);color:var(--body);line-height:1.36;margin-top:.35rem}

        /* co-branded cover */
        .gw-lockup{display:flex;align-items:center;gap:clamp(1.1rem,2.2vw,2rem);margin-bottom:clamp(1rem,2.4vh,1.8rem)}
        .gw-lockup-logo{height:clamp(108px,11vw,152px);width:auto;object-fit:contain;display:block}
        .gw-lockup-div{width:1px;height:clamp(84px,8.6vw,116px);background:rgba(23,18,54,.16);flex:0 0 auto}
        .gw-chips-line{flex-wrap:wrap;justify-content:flex-start}
        .gw-byline{display:flex;flex-direction:column;gap:.12rem}
        /* COVER SPACING RULE: the slide's normal inset, content spread down the full height: logos top,
           title + paragraph + chips in the middle (chips left-aligned under the paragraph), prepared-by +
           date at the bottom. Never let the cover condense into the centre. */
        .gw-cover-stack{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;text-align:left;min-height:min(80vh,820px);gap:clamp(1rem,3vh,2.2rem)}
        .gw-cover-stack .title{font-size:clamp(2.2rem,4.4vw,4rem)}
        .gw-cover-mid{display:flex;flex-direction:column;align-items:flex-start;gap:clamp(.45rem,1.2vh,.85rem);width:100%}
        .gw-cover-mid .gw-chips-line{margin-top:clamp(.7rem,1.8vh,1.3rem)}
        .gw-lockup-duo{flex-wrap:nowrap;gap:clamp(1rem,2.2vw,1.9rem);align-items:center}
        .gw-lockup-duo .gw-lk-pp{height:clamp(38px,4.2vw,56px)}
        .gw-lockup-duo .gw-lk-client{height:clamp(58px,6.4vw,88px);max-width:clamp(180px,22vw,340px)}
        .gw-lockup-duo .gw-lockup-div{height:clamp(46px,5vw,66px)}
        .gw-by-name{font-weight:600;color:var(--ink);font-size:clamp(.85rem,1vw,1.02rem)}
        .gw-by-date{color:var(--muted,#8a8ba3);font-size:clamp(.76rem,.9vw,.92rem)}
        /* split cover with the prospect's own photo on the right */
        .gw-cover2{display:grid;grid-template-columns:1.12fr .88fr;gap:clamp(1.6rem,3.6vw,3.6rem);align-items:center}
        .gw-cover2-l{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;text-align:left;min-height:min(78vh,800px);gap:clamp(1rem,3vh,2.2rem)}
        .gw-cover2-l .title{font-size:clamp(2rem,3.9vw,3.5rem)}
        .gw-cover2-r{display:flex;align-items:center;justify-content:center}
        .gw-hero{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:24px;box-shadow:0 34px 76px -32px rgba(23,18,54,.52)}

        /* native intro slides */
        .gw-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(.8rem,1.5vw,1.3rem);margin-top:clamp(1rem,2vh,1.6rem)}
        .gw-card{background:#fff;border:1px solid #ece9f7;border-radius:20px;padding:clamp(1rem,1.7vw,1.5rem);box-shadow:0 18px 40px -26px rgba(23,18,54,.4)}
        .gw-card h3{font-size:clamp(1rem,1.3vw,1.3rem);color:var(--ink);margin:0 0 .6rem}
        .gw-card ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
        .gw-card li{position:relative;padding-left:1.1rem;font-size:clamp(.78rem,.95vw,1rem);line-height:1.38;color:var(--body)}
        .gw-card li::before{content:"";position:absolute;left:0;top:.52em;width:7px;height:7px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#3b82f6)}
        .gw-card p{font-size:clamp(.82rem,1vw,1.05rem);line-height:1.46;color:var(--body);margin:0}
        .gw-fnb{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(.8rem,1.5vw,1.3rem);margin-top:clamp(1rem,2vh,1.6rem)}
        .gw-fnb.n2{grid-template-columns:repeat(2,1fr)}
        .gw-fnb.n4{grid-template-columns:repeat(4,1fr)}
        .gw-rows{display:grid;grid-template-columns:1fr 1fr;gap:clamp(.8rem,1.5vw,1.3rem);margin-top:clamp(.8rem,1.6vh,1.3rem)}
        .gw-rows.n1{grid-template-columns:1fr}
        .gw-row{background:#f6f4fd;border-radius:18px;padding:clamp(.95rem,1.6vw,1.45rem)}
        .gw-row-k{font-family:var(--mono);font-size:clamp(.58rem,.72vw,.74rem);letter-spacing:.12em;text-transform:uppercase;color:var(--accent,#8b5cf6)}
        .gw-row-items{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(.6rem,1.1vw,1rem);margin-top:.6rem}
        .gw-row-items>div{font-size:clamp(.72rem,.9vw,.94rem);line-height:1.36;color:var(--body)}
        .gw-row-items b{display:block;color:var(--ink);font-weight:600;margin-bottom:.1rem}
        .en-pk{font-family:var(--mono);font-size:clamp(.56rem,.72vw,.74rem);letter-spacing:.12em;text-transform:uppercase;color:var(--accent,#8b5cf6);display:block;margin-bottom:.28rem}
        .en-terms{display:grid;grid-template-columns:1fr 1fr;gap:clamp(.9rem,1.8vw,1.6rem);margin-top:clamp(1rem,2vh,1.6rem)}
        .en-terms.n3{grid-template-columns:repeat(3,1fr)}
        .en-tcard{display:flex;flex-direction:column}
        .en-big{font-family:var(--disp);font-weight:400;font-size:clamp(2.6rem,5vw,4.4rem);line-height:1;background:linear-gradient(135deg,#8b5cf6,var(--accent,#8b5cf6),#3b82f6);-webkit-background-clip:text;background-clip:text;color:transparent;margin:.3rem 0 .1rem}
        .en-tcard h3{margin:.1rem 0 .4rem}
        .en-tcard ul{margin:.6rem 0 0}
        .gw-cmp{width:100%;border-collapse:separate;border-spacing:0;margin-top:clamp(1rem,2vh,1.5rem);font-size:clamp(.74rem,.92vw,.98rem)}
        .gw-cmp th,.gw-cmp td{padding:clamp(.5rem,.9vw,.8rem) clamp(.5rem,.8vw,.75rem);text-align:center;border-bottom:1px solid #eee8fa}
        .gw-cmp th{font-size:clamp(.6rem,.74vw,.78rem);letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#8a8ba3);font-weight:600;border-bottom:2px solid #e3ddf5}
        .gw-cmp thead th:first-child,.gw-cmp td:first-child{text-align:left;color:var(--ink);font-weight:500}
        .gw-cmp th.pp,.gw-cmp td.pp{background:#eff6ff}
        .gw-cmp th.pp{color:#1d4ed8}
        .gw-cmp tbody tr:last-child td{border-bottom:none}
        /* our check = brand primary; competitor check = muted grey; a gap = accent X */
        .gw-tick{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;font-size:.82rem;font-weight:700}
        .gw-tick-pp{background:#3b82f6;color:#fff}
        .gw-tick-comp{background:#edeef2;color:#a7adbd}
        .gw-x{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;background:#f5f3ff;color:#8b5cf6;font-size:.8rem;font-weight:700}
        .gw-note{font-size:clamp(.7rem,.84vw,.88rem);color:var(--muted,#8a8ba3);margin-top:clamp(.7rem,1.4vh,1.1rem);line-height:1.4}
        /* tinted cards: light brand tints only, never strong fills */
        .gw-c-teal{background:#eff6ff}
        .gw-c-teal h3{color:#1d4ed8}
        .gw-c-violet{background:#f4ecfc}
        .gw-c-violet h3{color:#7a1fb8}
        .gw-c-blue{background:#eef2ff}
        .gw-c-blue h3{color:#3357d6}
        /* legacy image intro slides */
        .gw-imgslide{position:relative;z-index:2;max-width:100%;max-height:94%;object-fit:contain;display:block;border-radius:16px;box-shadow:0 28px 64px -34px rgba(23,18,54,.45)}
        /* never leave a one-word last line on any slide */
        #cover .lead,.gw-card li,.gw-card p,.gw-row-items>div,.gw-note,.gw-cmp td:first-child{text-wrap:pretty}
        .gw-card h3,#cover .title,#cover .lead{text-wrap:balance}

        /* editor: a slide the rep hid stays on the canvas, dimmed and badged */
        .pp-hidden-slide{position:relative}
        .pp-hidden-slide>*{opacity:.3!important;filter:grayscale(.85)}
        .pp-hidden-slide::after{content:"Hidden from the presentation";position:absolute;top:22px;left:50%;transform:translateX(-50%);z-index:5;
          font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#fff;background:#8b5cf6;border-radius:999px;padding:.55rem 1.1rem;box-shadow:0 10px 24px rgba(139,92,246,.35);white-space:nowrap}

        @media(max-width:1180px){
          .sp-cost{grid-template-columns:1fr}
          .sp-proof,.sp-steps{grid-template-columns:repeat(2,1fr)}
          .gc-grid{grid-template-columns:repeat(2,1fr)}
          .gw-cover2{grid-template-columns:1fr}.gw-cover2-r{display:none}
        }
      `}</style>


      {items.map((it) => <Fragment key={it.id}>{it.slide ? renderIntro(it.slide) : it.lib ? <LibrarySlide sid={it.id} /> : partFns[baseOf(it.id)] ? partFns[baseOf(it.id)](it.id) : parts[it.id]}</Fragment>)}
      {/* the master decks' own stylesheets, scoped to the slides lifted from them, plus the
          Introduction decks' mount-time runtime (it scales the embedded product screens) */}
      <LibraryStyles decks={libDecks} />
      <LibraryRuntime decks={libDecks} />
    </DeckShell>
    </CurrencyProvider>
  );
}
