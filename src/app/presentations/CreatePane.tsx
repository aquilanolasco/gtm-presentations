"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Spinner } from "@/components/Spinner";
import ProspectCreate from "./ProspectCreate";

// Create a deck from ANY source: drag any file, paste text, or record audio. The app spools it,
// the local relay ingests + generates a branded deck (+ PDF/PPTX/Canva), and it lands under My Decks.
export default function CreatePane({ onCreated, onBuild }: { onCreated?: (kind?: "general" | "sales") => void; onBuild?: (d: { id: string; slug: string; title: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  // first step of Create: General (-> My Decks) or Sales (-> Sales Decks). null = not chosen yet.
  const [kind, setKind] = useState<"general" | "sales" | null>(null);
  // sales decks: build from the prospect's website (default) or from the rep's own file
  const [salesMode, setSalesMode] = useState<"prospect" | "file">("prospect");
  const [wide, setWide] = useState(false); // the prospect form asks for two columns once the site is read
  // Cover template selector was removed from the UI; decks default to the device cover.
  const [cover] = useState<"device" | "master" | "gradient" | "light" | "dark">("device");
  const [phase, setPhase] = useState<"idle" | "uploading" | "generating" | "done" | "error">("idle");
  const [id, setId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [url, setUrl] = useState("");
  // Claude is now the only build engine (Gamma retired).
  const builderMode = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  // the recorded voice memo is kept separately from `file`/`text` so we can BOTH upload the audio
  // file to the deck AND use its live transcript as the deck content.
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Web Speech API recogniser for the real-time transcript (Chrome). Best-effort: if the browser
  // has no SpeechRecognition, the audio still uploads and the server transcribes it instead.
  const recogRef = useRef<{ stop: () => void } | null>(null);

  // Prevent the browser from navigating away / opening the dropped file in a new tab. We swallow
  // drag events at the window level the whole time this pane is mounted, then handle drop ourselves.
  const onDrop = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f); setText("");
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }, [title]);

  useEffect(() => {
    const stop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const enter = (e: DragEvent) => { stop(e); if (e.dataTransfer?.types?.includes("Files")) setDragging(true); };
    const leave = (e: DragEvent) => { stop(e); if (e.relatedTarget === null) setDragging(false); };
    const drop = (e: DragEvent) => { stop(e); setDragging(false); const f = e.dataTransfer?.files?.[0]; if (f) onDrop(f); };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", stop);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", stop);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onDrop]);

  // poll status + live progress while generating (React Query v5: derive from data)
  const poll = trpc.presentations.get.useQuery({ id: id! }, {
    enabled: phase === "generating" && !!id,
    refetchInterval: (q) => { const s = (q.state.data as { status?: string } | undefined)?.status; return s === "ready" || s === "failed" ? false : 1200; },
  });
  useEffect(() => {
    const row = poll.data as { status: string; slug: string; statusMsg?: string | null } | undefined;
    if (!row || phase !== "generating") return;
    setMsg(row.statusMsg || row.status);
    if (row.status === "ready") {
      setPhase("done"); setUrl(`/p/${row.slug}/`); onCreated?.(kind || "general");
      if (builderMode.current && id) { onBuild?.({ id, slug: row.slug, title: title || row.slug }); builderMode.current = false; }
    }
    else if (row.status === "failed") { setPhase("error"); setMsg(row.statusMsg || "Generation failed."); }
  }, [poll.data, phase, onCreated, onBuild, id, title]);

  const cancelDeck = trpc.presentations.remove.useMutation();
  const cancel = () => { if (id) cancelDeck.mutate({ id }); onCreated?.(kind || "general"); reset(); };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        // keep the audio file so it uploads to the deck; the transcript (below) is the content
        setAudioFile(new File([blob], "recording.webm", { type: "audio/webm" }));
        setFile(null);
      };
      mr.start();
      recRef.current = mr; setRecording(true); setRecSecs(0);
      recTimer.current = setInterval(() => setRecSecs((s) => s + 1), 1000);

      // live transcript: append final phrases to the textarea as they are recognised, so the user
      // watches the words appear in real time and can edit them before building.
      type SRType = new () => {
        continuous: boolean; interimResults: boolean; lang: string;
        onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
        onerror: () => void; start: () => void; stop: () => void;
      };
      const SR = ((window as unknown as { SpeechRecognition?: SRType; webkitSpeechRecognition?: SRType }).SpeechRecognition
        || (window as unknown as { webkitSpeechRecognition?: SRType }).webkitSpeechRecognition);
      if (SR) {
        const rec = new SR();
        rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
        let finalText = text ? text.trim() + " " : "";
        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript;
          }
          setText((finalText + interim).trim());
        };
        rec.onerror = () => {};
        try { rec.start(); recogRef.current = rec; } catch { /* mic busy / unsupported */ }
      }
    } catch { setMsg("Couldn't access the microphone."); setPhase("error"); }
  };
  const stopRec = () => {
    recRef.current?.stop();
    try { recogRef.current?.stop(); } catch { /* already stopped */ }
    recogRef.current = null;
    setRecording(false);
    if (recTimer.current) clearInterval(recTimer.current);
  };

  const canSubmit = (!!file || !!audioFile || text.trim().length > 0) && phase !== "uploading";

  const submit = async (builder = false, eng: "gamma" | "claude" = "claude") => {
    if (!canSubmit) return;
    builderMode.current = builder;
    setPhase("uploading"); setMsg("Uploading…");
    try {
      const fd = new FormData();
      // Content precedence: an explicit file wins; else the typed/transcribed text; else the raw
      // audio (server transcribes). The recorded audio is ALSO attached so it is stored on the deck.
      if (file) fd.append("file", file);
      else if (text.trim()) fd.append("file", new File([text], "notes.txt", { type: "text/plain" }));
      else if (audioFile) fd.append("file", audioFile);
      if (audioFile) fd.append("audio", audioFile);
      if (!file && text.trim()) fd.append("transcript", text.trim());
      const autoTitle = file ? file.name.replace(/\.[^.]+$/, "") : (title.trim() || "Untitled deck");
      fd.append("title", title.trim() || autoTitle);
      fd.append("cover", cover);
      fd.append("engine", eng);
      fd.append("kind", kind || "general");
      const r = await fetch("/api/create", { method: "POST", body: fd });
      const raw = await r.text();
      let j: { id?: string; error?: string } | null = null;
      try { j = JSON.parse(raw); } catch { /* non-JSON (e.g. an nginx 413 HTML page) */ }
      if (!r.ok || !j?.id) {
        if (r.status === 413) throw new Error("That file is too large to upload (limit is 60 MB). Try a smaller file, or paste the text instead.");
        throw new Error(j?.error || `Upload failed (${r.status}). Please try again.`);
      }
      setId(j.id); setPhase("generating"); setMsg("Generating your deck…");
      onCreated?.(kind || "general");
    } catch (e) { setPhase("error"); setMsg(e instanceof Error ? e.message : String(e)); }
  };

  const reset = () => { setFile(null); setAudioFile(null); setText(""); setTitle(""); setKind(null); setSalesMode("prospect"); setPhase("idle"); setId(null); setMsg(""); setUrl(""); };
  const mins = `${Math.floor(recSecs / 60)}:${String(recSecs % 60).padStart(2, "0")}`;

  return (
    <div className="cp">
      <div className={`cp-card${wide ? " cp-card--wide" : ""}`}>
        {phase === "idle" && kind === null && (
          <>
            <h2>Create a deck</h2>
            <p className="cp-sub">What kind of deck is this? Your choice decides where it lands.</p>
            <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
              <button type="button" onClick={() => setKind("general")} style={{ flex: 1, textAlign: "left", padding: 18, borderRadius: 16, border: "1px solid var(--border, #e5e7eb)", background: "var(--card, #fff)", cursor: "pointer" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink, #111827)" }}>General deck</div>
                <div style={{ fontSize: 13, color: "var(--muted, #8a8ba3)", marginTop: 4 }}>Lands in <b>My Decks</b></div>
              </button>
              <button type="button" onClick={() => setKind("sales")} style={{ flex: 1, textAlign: "left", padding: 18, borderRadius: 16, border: "1px solid var(--border, #e5e7eb)", background: "var(--card, #fff)", cursor: "pointer" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink, #111827)" }}>Sales deck</div>
                <div style={{ fontSize: 13, color: "var(--muted, #8a8ba3)", marginTop: 4 }}>Lands in <b>Sales Decks</b></div>
              </button>
            </div>
          </>
        )}
        {phase === "idle" && kind === "sales" && salesMode === "prospect" && (
          <ProspectCreate onBack={() => setKind(null)} onUseFile={() => setSalesMode("file")} onCreated={() => onCreated?.("sales")} onLayout={setWide} />
        )}
        {((phase === "idle" && kind !== null && !(kind === "sales" && salesMode === "prospect")) || phase === "uploading" || phase === "error") && (
          <>
            <h2>Create a {kind === "sales" ? "sales" : "general"} deck</h2>
            <button type="button" className="cp-linkbtn" style={{ marginBottom: 6 }} onClick={() => setKind(null)}>← Change deck type</button>
            {kind === "sales" && <button type="button" className="cp-linkbtn" style={{ marginBottom: 6, marginLeft: 14 }} onClick={() => setSalesMode("prospect")}>Build from the prospect&apos;s website instead →</button>}
            <p className="cp-sub">Drag in any file, paste your notes, or record a voice memo. We map the content onto an Acme-branded deck, keep the links working, and hand you PowerPoint, PDF and Canva.</p>

            <label className={`cp-drop${file ? " has" : ""}${dragging ? " over" : ""}`}>
              <input type="file" hidden onChange={(e) => onDrop(e.target.files?.[0] ?? null)} />
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m0 0 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
              <span className="cp-drop-main">{dragging ? "Drop your file here" : file ? file.name : "Drag any file here, or click to choose"}</span>
              {!file && !dragging && <span className="cp-drop-sub">PDF, PowerPoint, Word, text, Markdown, HTML, code, images, audio and more</span>}
              {file && !dragging && <span className="cp-drop-sub">Click to replace</span>}
            </label>

            <div className="cp-or"><span>or</span></div>

            <textarea className="cp-text" placeholder="Paste your content, notes or an outline here…" value={text} onChange={(e) => { setText(e.target.value); if (e.target.value) setFile(null); }} rows={4} />

            <div className="cp-rec-row">
              {!recording ? (
                <button type="button" className="cp-rec" onClick={startRec}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" /></svg>
                  Record audio
                </button>
              ) : (
                <button type="button" className="cp-rec live" onClick={stopRec}>
                  <span className="cp-rec-dot" /> Stop recording · {mins}
                </button>
              )}
              {recording && <span className="cp-rec-live-hint">Transcribing live — the words appear above as you speak</span>}
              {audioFile && !recording && <span className="cp-rec-done">Voice memo saved ({mins}) · it uploads with the deck</span>}
            </div>

            <input className="cp-title" placeholder="Presentation title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />

            {phase === "error" && <div className="cp-err">{msg}</div>}
            <div className="cp-gorow">
              <button className="cp-go claude" disabled={!canSubmit} onClick={() => submit(false, "claude")} title="Designs a bespoke, on-brand Acme deck using product screens and the master-deck layouts. Present, PowerPoint and PDF.">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>
                {phase === "uploading" ? "Uploading…" : "Create deck"}
              </button>
            </div>
            <p className="cp-gohint">We design a bespoke deck in the Acme system, with real product screens and the master-deck layouts. Lands in {kind === "sales" ? "Sales Decks" : "My Decks"} with PowerPoint and PDF. <button type="button" className="cp-linkbtn" disabled={!canSubmit} onClick={() => submit(true, "claude")}>Or build slide-by-slide →</button></p>
          </>
        )}
        {phase === "generating" && (() => {
          const pr = (poll.data as { progress?: { stage?: string; slidesTotal?: number; slidesDone?: number; log?: string[] } } | undefined)?.progress || {};
          const STAGES = [
            { key: "read", label: "Reading your content" },
            { key: "write", label: "Writing slides with Claude" },
            { key: "export", label: "Designing & capturing each slide" },
            { key: "publish", label: "Publishing" },
          ];
          const curIdx = Math.max(0, STAGES.findIndex((s) => s.key === pr.stage));
          const total = pr.slidesTotal || 0, done = pr.slidesDone || 0;
          return (
            <div className="cp-prog">
              <h2>Building your deck…</h2>
              <div className="cp-stages">
                {STAGES.map((s, i) => {
                  const state = i < curIdx ? "done" : i === curIdx ? "active" : "pend";
                  const isExport = s.key === "export";
                  const pct = isExport && total ? Math.round((done / total) * 100) : state === "done" ? 100 : state === "active" ? 100 : 0;
                  return (
                    <div key={s.key} className={`cp-stage ${state}`}>
                      <span className="cp-stage-dot">{state === "done" ? "✓" : i + 1}</span>
                      <div className="cp-stage-body">
                        <div className="cp-stage-top">
                          <span className="cp-stage-label">{s.label}</span>
                          {isExport && total > 0 && state !== "pend" && <span className="cp-stage-count">{done}/{total} slides</span>}
                        </div>
                        <div className="cp-bar"><div className={`cp-bar-fill${state === "active" && !isExport ? " pulse" : ""}`} style={{ width: `${pct}%` }} /></div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="cp-loglabel">Live log</div>
              <div className="cp-log" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                {(pr.log && pr.log.length ? pr.log : [msg || "Starting…"]).slice(-40).map((l, i) => <div key={i} className="cp-logline">{l}</div>)}
              </div>
              <div className="cp-prog-foot">
                <button className="cp-cancel" disabled={cancelDeck.isPending} onClick={cancel}>{cancelDeck.isPending && <Spinner style={{ marginRight: 6 }} />}Cancel &amp; start over</button>
                <span className="cp-prog-note">You can leave this page, it keeps building and lands under My Decks.</span>
              </div>
            </div>
          );
        })()}
        {phase === "done" && (
          <div className="cp-status">
            <div className="cp-tick">✓</div>
            <h2>Your deck is ready</h2>
            <p className="cp-sub">It&apos;s under My Decks, with PowerPoint, PDF and Canva.</p>
            <div className="cp-actions">
              <a className="cp-go" href={url} target="_blank" rel="noopener noreferrer">Open it</a>
              <button className="cp-again" onClick={reset}>Create another</button>
            </div>
          </div>
        )}
      </div>

      {dragging && <div className="cp-dropveil"><div className="cp-dropveil-in">Drop your file to build a deck</div></div>}

      <style>{`
        .cp{position:relative;flex:1;display:flex;align-items:center;justify-content:center;background:#f6f5fb;padding:2rem;overflow-y:auto}
        .cp-card{background:#fff;border:1px solid #ecebf5;border-radius:18px;box-shadow:0 20px 60px -30px rgba(23,18,54,.3);max-width:560px;width:100%;padding:2.2rem;margin:auto;transition:max-width .25s}
        .cp-card--wide{max-width:1180px}
        .cp-card h2{margin:0 0 .5rem;font-size:1.4rem;color:#0f1424}
        .cp-sub{margin:0 0 1.4rem;color:#6b6f80;font-size:.92rem;line-height:1.5}
        .cp-drop{display:flex;flex-direction:column;align-items:center;gap:.55rem;padding:1.8rem;border:2px dashed #d9d5ee;border-radius:14px;color:#6366f1;cursor:pointer;text-align:center;transition:all .18s}
        .cp-drop:hover{border-color:#8b5cf6;background:#faf8ff}
        .cp-drop.has{border-style:solid;border-color:#8b5cf6;color:#4338ca}
        .cp-drop.over{border-color:#6366f1;background:#f3edff;transform:scale(1.01)}
        .cp-drop-main{font-size:.95rem;font-weight:600;word-break:break-word}
        .cp-drop-sub{font-size:.76rem;color:#9aa0b0;font-weight:500}
        .cp-or{display:flex;align-items:center;text-align:center;color:#c4c2d6;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;margin:1rem 0 .8rem}
        .cp-or::before,.cp-or::after{content:"";flex:1;height:1px;background:#eceaf4}
        .cp-or span{padding:0 .7rem}
        .cp-text{width:100%;padding:.75rem .85rem;border:1px solid #e3e0f0;border-radius:11px;font-size:.9rem;color:#0f1424;resize:vertical;font-family:inherit;line-height:1.5}
        .cp-text:focus{outline:none;border-color:#8b5cf6}
        .cp-rec-row{display:flex;align-items:center;gap:.7rem;margin-top:.8rem}
        .cp-rec{display:inline-flex;align-items:center;gap:.5rem;padding:.6rem 1rem;border:1px solid #e3e0f0;background:#fff;border-radius:999px;font-weight:600;font-size:.85rem;color:#0f1424;cursor:pointer}
        .cp-rec:hover{border-color:#8b5cf6;color:#4338ca}
        .cp-rec.live{border-color:#e5484d;color:#e5484d;background:#fff5f5}
        .cp-rec-dot{width:9px;height:9px;border-radius:50%;background:#e5484d;animation:cppulse 1s ease-in-out infinite}
        @keyframes cppulse{0%,100%{opacity:1}50%{opacity:.3}}
        .cp-rec-done{font-size:.8rem;color:#0f9d58;font-weight:600}
        .cp-title{width:100%;margin-top:1rem;padding:.7rem .85rem;border:1px solid #e3e0f0;border-radius:10px;font-size:.92rem;color:#0f1424}
        .cp-title:focus{outline:none;border-color:#8b5cf6}
        .cp-coverlabel{margin:1.1rem 0 .5rem;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9aa0b0}
        .cp-covers{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}
        .cp-cover{position:relative;border:2px solid #ecebf5;border-radius:11px;padding:.7rem;aspect-ratio:16/11;display:flex;flex-direction:column;justify-content:flex-end;gap:.25rem;cursor:pointer;overflow:hidden;text-align:left;transition:border-color .15s,transform .15s}
        .cp-cover:hover{transform:translateY(-2px)}
        .cp-cover.on{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.18)}
        .cp-cover-mark{display:flex;align-items:center;gap:3px;font-family:ui-monospace,Menlo,monospace;font-size:.42rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;opacity:.9}
        .cp-cover-mark i{width:6px;height:6px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);clip-path:polygon(38% 0,62% 0,62% 38%,100% 38%,100% 62%,62% 62%,62% 100%,38% 100%,38% 62%,0 62%,0 38%,38% 38%)}
        .cp-cover-h{font-family:system-ui,sans-serif;font-weight:600;font-size:.82rem;line-height:1;letter-spacing:-.02em}
        .cp-cover-name{position:absolute;top:.5rem;right:.55rem;font-size:.6rem;font-weight:700;color:#9aa0b0;text-transform:uppercase;letter-spacing:.05em}
        .cp-cover-master{background:radial-gradient(125% 125% at 82% 32%,#efe9ff,#eef3ff 45%,#fff);color:#0f1424}
        .cp-cover-master .cp-cover-h b{background:linear-gradient(135deg,#8b5cf6,#3b82f6);-webkit-background-clip:text;background-clip:text;color:transparent}
        .cp-cover-device{background:radial-gradient(125% 125% at 82% 32%,#f3efff,#eef3ff 40%,#fff);color:#0f1424}
        .cp-cover-device .cp-cover-h b{background:linear-gradient(135deg,#8b5cf6,#3b82f6);-webkit-background-clip:text;background-clip:text;color:transparent}
        .cp-cover-emblem{position:absolute;top:50%;right:.5rem;transform:translateY(-50%);width:26px;height:26px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);clip-path:polygon(38% 0,62% 0,62% 38%,100% 38%,100% 62%,62% 62%,62% 100%,38% 100%,38% 62%,0 62%,0 38%,38% 38%);filter:drop-shadow(0 4px 8px rgba(99,102,241,.4))}
        .cp-cover-gradient{background:linear-gradient(135deg,#8b5cf6,#6366f1,#3b82f6);color:#fff}
        .cp-cover-gradient .cp-cover-name{color:rgba(255,255,255,.85)}
        .cp-cover-light{background:#fff;color:#0f1424}
        .cp-cover-light .cp-cover-mark i{background:linear-gradient(135deg,#8b5cf6,#3b82f6)}
        .cp-cover-light .cp-cover-h b{background:linear-gradient(135deg,#8b5cf6,#3b82f6);-webkit-background-clip:text;background-clip:text;color:transparent}
        .cp-cover-dark{background:#0f1424;color:#fff}
        .cp-cover-dark .cp-cover-name{color:#6b7394}
        .cp-go{margin-top:1.2rem;width:100%;border:0;cursor:pointer;background:linear-gradient(135deg,#8b5cf6,#6366f1,#3b82f6);color:#fff;font-weight:600;font-size:.95rem;padding:.85rem;border-radius:11px;text-align:center;text-decoration:none;display:inline-block}
        .cp-go:disabled{opacity:.5;cursor:default}
        .cp-gorow{display:flex;gap:.7rem;margin-top:1.2rem}
        .cp-gorow .cp-go{margin-top:0;flex:1;display:inline-flex;align-items:center;justify-content:center;gap:.45rem}
        .cp-go.ghost{background:#fff;color:#111827;border:1px solid #e5e7eb}
        .cp-go.claude{background:#0f172a}
        .cp-go.claude:not(:disabled):hover{background:#1e293b}
        .cp-go svg{flex:0 0 auto}
        .cp-rec-live-hint{font-size:.78rem;color:#6366f1;font-weight:600}
        .cp-gohint{margin-top:.6rem;font-size:.78rem;color:#9ca3af;line-height:1.4}
        .cp-gohint b{color:#6b7280;font-weight:600}
        .cp-linkbtn{border:0;background:none;padding:0;margin:0;cursor:pointer;color:#6366f1;font:inherit;font-size:.78rem;font-weight:600}
        .cp-linkbtn:disabled{opacity:.5;cursor:default}
        .cp-linkbtn:hover:not(:disabled){text-decoration:underline}
        .cp-err{margin-top:1rem;color:#c81f2f;font-size:.85rem}
        .cp-prog h2{margin:0 0 1.2rem;font-size:1.3rem;color:#0f1424}
        .cp-stages{display:flex;flex-direction:column;gap:.85rem}
        .cp-stage{display:flex;gap:.7rem;align-items:flex-start;opacity:.5;transition:opacity .3s}
        .cp-stage.active,.cp-stage.done{opacity:1}
        .cp-stage-dot{flex-shrink:0;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;background:#efedf9;color:#9aa0b0}
        .cp-stage.active .cp-stage-dot{background:linear-gradient(135deg,#8b5cf6,#6366f1,#3b82f6);color:#fff}
        .cp-stage.done .cp-stage-dot{background:#e7f8ef;color:#0f9d58}
        .cp-stage-body{flex:1;min-width:0}
        .cp-stage-top{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin-bottom:.35rem}
        .cp-stage-label{font-size:.86rem;font-weight:600;color:#0f1424}
        .cp-stage-count{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:#6366f1;font-weight:700;flex-shrink:0}
        .cp-bar{height:6px;border-radius:999px;background:#efedf9;overflow:hidden}
        .cp-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#8b5cf6,#6366f1,#3b82f6);transition:width .4s ease}
        .cp-bar-fill.pulse{background:linear-gradient(90deg,#8b5cf6,#6366f1,#3b82f6,#8b5cf6);background-size:200% 100%;animation:cpslide 1.2s linear infinite}
        @keyframes cpslide{to{background-position:200% 0}}
        .cp-loglabel{margin:1.3rem 0 .4rem;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9aa0b0}
        .cp-log{background:#0f1424;border-radius:11px;padding:.7rem .85rem;height:150px;overflow-y:auto;font-family:ui-monospace,Menlo,monospace;font-size:.74rem;line-height:1.6;color:#c8d0e0}
        .cp-logline{white-space:pre-wrap;word-break:break-word}
        .cp-logline:last-child{color:#8fe3b0}
        .cp-prog-foot{display:flex;align-items:center;gap:1rem;margin-top:1.1rem;flex-wrap:wrap}
        .cp-cancel{flex-shrink:0;border:1px solid #f0c8ce;background:#fff;color:#d33754;font-weight:600;font-size:.84rem;padding:.55rem 1rem;border-radius:10px;cursor:pointer}
        .cp-cancel:hover{background:#fff5f6;border-color:#e5a3ad}
        .cp-prog-note{color:#9aa0b0;font-size:.82rem;line-height:1.4}
        .cp-status{text-align:center;padding:1rem}
        .cp-spin{width:44px;height:44px;margin:0 auto 1.2rem;border:3px solid #eee;border-top-color:#6366f1;border-radius:50%;animation:cpspin 1s linear infinite}
        @keyframes cpspin{to{transform:rotate(360deg)}}
        .cp-tick{width:52px;height:52px;margin:0 auto 1rem;border-radius:50%;background:#e7f8ef;color:#0f9d58;font-size:1.6rem;display:flex;align-items:center;justify-content:center}
        .cp-actions{display:flex;gap:.6rem;justify-content:center;margin-top:1.4rem}
        .cp-actions .cp-go{width:auto;margin:0;padding:.7rem 1.4rem}
        .cp-again{border:1px solid #e3e0f0;background:#fff;border-radius:11px;padding:.7rem 1.2rem;font-weight:600;cursor:pointer;color:#0f1424}
        .cp-dropveil{position:absolute;inset:0;z-index:20;background:rgba(99,102,241,.12);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;pointer-events:none}
        .cp-dropveil-in{border:2.5px dashed #6366f1;border-radius:18px;background:#fff;color:#4338ca;font-weight:700;font-size:1.05rem;padding:2rem 3rem;box-shadow:0 20px 60px -20px rgba(99,102,241,.5)}
      `}</style>
    </div>
  );
}
