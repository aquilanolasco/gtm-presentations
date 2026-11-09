"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Spinner } from "@/components/Spinner";

// Live slide builder / editor. Loads a deck's slide specs (public deck.json), lets you edit text, switch the
// slide template, regenerate a slide, or change it with an AI assistant prompt. Each action posts the edited deck
// (+ optional AI op) to /api/create/edit; the relay re-renders in place and we refresh the preview.
type Slide = Record<string, unknown> & { type: string; title?: string };
type Deck = { title?: string; slides: Slide[] };

const TYPES: [string, string][] = [
  ["cover", "Cover"], ["section", "Section divider"], ["agenda", "Agenda"], ["bullets", "Bullets"],
  ["kpi", "KPI band"], ["bento", "Bento stats"], ["steps", "Steps"], ["features", "Feature cards"],
  ["split", "Split"], ["proof", "Proof"], ["quote", "Quote"], ["chips", "Chips"], ["showcase", "App screenshot"],
  ["image", "Image"], ["people", "People"], ["video", "Video"], ["timeline", "Timeline"], ["map", "Map"],
  ["columns", "Columns"], ["table", "Table"], ["cta", "Call to action"],
];
const label = (s: Slide, i: number) =>
  (typeof s.title === "string" && s.title) ? s.title : s.type === "cover" ? "Cover" : s.type === "cta" ? "Closing" : `Slide ${i + 1}`;

