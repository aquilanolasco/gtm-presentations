"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

// The template library: every slide template the generator can use, grouped by purpose. Thumbnails
// are real renders (placeholder text) hosted at /p/_templates/<id>.png. "See slides" opens a
// chrome-free viewer you arrow through — purely to visualise what's locked in.
export type Tmpl = { id: string; name: string; use: string; img?: string };
// a Saved slide: a master slide a rep edited in a sales deck and kept (/api/presentations/saved-slides)
type SavedSlide = { id: string; name: string; base: string; label: string; deckTitle: string; from: { title: string; slug: string }; ownerName: string; mine: boolean; thumb: string | null; createdAt: string; editCount: number };
export type Cat = { key: string; name: string; desc: string; items: Tmpl[] };
export type SlideViewer = { cat: Cat; i: number } | null;

export const CATS: Cat[] = [
  { key: "covers", name: "Covers", desc: "The opening slide. The device cover (master-deck style) is the default.", items: [
    { id: "cover-device", name: "Device cover", use: "Default. Headline + date, live app UI in a device frame (master-deck style)." },
    { id: "cover-master", name: "Master cover", use: "The intro-deck cover with the 3D emblem." },
    { id: "cover-gradient", name: "Gradient cover", use: "Full brand-gradient hero, white title." },
    { id: "cover-light", name: "Light cover", use: "White background, the last word in brand gradient." },
    { id: "cover-dark", name: "Dark cover", use: "Deep ink background with a gradient glow." },
  ] },
  { key: "townhall", name: "Town Hall", desc: "The recurring town-hall slides, reused from the master each month.", items: [
    { id: "townhall-mission", name: "Mission", use: "A dominant statement in a hero card plus supporting icon cards." },
    { id: "townhall-vision", name: "Vision", use: "Brand target in the centre, icon points flanking." },
    { id: "townhall-celebration", name: "Celebration", use: "A promotion, award or new starter: big photo, name, message." },
    { id: "townhall-awards", name: "Peak Performance", use: "A celebratory grid of shout-outs and nominations." },
  ] },
  { key: "team", name: "Team & People", desc: "Introduce the people.", items: [
    { id: "team-teamgrid", name: "Team grid", use: "A department or product team: name, role and photo per person." },
    { id: "team-people", name: "Leadership", use: "A small leadership group in cards, with photos." },
  ] },
  { key: "data", name: "Data & metrics", desc: "Lead with numbers and results.", items: [
    { id: "data-kpi", name: "KPI band", use: "2 to 4 headline numbers or results." },
    { id: "data-bento", name: "Bento", use: "One big point plus supporting stat cards." },
    { id: "data-timeline", name: "Timeline", use: "A journey or milestones along a line." },
    { id: "data-map", name: "Map", use: "Counts by world region on a brand map with flags." },
  ] },
  { key: "content", name: "Content & layout", desc: "Structure and explain the story.", items: [
    { id: "content-section", name: "Section divider", use: "A topic transition, one big line." },
    { id: "content-agenda", name: "Agenda", use: "What's ahead, a numbered list." },
    { id: "content-bullets", name: "Bullets", use: "A short, scannable list of points." },
    { id: "content-features", name: "Feature cards", use: "2 to 4 capabilities or offerings." },
    { id: "content-steps", name: "Steps", use: "A process or how-it-works flow." },
    { id: "content-split", name: "Split", use: "A claim with points and a highlighted aside." },
    { id: "content-columns", name: "Columns", use: "Two or three comparison lists side by side." },
    { id: "content-table", name: "Table", use: "A data table for pricing, specs or tiers." },
    { id: "content-chips", name: "Chips", use: "A set of short labels or tags." },
    { id: "product-showcase", name: "App screenshot", use: "A live product screen in a device panel." },
    { id: "media-video", name: "Video", use: "An embedded Vimeo or YouTube video." },
  ] },
  { key: "proof", name: "Proof", desc: "Build trust with evidence.", items: [
    { id: "proof-proof", name: "Proof", use: "A testimonial paired with a result." },
    { id: "proof-quote", name: "Quote", use: "A single strong statement." },
  ] },
  { key: "closing", name: "Closing", desc: "End with a clear next step.", items: [
    { id: "closing-cta", name: "Call to action", use: "The closing slide." },
  ] },
];

const thumb = (t: Tmpl) => t.img || `/p/_templates/${t.id}.png`;

