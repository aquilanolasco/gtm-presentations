"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// On-canvas Slide Editor. Opens a deck, injects /pp-edit.js in edit mode, and autosaves the patch layer
// to /api/presentations/edits. The heavy lifting (select, inline edit, size, photo pick) lives in the
// runtime inside the deck iframe; this component is the frame, the save loop and the two dialogs the
// runtime asks for: "add a slide" (the + in the deck's left list) and "replace / reframe a photo".
//   mode "full"  : master decks. Move, resize, colours, fonts, words.
//   mode "sales" : generated sales decks. Words, text size, photos, hide a slide, add a slide. The fonts,
//                  colours and layout stay as designed, so every deck stays on brand.
export type EditorMode = "sales" | "full";

type ImgTarget = { eid: string; src: string; w: number; h: number; fit: string; reframe: boolean };

export default function SlideEditor({ id, slug, title, edits, mode = "full", onClose }: {
  id: string; slug: string; title: string; edits?: Record<string, unknown>; mode?: EditorMode; onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const editsRef = useRef<Record<string, unknown>>(edits || {});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mount, setMount] = useState(() => Date.now());
  const [hash, setHash] = useState("");
  const goto = useRef<string | null>(null); // slide to show once the deck has reloaded (the one just added)
  const [add, setAdd] = useState<{ after: string; afterLabel: string } | null>(null);
  const [img, setImg] = useState<ImgTarget | null>(null);
  const [saveReq, setSaveReq] = useState<{ sid: string; label: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = useCallback(async () => {
    setStatus("saving");
    try {
      const r = await fetch("/api/presentations/edits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, edits: editsRef.current }),
      });
      setStatus(r.ok ? "saved" : "error");
    } catch { setStatus("error"); }
  }, [id]);

  const saveHidden = useCallback(async (hidden: string[]) => {
    setStatus("saving");
    try {
      const r = await fetch("/api/presentations/hidden", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, hidden }) });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) flash(hidden.length ? `${hidden.length} slide${hidden.length === 1 ? "" : "s"} hidden from the presentation. PowerPoint and PDF refresh in the background.` : "Every slide is shown again.");
    } catch { setStatus("error"); }
  }, [id]);

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote((n) => (n === msg ? null : n)), 4200); };

  // messages from the runtime inside the deck
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; edits?: Record<string, unknown>; hidden?: string[]; after?: string; afterLabel?: string; sid?: string; label?: string } & Partial<ImgTarget>;
      if (!d || typeof d !== "object") return;
      if (d.type === "ppEditReady") {
        // seed the deck with the latest saved edits from the DB, then jump to the slide we were asked to show
        frameRef.current?.contentWindow?.postMessage({ type: "ppSeed", edits: editsRef.current }, "*");
        if (goto.current) { frameRef.current?.contentWindow?.postMessage({ type: "ppGoto", sid: goto.current }, "*"); goto.current = null; }
      } else if (d.type === "ppEdits") {
        editsRef.current = d.edits || {};
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(save, 700);
      } else if (d.type === "ppHidden" && Array.isArray(d.hidden)) {
        saveHidden(d.hidden);
      } else if (d.type === "ppAddSlide" && d.after) {
        setAdd({ after: d.after, afterLabel: d.afterLabel || "this slide" });
      } else if (d.type === "ppImage" && d.eid) {
        setImg({ eid: d.eid, src: d.src || "", w: d.w || 800, h: d.h || 600, fit: d.fit || "cover", reframe: !!d.reframe });
      } else if (d.type === "ppSaveSlide" && d.sid) {
        // flush the words typed a moment ago before the slide is copied
        if (timer.current) { clearTimeout(timer.current); timer.current = null; save(); }
        setSaveReq({ sid: d.sid, label: d.label || "this slide" });
      }
    };
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("message", onMsg); if (timer.current) clearTimeout(timer.current); };
  }, [save, saveHidden]);

  // once the deck loads, turn on edit mode + inject the runtime (idempotent for baked decks)
  const onLoad = () => {
    const f = frameRef.current; if (!f) return;
    try {
      const w = f.contentWindow as (Window & { __PP_EDIT?: number; __PP_EDIT_MODE?: string }) | null;
      const doc = f.contentDocument;
      if (!w || !doc) return;
      w.__PP_EDIT = 1; w.__PP_EDIT_MODE = mode;
      if (!doc.querySelector("script[data-ppedit]")) {
        const s = doc.createElement("script");
        s.src = "/pp-edit.js?v=" + mount; s.setAttribute("data-ppedit", "1");
        doc.body.appendChild(s);
      }
    } catch { /* cross-origin should never happen (same origin), ignore */ }
  };

  const reload = (toSlide?: string) => { goto.current = toSlide || null; setHash(toSlide ? `#${toSlide}` : ""); setMount(Date.now()); };
  const setImage = (eid: string, src: string) => { frameRef.current?.contentWindow?.postMessage({ type: "ppSetImage", eid, src }, "*"); };

  const statusText = status === "saving" ? "Saving…" : status === "saved" ? "All changes saved" : status === "error" ? "Save failed, retrying on next edit" : "Editing";
  const hint = mode === "sales"
    ? "Click any text to change the words, − and + for its size. Click a photo to replace it. Hover a person or a card for Hide. In the list: the eye hides a slide, + adds one, the bookmark saves it for your next deck."
    : "Click to select, double-click to edit text, drag to move.";

  return (
    <div className="sed">
      <div className="sed-top">
        <button className="sed-done" onClick={onClose}>&lsaquo; Done</button>
        <div className="sed-title">{title}</div>
        <div className="sed-hint">{hint}</div>
        <div className={`sed-status ${status}`}><span className="sed-dot" />{statusText}</div>
      </div>
      <iframe
        ref={frameRef}
        className="sed-frame"
        src={`/p/${slug}/deck/?edit=1${mode === "sales" ? "&mode=sales" : ""}&v=${mount}${hash}`}
        title={`Editing ${title}`}
        onLoad={onLoad}
        allow="clipboard-read clipboard-write"
      />
      {note && <div className="sed-note">{note}</div>}
      {add && (
        <AddSlideDialog
          deckId={id} after={add.after} afterLabel={add.afterLabel}
          onClose={() => setAdd(null)}
          onAdded={(sid) => { setAdd(null); flash("Slide added. PowerPoint and PDF are refreshing in the background."); reload(sid); }}
        />
      )}
      {img && (
        <ImageDialog
          deckId={id} target={img}
          onClose={() => setImg(null)}
          onApply={(src) => { setImage(img.eid, src); setImg(null); }}
        />
      )}
      {saveReq && (
        <SaveSlideDialog
          deckId={id} sid={saveReq.sid} label={saveReq.label}
          onClose={() => setSaveReq(null)}
          onSaved={(name) => { setSaveReq(null); flash(`Saved "${name}". Find it under Slides, Saved slides, and in the picker when you create a sales deck.`); }}
        />
      )}
      <style>{`
        .sed{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--surface-2, #f3f0fb)}
        .sed-top{display:flex;align-items:center;gap:1rem;padding:.6rem .9rem;border-bottom:1px solid var(--border,#e8e3f5);background:var(--surface,#fff);flex-shrink:0}
        .sed-done{border:1px solid var(--border,#e8e3f5);background:var(--surface,#fff);color:var(--ink,#0f172a);font-weight:600;font-size:.85rem;padding:.45rem .9rem;border-radius:9px;cursor:pointer;white-space:nowrap}
        .sed-done:hover{border-color:#c9bef1;color:#4338ca}
        .sed-title{font-weight:600;color:var(--ink,#0f172a);font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;max-width:30%}
        .sed-hint{font-size:.78rem;color:var(--muted,#8b83a8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .sed-status{margin-left:auto;display:inline-flex;align-items:center;gap:.45rem;font-size:.8rem;color:var(--muted,#8b83a8);font-weight:500;white-space:nowrap;flex-shrink:0}
        .sed-dot{width:8px;height:8px;border-radius:50%;background:#c9bef1}
        .sed-status.saving .sed-dot{background:#f5a623;animation:sedpulse 1s infinite}
        .sed-status.saved .sed-dot{background:#0f9d58}
        .sed-status.error .sed-dot{background:#e5484d}
        @keyframes sedpulse{0%,100%{opacity:1}50%{opacity:.3}}
        .sed-frame{flex:1;width:100%;border:0;display:block;min-height:0;background:#fff}
        .sed-note{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);background:#0f172a;color:#fff;font-size:.82rem;font-weight:500;padding:.6rem 1rem;border-radius:999px;box-shadow:0 14px 40px rgba(23,18,54,.35);z-index:30;white-space:nowrap}
        .sed-veil{position:absolute;inset:0;background:rgba(23,18,54,.42);backdrop-filter:blur(3px);z-index:40;display:flex;align-items:center;justify-content:center;padding:1rem}
        .sed-dlg{background:#fff;border-radius:18px;box-shadow:0 30px 80px rgba(23,18,54,.4);width:min(640px,100%);max-height:calc(100% - 2rem);overflow:auto;padding:1.4rem 1.5rem 1.3rem;color:#0f172a;font-size:.9rem;color-scheme:light}
        .sed-dlg h3{margin:0 0 .25rem;font-size:1.1rem;font-weight:700}
        .sed-dlg .sub{color:#8b83a8;font-size:.82rem;margin:0 0 1rem;text-wrap:balance}
        .sed-dlg textarea{width:100%;min-height:118px;border:1px solid #e8e3f5;border-radius:12px;padding:.75rem .85rem;font:inherit;font-size:.9rem;color:#0f172a;resize:vertical;background:#fbfaff;outline:none}
        .sed-dlg textarea:focus{border-color:#a98df5;box-shadow:0 0 0 3px rgba(99,102,241,.14)}
        .sed-drop{margin-top:.7rem;border:1.5px dashed #d6ccf5;border-radius:12px;padding:.9rem 1rem;display:flex;align-items:center;gap:.8rem;background:#faf8ff;cursor:pointer;transition:border-color .15s,background .15s}
        .sed-drop.over{border-color:#6366f1;background:#f3eeff}
        .sed-drop b{font-weight:600}
        .sed-drop small{display:block;color:#8b83a8;font-size:.76rem;margin-top:.1rem}
        .sed-drop .ic{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#6366f1,#3b82f6);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}
        .sed-drop .ic svg{width:16px;height:16px}
        .sed-file{display:flex;align-items:center;gap:.6rem;margin-top:.6rem;font-size:.84rem}
        .sed-file button{border:0;background:transparent;color:#dc2626;cursor:pointer;font:inherit;font-weight:600;padding:0}
        .sed-row{display:flex;align-items:center;gap:.6rem;margin-top:1.1rem;justify-content:flex-end}
        .sed-btn{border:1px solid #e8e3f5;background:#fff;color:#0f172a;font:inherit;font-weight:600;font-size:.86rem;padding:.55rem 1rem;border-radius:10px;cursor:pointer;white-space:nowrap}
        .sed-btn:hover{border-color:#c9bef1;color:#4338ca}
        .sed-btn.pri{border:0;background:linear-gradient(135deg,#8b5cf6,#6366f1,#3b82f6);color:#fff;box-shadow:0 10px 24px rgba(99,102,241,.3)}
        .sed-btn.pri:hover{filter:brightness(1.06);color:#fff}
        .sed-btn:disabled{opacity:.5;cursor:default;filter:none}
        .sed-err{margin-top:.8rem;color:#b91c1c;font-size:.84rem}
        .sed-log{margin-top:1rem;background:#f6f3ff;border-radius:12px;padding:.8rem .95rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.74rem;color:#4b4661;line-height:1.5;max-height:190px;overflow:auto}
        .sed-log div+div{margin-top:.15rem}
        .sed-log .cur{color:#4338ca;font-weight:600}
        .sed-prog{display:flex;align-items:center;gap:.6rem;margin-top:1rem;font-weight:600;font-size:.88rem}
        .sed-spin{width:16px;height:16px;border-radius:50%;border:2.5px solid #e2daf8;border-top-color:#6366f1;animation:sedspin .8s linear infinite;flex-shrink:0}
        @keyframes sedspin{to{transform:rotate(360deg)}}
        .sed-frame-box{position:relative;overflow:hidden;border-radius:14px;background:#111;margin:0 auto;cursor:grab;user-select:none;touch-action:none;box-shadow:0 20px 50px -22px rgba(23,18,54,.6)}
        .sed-frame-box.drag{cursor:grabbing}
        .sed-frame-box img{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;max-width:none}
        .sed-zoom{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.5rem .6rem;margin-top:.8rem;font-size:.82rem;color:#8b83a8}
        .sed-zoom .sed-btn{padding:.4rem .8rem;font-size:.8rem}
        .sed-zoom button{width:30px;height:30px;border-radius:50%;border:1px solid #e8e3f5;background:#fff;color:#0f172a;font-weight:700;cursor:pointer;font-size:1rem;line-height:1}
        .sed-zoom button:hover{border-color:#c9bef1;color:#4338ca}
        .sed-zoom b{min-width:46px;text-align:center;color:#0f172a;font-variant-numeric:tabular-nums}
      `}</style>
    </div>
  );
}