export default function Builder({ id, slug, title, onClose }: { id: string; slug: string; title: string; onClose: () => void }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState("");
  const [cacheBust, setCacheBust] = useState(0);
  const pollUntilReady = useRef(false);

  const loadDeck = useCallback(async () => {
    try {
      const r = await fetch(`/p/${slug}/deck/deck.json?cb=${Date.now()}`, { cache: "no-store" });
      const d = (await r.json()) as Deck;
      if (d?.slides?.length) setDeck(d);
    } catch { /* deck not ready yet */ }
  }, [slug]);
  useEffect(() => { loadDeck(); }, [loadDeck]);

  // while a re-render is in flight, poll the row; when it lands "ready", reload the deck + bust the preview.
  const row = trpc.presentations.get.useQuery({ id }, {
    enabled: busy,
    refetchInterval: (q) => { const s = (q.state.data as { status?: string } | undefined)?.status; return s === "ready" || s === "failed" ? false : 1200; },
  });
  useEffect(() => {
    if (!busy) return;
    const s = (row.data as { status?: string; statusMsg?: string } | undefined)?.status;
    if (s === "ready") { setBusy(false); pollUntilReady.current = false; loadDeck(); setCacheBust((n) => n + 1); }
    else if (s === "failed") { setBusy(false); setErr((row.data as { statusMsg?: string })?.statusMsg || "That edit failed."); }
  }, [row.data, busy, loadDeck]);

  const apply = useCallback(async (nextDeck: Deck, op?: { slide: number; instruction: string }) => {
    setErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/create/edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, deck: nextDeck, op }),
      });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || `Edit failed (${r.status})`); }
    } catch (e) { setBusy(false); setErr(e instanceof Error ? e.message : String(e)); }
  }, [id]);

  if (!deck) return <div className="bld"><div className="bld-load"><Spinner /><span>Loading slides…</span></div><style>{css}</style></div>;

  const slide = deck.slides[sel] || deck.slides[0];
  const setField = (k: string, v: string) => {
    const d = structuredClone(deck); (d.slides[sel] as Record<string, unknown>)[k] = v; setDeck(d);
  };
  const strFields = ["title", "subtitle", "label", "heading", "text", "quote", "author", "caption"].filter((k) => typeof (slide as Record<string, unknown>)[k] === "string");
  const switchType = (t: string) => { const d = structuredClone(deck); (d.slides[sel] as Slide).type = t; setDeck(d); apply(d); };
  const regenerate = () => apply(deck, { slide: sel, instruction: "Regenerate this slide from scratch with fresh, tighter wording. Keep the same intent, facts, names and numbers." });
  const sendPrompt = () => { if (!prompt.trim()) return; apply(deck, { slide: sel, instruction: prompt.trim() }); setPrompt(""); };

  return (
    <div className="bld">
      <div className="bld-list">
        <div className="bld-list-h">Slides <span>{deck.slides.length}</span></div>
        <div className="bld-list-scroll">
          {deck.slides.map((s, i) => (
            <button key={i} className={`bld-item${i === sel ? " on" : ""}`} onClick={() => setSel(i)}>
              <span className="bld-item-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="bld-item-t">{label(s, i)}</span>
              <span className="bld-item-ty">{s.type}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bld-preview">
        <div className="bld-bar">
          <button className="bld-back" onClick={onClose}>&lsaquo; Done</button>
          <span className="bld-title">{deck.title || title}</span>
          {busy && <span className="bld-busy"><Spinner /> Rebuilding…</span>}
        </div>
        <iframe key={`${slug}-${cacheBust}`} src={`/p/${slug}/deck/?cb=${cacheBust}#s${sel}`} title={title} />
      </div>

      <div className="bld-panel">
        <div className="bld-sec-h">Slide {sel + 1}</div>

        <label className="bld-lbl">Template</label>
        <select className="bld-select" value={slide.type} onChange={(e) => switchType(e.target.value)} disabled={busy}>
          {TYPES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
        <p className="bld-hint">Swap this slide to any of the 200+ layouts. More appear here as the library fills.</p>

        {strFields.length > 0 && <>
          <div className="bld-sec-h" style={{ marginTop: 18 }}>Text</div>
          {strFields.map((k) => (
            <div key={k} className="bld-field">
              <label className="bld-lbl">{k}</label>
              {k === "text" || k === "quote"
                ? <textarea className="bld-input" rows={3} value={String((slide as Record<string, unknown>)[k] ?? "")} onChange={(e) => setField(k, e.target.value)} />
                : <input className="bld-input" value={String((slide as Record<string, unknown>)[k] ?? "")} onChange={(e) => setField(k, e.target.value)} />}
            </div>
          ))}
          <button className="bld-btn" onClick={() => apply(deck)} disabled={busy}>Apply text changes</button>
        </>}

        <div className="bld-sec-h" style={{ marginTop: 18 }}>AI assistant</div>
        <p className="bld-hint">Describe the change in plain language. It updates just this slide.</p>
        <textarea className="bld-input" rows={3} placeholder="e.g. make the bullets shorter, change the second stat to 40%, add a line about food cost" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="bld-row">
          <button className="bld-btn primary" onClick={sendPrompt} disabled={busy || !prompt.trim()}>Send to assistant</button>
          <button className="bld-btn ghost" onClick={regenerate} disabled={busy}>Regenerate</button>
        </div>

        {err && <div className="bld-err">{err}</div>}
      </div>
      <style>{css}</style>
    </div>
  );
}

const css = `
.bld{flex:1;display:flex;min-height:0;background:#f6f6fb}
.bld-load{flex:1;display:flex;align-items:center;justify-content:center;gap:10px;color:#6b7280}
.bld-list{width:216px;flex:0 0 auto;border-right:1px solid #e8e8ef;background:#fff;display:flex;flex-direction:column;min-height:0}
.bld-list-h{padding:14px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;border-bottom:1px solid #f0f0f5;display:flex;justify-content:space-between}
.bld-list-scroll{overflow-y:auto;min-height:0}
.bld-item{width:100%;display:flex;align-items:center;gap:8px;padding:9px 14px;border:0;background:0;cursor:pointer;text-align:left;border-bottom:1px solid #f6f6fb}
.bld-item:hover{background:#faf9ff}.bld-item.on{background:#efe9ff}
.bld-item-n{font-family:ui-monospace,monospace;font-size:11px;color:#a5a0c0}
.bld-item-t{flex:1;font-size:13px;color:#111827;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bld-item-ty{font-size:10px;color:#9ca3af;text-transform:uppercase}
.bld-preview{flex:1;min-width:0;display:flex;flex-direction:column;background:#fff}
.bld-bar{height:48px;flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:0 16px;border-bottom:1px solid #e8e8ef}
.bld-back{border:1px solid #e5e7eb;background:#fff;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;color:#111827}
.bld-title{font-size:14px;font-weight:600;color:#111827}
.bld-busy{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:#6366f1;font-weight:600}
.bld-preview iframe{flex:1;width:100%;border:0;min-height:0}
.bld-panel{width:320px;flex:0 0 auto;border-left:1px solid #e8e8ef;background:#fff;padding:18px;overflow-y:auto}
.bld-sec-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6366f1}
.bld-lbl{display:block;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;margin:12px 0 5px}
.bld-select,.bld-input{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 11px;font-size:14px;font-family:inherit;color:#111827;background:#fff}
.bld-input{resize:vertical}
.bld-hint{font-size:12px;color:#9ca3af;margin-top:6px;line-height:1.4}
.bld-field{margin-top:4px}
.bld-btn{margin-top:12px;width:100%;border:1px solid #e5e7eb;background:#fff;border-radius:10px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;color:#111827}
.bld-btn:disabled{opacity:.5;cursor:default}
.bld-btn.primary{background:linear-gradient(135deg,#8b5cf6,#6366f1,#3b82f6);color:#fff;border:0}
.bld-row{display:flex;gap:8px}.bld-row .bld-btn{flex:1}
.bld-err{margin-top:14px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:10px;padding:10px;font-size:13px}
@media(max-width:1100px){.bld-panel{width:280px}.bld-list{width:180px}}
`;