export default function SlidesTab({ viewer: viewerProp, setViewer: setViewerProp }: { viewer?: SlideViewer; setViewer?: Dispatch<SetStateAction<SlideViewer>> } = {}) {
  const [viewerInt, setViewerInt] = useState<SlideViewer>(null);
  const controlled = !!setViewerProp;
  const viewer = controlled ? (viewerProp ?? null) : viewerInt;
  const setViewer = controlled ? setViewerProp! : setViewerInt;
  // Saved slides: yours (the super admin sees everyone's), newest first
  const [saved, setSaved] = useState<SavedSlide[]>([]);
  const [savedNote, setSavedNote] = useState("");
  const loadSaved = useCallback(() => {
    fetch("/api/presentations/saved-slides", { headers: ((): Record<string, string> => { try { const v = localStorage.getItem("pp_impersonate"); return v ? { "x-pp-view-as": v } : {}; } catch { return {}; } })() }).then((r) => (r.ok ? r.json() : null)).then((j: { saved: SavedSlide[] } | null) => { if (j?.saved) setSaved(j.saved); }).catch(() => {});
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);
  const removeSaved = async (s: SavedSlide) => {
    if (!confirm(`Delete the saved slide "${s.name}"? Decks already built with it keep it.`)) return;
    const r = await fetch("/api/presentations/saved-slides", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id }) });
    if (r.ok) { setSaved((cur) => cur.filter((x) => x.id !== s.id)); setSavedNote(`Deleted "${s.name}".`); }
    else setSavedNote(r.status === 403 ? "Only the person who saved a slide (or the super admin) can delete it." : `Could not delete (${r.status}).`);
    setTimeout(() => setSavedNote(""), 4000);
  };
  const savedCat: Cat = { key: "saved", name: "Saved slides", desc: "Master slides your team edited in a sales deck and kept. Pick them again when you create a sales deck.",
    items: saved.map((s) => ({ id: s.id, name: s.name, use: `${s.label}, saved from ${s.from?.title || "a sales deck"} by ${s.ownerName}${s.editCount ? `, ${s.editCount} change${s.editCount === 1 ? "" : "s"}` : ""}.`, img: s.thumb || `/p/_library/${s.base}.webp` })) };

  const move = useCallback((d: number) => {
    setViewer((v) => v ? { ...v, i: (v.i + d + v.cat.items.length) % v.cat.items.length } : v);
  }, []);
  useEffect(() => {
    if (!viewer) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "Escape") setViewer(null);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [viewer, move]);

  const cur = viewer ? viewer.cat.items[viewer.i] : null;

  return (
    <div className="st">
      <div className="st-intro">
        <h2>Slide templates</h2>
        <p>Every deck is built from these. This is the master-template library, what each slide is for. Open a set to browse it.</p>
      </div>

      <div className="st-cats">
        <div className="st-cat st-saved" key="saved">
          <div className="st-cat-head">
            <div>
              <div className="st-cat-name">Saved slides</div>
              <div className="st-cat-desc">{savedCat.desc} To save one: open a sales deck&apos;s editor and press the bookmark next to a master slide&apos;s name.</div>
            </div>
            {saved.length > 0 && <button className="st-see" onClick={() => setViewer({ cat: savedCat, i: 0 })}>See slides</button>}
          </div>
          {saved.length ? (
            <div className="st-strip">
              {saved.map((s, i) => (
                <div className="st-thumb-wrap" key={s.id}>
                  <button className="st-thumb" onClick={() => setViewer({ cat: savedCat, i })} title={savedCat.items[i].use}>
                    <img src={`${s.thumb || `/p/_library/${s.base}.webp`}?v=${Date.now().toString(36).slice(0, 5)}`} alt={s.name} loading="lazy" />
                    <span className="st-thumb-name">{s.name}{!s.mine && <small> · {s.ownerName}</small>}</span>
                  </button>
                  <button className="st-del" title="Delete this saved slide" aria-label={`Delete ${s.name}`} onClick={() => removeSaved(s)}>&times;</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="st-empty">No saved slides yet.</div>
          )}
          {savedNote && <div className="st-note">{savedNote}</div>}
        </div>
        {CATS.map((c) => (
          <div className="st-cat" key={c.key}>
            <div className="st-cat-head">
              <div>
                <div className="st-cat-name">{c.name}</div>
                <div className="st-cat-desc">{c.desc}</div>
              </div>
              <button className="st-see" onClick={() => setViewer({ cat: c, i: 0 })}>See slides</button>
            </div>
            <div className="st-strip">
              {c.items.map((t, i) => (
                <button className="st-thumb" key={t.id} onClick={() => setViewer({ cat: c, i })} title={t.name}>
                  <img src={thumb(t)} alt={t.name} loading="lazy" />
                  <span className="st-thumb-name">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {viewer && cur && (
        <div className="st-viewer" onClick={() => setViewer(null)}>
          <button className="st-close" onClick={() => setViewer(null)} aria-label="Close">&times;</button>
          <button className="st-nav st-prev" onClick={(e) => { e.stopPropagation(); move(-1); }} aria-label="Previous">&#8249;</button>
          <div className="st-stage" onClick={(e) => e.stopPropagation()}>
            <img src={thumb(cur)} alt={cur.name} />
            <div className="st-caption">
              <div className="st-cap-name">{cur.name}</div>
              <div className="st-cap-use">{cur.use}</div>
              <div className="st-cap-count">{viewer.cat.name} · {viewer.i + 1} / {viewer.cat.items.length}</div>
            </div>
          </div>
          <button className="st-nav st-next" onClick={(e) => { e.stopPropagation(); move(1); }} aria-label="Next">&#8250;</button>
        </div>
      )}

      <style>{`
        .st{flex:1;overflow-y:auto;padding:1.6rem 1.1rem 2rem}
        .st-intro{padding:0 .4rem 1.2rem}
        .st-intro h2{margin:0 0 .3rem;font-size:1.2rem;color:var(--ink,#0f1424)}
        .st-intro p{margin:0;color:var(--muted,#6b6f80);font-size:.86rem;line-height:1.5}
        .st-cats{display:flex;flex-direction:column;gap:1.4rem}
        .st-cat-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.8rem;padding:0 .4rem .6rem}
        .st-cat-name{font-size:.95rem;font-weight:700;color:var(--ink,#0f1424)}
        .st-cat-desc{font-size:.8rem;color:var(--muted,#9aa0b0);margin-top:.15rem;max-width:34ch}
        .st-see{flex-shrink:0;border:1px solid #e3e0f0;background:#fff;color:#4338ca;font-weight:600;font-size:.8rem;padding:.45rem .9rem;border-radius:999px;cursor:pointer}
        .st-see:hover{border-color:#8b5cf6;background:#faf8ff}
        .st-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem}
        .st-thumb{position:relative;border:1px solid #ecebf5;border-radius:12px;overflow:hidden;background:#faf9ff;cursor:pointer;padding:0;aspect-ratio:16/10;transition:transform .15s,box-shadow .15s,border-color .15s}
        .st-thumb:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(99,102,241,.16);border-color:#e3e0f0}
        .st-thumb img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
        .st-thumb-name{position:absolute;left:0;right:0;bottom:0;font-size:.66rem;font-weight:600;color:#fff;background:linear-gradient(transparent,rgba(15,20,36,.6));padding:.6rem .5rem .35rem;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .st-thumb-name small{font-weight:500;opacity:.8}
        .st-saved{padding-bottom:.4rem;border-bottom:1px solid var(--border-soft,#ecebf5)}
        .st-thumb-wrap{position:relative}
        .st-thumb-wrap .st-thumb{width:100%}
        .st-del{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(15,20,36,.55);color:#fff;font-size:1rem;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s}
        .st-thumb-wrap:hover .st-del{opacity:1}
        .st-del:hover{background:#dc2626}
        .st-empty{padding:.9rem 1rem;border:1.5px dashed #e3e0f0;border-radius:12px;color:#9aa0b0;font-size:.82rem;margin:0 .4rem}
        .st-note{margin:.5rem .4rem 0;font-size:.8rem;color:#4338ca}
        .st-viewer{position:fixed;inset:0;z-index:1000;background:rgba(12,10,28,.92);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;gap:1rem;padding:2rem}
        .st-close{position:absolute;top:1.2rem;right:1.6rem;background:none;border:none;color:rgba(255,255,255,.8);font-size:2rem;line-height:1;cursor:pointer}
        .st-close:hover{color:#fff}
        .st-nav{flex-shrink:0;width:54px;height:54px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;font-size:1.8rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
        .st-nav:hover{background:rgba(255,255,255,.2)}
        .st-stage{max-width:min(1200px,86vw);width:100%;display:flex;flex-direction:column;align-items:center;gap:1rem}
        .st-stage img{width:100%;border-radius:14px;box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
        .st-caption{text-align:center;color:#fff}
        .st-cap-name{font-size:1.05rem;font-weight:700}
        .st-cap-use{font-size:.9rem;color:rgba(255,255,255,.75);margin-top:.2rem}
        .st-cap-count{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:rgba(255,255,255,.5);margin-top:.5rem;letter-spacing:.05em}
        @media(max-width:700px){.st-nav{width:42px;height:42px;font-size:1.4rem}}
      `}</style>
    </div>
  );
}