/* ─────────────────────────────── Save this slide ─────────────────────────────── */
function SaveSlideDialog({ deckId, sid, label, onClose, onSaved }: {
  deckId: string; sid: string; label: string; onClose: () => void; onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/presentations/save-slide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deckId, sid, name }) });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string; saved?: { name: string } } | null;
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Could not save (${r.status}).`);
      onSaved(j.saved?.name || name);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <div className="sed-veil" onClick={onClose}>
      <div className="sed-dlg" style={{ width: "min(520px,100%)" }} onClick={(e) => e.stopPropagation()}>
        <h3>Save this slide</h3>
        <p className="sub">Keeps &ldquo;{label}&rdquo; as it reads here: your words, text sizes, photos and the people or cards you hid. It appears under Presentations, Slides, Saved slides, and in the picker when you create your next sales deck. The master deck itself does not change.</p>
        <label style={{ display: "block", fontSize: ".74rem", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8b83a8", margin: "0 0 .4rem" }}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={label} autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !busy) submit(); }}
          style={{ width: "100%", border: "1px solid #e8e3f5", borderRadius: 12, padding: ".7rem .85rem", font: "inherit", fontSize: ".95rem", color: "#0f172a", background: "#fbfaff", outline: "none" }} />
        {err && <div className="sed-err">{err}</div>}
        <div className="sed-row">
          <button className="sed-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sed-btn pri" onClick={submit} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save slide"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Add a slide ─────────────────────────────── */
function AddSlideDialog({ deckId, after, afterLabel, onClose, onAdded }: {
  deckId: string; after: string; afterLabel: string; onClose: () => void; onAdded: (sid: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<"form" | "working" | "failed">("form");
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const baseline = useRef<string[]>([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const submit = async () => {
    if (!prompt.trim() && !file) { setErr("Describe the slide, or add a file for it."); return; }
    setErr(null); setPhase("working"); setLog(["Sending your brief…"]);
    try {
      const pre = await fetch(`/api/presentations/add-slide?id=${deckId}`).then((r) => r.json()).catch(() => ({}));
      baseline.current = Array.isArray(pre.extra) ? pre.extra : [];
      const fd = new FormData();
      fd.append("id", deckId); fd.append("after", after); fd.append("prompt", prompt.trim());
      if (file) fd.append("file", file);
      const r = await fetch("/api/presentations/add-slide", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setPhase("failed"); setErr(j.error || "The request was not accepted."); return; }
    } catch (e) { setPhase("failed"); setErr(String(e)); return; }
    // poll until the slide is in the deck (the PowerPoint and PDF keep refreshing after that)
    const started = Date.now();
    const tick = async () => {
      if (!alive.current) return;
      try {
        const s = await fetch(`/api/presentations/add-slide?id=${deckId}&t=${Date.now()}`).then((r) => r.json());
        if (Array.isArray(s.log) && s.log.length) setLog(s.log);
        const fresh = (Array.isArray(s.extra) ? s.extra : []).filter((x: string) => !baseline.current.includes(x));
        if (fresh.length && (s.status === "ready" || /Slide ready|Capturing|Captured|exports|PowerPoint/i.test((s.log || []).slice(-3).join(" ")))) { onAdded(fresh[fresh.length - 1]); return; }
        if (s.status === "ready" && !fresh.length && Date.now() - started > 15000) { setPhase("failed"); setErr("The slide did not land in the deck. Try again with a shorter brief."); return; }
        if (s.status === "failed") { setPhase("failed"); setErr(s.statusMsg || "The slide could not be built."); return; }
      } catch { /* transient, keep polling */ }
      if (Date.now() - started < 8 * 60 * 1000) setTimeout(tick, 2500);
      else { setPhase("failed"); setErr("This is taking longer than it should. The slide may still land; check the deck in a minute."); }
    };
    setTimeout(tick, 2500);
  };

  const pick = (f: File | null) => { if (!f) return; if (f.size > 25 * 1024 * 1024) { setErr("That file is over 25 MB."); return; } setErr(null); setFile(f); };

  return (
    <div className="sed-veil" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== "working") onClose(); }}>
      <div className="sed-dlg" role="dialog" aria-label="Add a slide">
        <h3>Add a slide after “{afterLabel}”</h3>
        <p className="sub">Say what the slide should carry, or drop in a document and we will write the slide from it. It is built inside the deck’s own slide designs, then checked on screen before it lands.</p>
        {phase === "form" || phase === "failed" ? (
          <>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="For example: a slide on how the rollout would run across their three London hotels, with the first stocktake in week four. Or: summarise the attached proposal into three points." autoFocus />
            <div
              className={`sed-drop${over ? " over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0] || null); }}
            >
              <span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0 4 4m-4-4-4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /></svg></span>
              <span><b>Drop a file here, or click to choose one</b><small>PDF, PowerPoint, Word, text or an image. Optional.</small></span>
              <input ref={fileRef} type="file" hidden accept=".pdf,.pptx,.docx,.txt,.md,.csv,image/*" onChange={(e) => pick(e.target.files?.[0] || null)} />
            </div>
            {file && <div className="sed-file"><span>{file.name}</span><button type="button" onClick={() => setFile(null)}>Remove</button></div>}
            {err && <div className="sed-err">{err}</div>}
            <div className="sed-row">
              <button className="sed-btn" onClick={onClose}>Cancel</button>
              <button className="sed-btn pri" onClick={submit}>Create slide</button>
            </div>
          </>
        ) : (
          <>
            <div className="sed-prog"><span className="sed-spin" />Writing, rendering and checking the slide. About a minute.</div>
            <div className="sed-log">{log.map((l, i) => <div key={i} className={i === log.length - 1 ? "cur" : ""}>{l}</div>)}</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Replace / reframe a photo ─────────────────────────── */
function ImageDialog({ deckId, target, onClose, onApply }: {
  deckId: string; target: ImgTarget; onClose: () => void; onApply: (src: string) => void;
}) {
  const cover = target.fit === "cover";
  const [file, setFile] = useState<File | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [src, setSrc] = useState<string>(target.reframe ? target.src : "");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // the frame keeps the slide's own proportions
  const aspect = Math.max(0.3, Math.min(4, target.w / Math.max(1, target.h)));
  const frameW = Math.min(600, typeof window !== "undefined" ? window.innerWidth - 120 : 600);
  const frameH = Math.round(frameW / aspect);

  useEffect(() => {
    if (!src) { setImgEl(null); return; }
    const im = new Image();
    im.onload = () => { setImgEl(im); setZoom(1); setPan({ x: 0, y: 0 }); };
    im.onerror = () => setErr("That image could not be read.");
    im.src = src;
  }, [src]);

  const pick = (f: File | null) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { setErr("Use a PNG, JPG, WebP or GIF image."); return; }
    if (f.size > 15 * 1024 * 1024) { setErr("That image is over 15 MB."); return; }
    setErr(null); setFile(f); setSrc(URL.createObjectURL(f));
  };

  // the image covers the frame at zoom 1; pan is clamped so the frame is always filled
  const base = imgEl ? Math.max(frameW / imgEl.naturalWidth, frameH / imgEl.naturalHeight) : 1;
  const S = base * zoom;
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    if (!imgEl) return p;
    const s = base * z, w = imgEl.naturalWidth * s, h = imgEl.naturalHeight * s;
    return { x: Math.min(0, Math.max(frameW - w, p.x)), y: Math.min(0, Math.max(frameH - h, p.y)) };
  };
  const setZoomKeepCentre = (z: number) => {
    if (!imgEl) return;
    const nz = Math.min(4, Math.max(1, Math.round(z * 100) / 100));
    const cx = frameW / 2, cy = frameH / 2;
    const ix = (cx - pan.x) / S, iy = (cy - pan.y) / S;       // image point under the centre
    const ns = base * nz;
    setZoom(nz); setPan(clamp({ x: cx - ix * ns, y: cy - iy * ns }, nz));
  };
  useEffect(() => { setPan((p) => clamp(p)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [imgEl, zoom]);

  const apply = async () => {
    if (!src) { setErr("Choose a photo first."); return; }
    setBusy(true); setErr(null);
    try {
      let blob: Blob | null = null; let type = "image/webp";
      if (cover && imgEl) {
        // crop what sits in the frame, at up to 1600 px wide
        const outW = Math.min(1600, Math.round(frameW / S)), outH = Math.round(outW / aspect);
        const c = document.createElement("canvas"); c.width = outW; c.height = outH;
        const ctx = c.getContext("2d"); if (!ctx) throw new Error("no canvas");
        ctx.drawImage(imgEl, -pan.x / S, -pan.y / S, frameW / S, frameH / S, 0, 0, outW, outH);
        blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", 0.88));
      } else if (file) { blob = file; type = file.type; }
      else if (imgEl) { const r = await fetch(src); blob = await r.blob(); type = blob.type || type; }
      if (!blob) throw new Error("could not prepare the image");
      const fd = new FormData(); fd.append("id", deckId); fd.append("file", new File([blob], "photo", { type }));
      const r = await fetch("/api/presentations/image", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error || "upload failed");
      onApply(j.url);
    } catch (e) { setErr(String((e as Error).message || e)); setBusy(false); }
  };

  const onDown = (e: React.PointerEvent) => { if (!imgEl) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); dragRef.current = { sx: e.clientX, sy: e.clientY, x: pan.x, y: pan.y }; setDrag(true); };
  const onMove = (e: React.PointerEvent) => { const d = dragRef.current; if (!d) return; setPan(clamp({ x: d.x + (e.clientX - d.sx), y: d.y + (e.clientY - d.sy) })); };
  const onUp = () => { dragRef.current = null; setDrag(false); };

  return (
    <div className="sed-veil" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sed-dlg" role="dialog" aria-label="Replace photo" style={{ width: "min(680px,100%)" }}>
        <h3>{target.reframe ? "Reframe the photo" : cover ? "Replace the photo" : "Replace the image"}</h3>
        <p className="sub">{cover ? "Drop in any photo. Drag it to move it inside the frame and use the zoom to crop; the frame keeps the slide’s proportions." : "Drop in a new image file. It keeps the same place and size on the slide."}</p>
        {!(target.reframe && imgEl) && !file && (
          <div
            className={`sed-drop${over ? " over" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0] || null); }}
          >
            <span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></svg></span>
            <span><b>Drop a photo here, or click to choose one</b><small>PNG, JPG or WebP. A landscape photo works best.</small></span>
          </div>
        )}
        <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => pick(e.target.files?.[0] || null)} />
        {imgEl && cover && (
          <>
            <div
              ref={boxRef} className={`sed-frame-box${drag ? " drag" : ""}`} style={{ width: frameW, height: frameH, marginTop: file || target.reframe ? ".4rem" : "1rem" }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              onWheel={(e) => { e.preventDefault(); setZoomKeepCentre(zoom * (e.deltaY < 0 ? 1.08 : 0.92)); }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" draggable={false} style={{ width: imgEl.naturalWidth, height: imgEl.naturalHeight, transform: `translate(${pan.x}px,${pan.y}px) scale(${S})` }} />
            </div>
            <div className="sed-zoom">
              <button type="button" onClick={() => setZoomKeepCentre(zoom - 0.15)} aria-label="Zoom out">&#8722;</button>
              <b>{Math.round(zoom * 100)}%</b>
              <button type="button" onClick={() => setZoomKeepCentre(zoom + 0.15)} aria-label="Zoom in">+</button>
              <span>Drag to move, scroll to zoom.</span>
              <button type="button" className="sed-btn" onClick={() => fileRef.current?.click()}>Change photo</button>
            </div>
          </>
        )}
        {imgEl && !cover && (
          <div style={{ marginTop: "1rem", display: "flex", justifyContent: "center", background: "#f6f3ff", borderRadius: 14, padding: "1rem" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain" }} />
          </div>
        )}
        {err && <div className="sed-err">{err}</div>}
        <div className="sed-row">
          <button className="sed-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sed-btn pri" onClick={apply} disabled={busy || !imgEl}>{busy ? "Saving…" : cover ? "Use this crop" : "Use this image"}</button>
        </div>
      </div>
    </div>
  );
}
