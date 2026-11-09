"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Spinner } from "@/components/Spinner";
import LIB from "@/lib/engage-library.json";

/* Create a SALES deck for a prospect from their website ("Create from a Master Deck").
   1. paste the URL -> we read the site (name, logo, photos)   2. confirm the name, pick the logo and
   cover photo, add notes, choose who presents, and tick the master slides that follow the opening
   slides (the slide library: Introduction deck, Sales deck, Short Pack; whole decks or single slides,
   the deck orders them)   3. the VPS engage worker writes the opening slides with Claude, renders the
   deck, captures PowerPoint + PDF, and the deck lands under Sales Decks with the rep's signature on the
   closing page. Rendered inside CreatePane's card, two columns while the form is open. */

type Cand = { url: string; w: number; h: number; kind?: string; score: number };
type WebCand = { url: string; host?: string; title?: string; w?: number; h?: number };
type Scout = { url: string; name: string; description?: string; logos: Cand[]; heroes: Cand[]; webLogos?: WebCand[]; text?: string; lite?: boolean; error?: string; domain?: string };
type PresenterOpt = { email: string; name: string; title: string; avatar: string; hasPhone: boolean; hasBooking: boolean };
type LibSlide = { sid: string; id: string; label: string; title: string; dark?: boolean; thumb?: string; sub?: string };
type LibDeck = { id: string; title: string; blurb?: string; slides: LibSlide[] };
type SavedSlide = { id: string; name: string; base: string; label: string; deckTitle: string; from: { title: string }; ownerName: string; mine: boolean; thumb: string | null; createdAt: string };
// the slide library (a copy of web-deck components/library/library.json); thumbnails at /p/_library/<sid>.webp
const DECKS = LIB.decks as LibDeck[];
const DEFAULT_BODY = (DECKS.find((d) => d.id === "shortpack")?.slides || []).map((s) => s.sid);
const LIB_V = (LIB as { version?: string }).version || "1"; // thumbnail cache key
const STAGES = [
  { key: "read", label: "Reading their website and logo" },
  { key: "write", label: "Writing their opening slides" },
  { key: "export", label: "Rendering the deck, PowerPoint and PDF" },
  { key: "publish", label: "Publishing" },
];

export default function ProspectCreate({ onBack, onUseFile, onCreated, onLayout }: { onBack: () => void; onUseFile: () => void; onCreated?: () => void; onLayout?: (wide: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [looking, setLooking] = useState(false);
  const [scout, setScout] = useState<Scout | null>(null);
  const [scoutErr, setScoutErr] = useState("");
  const [manual, setManual] = useState(false); // site could not be read: name + uploaded logo by hand
  const [client, setClient] = useState("");
  const [logo, setLogo] = useState<string>("auto");       // candidate url | "upload" | "auto"
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [hero, setHero] = useState<string>("auto");       // candidate url | "upload" | "none" | "auto"
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreview, setHeroPreview] = useState("");
  const [notes, setNotes] = useState("");
  const [presenters, setPresenters] = useState<PresenterOpt[]>([]);
  const [presenter, setPresenter] = useState("");
  const [body, setBody] = useState<string[]>(DEFAULT_BODY);          // library sids (or "<sid>~<savedId>"), any order (the deck sorts them)
  const [open, setOpen] = useState<Record<string, boolean>>({ shortpack: true, saved: true }); // which decks show their thumbnails
  // the Saved slides: master slides a rep edited in a sales deck and kept (yours; the super admin sees everyone's)
  const [saved, setSaved] = useState<SavedSlide[]>([]);
  useEffect(() => {
    fetch("/api/presentations/saved-slides", { headers: ((): Record<string, string> => { try { const v = localStorage.getItem("pp_impersonate"); return v ? { "x-pp-view-as": v } : {}; } catch { return {}; } })() }).then((r) => (r.ok ? r.json() : null)).then((j: { saved: SavedSlide[] } | null) => { if (j?.saved) setSaved(j.saved); }).catch(() => {});
  }, []);
  const groups: LibDeck[] = [
    ...(saved.length ? [{ id: "saved", title: "Saved slides", blurb: "Master slides your team edited in a sales deck and kept: the words, photos and people as they were saved. Picked ones sit right after the master slide they came from.",
      slides: saved.map((s) => ({ sid: `${s.base}~${s.id}`, id: s.id, label: s.name, title: `${s.label} from ${s.from?.title || "a sales deck"}${s.mine ? "" : `, saved by ${s.ownerName}`}`, thumb: s.thumb || `/p/_library/${s.base}.webp`, sub: s.mine ? undefined : s.ownerName })) }] : []),
    ...DECKS,
  ];
  const [phase, setPhase] = useState<"form" | "submitting" | "generating" | "done" | "error">("form");
  const [err, setErr] = useState("");
  const [job, setJob] = useState<{ id: string; slug: string; title: string } | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/create/engage").then((r) => (r.ok ? r.json() : null)).then((j: { presenters: PresenterOpt[]; me: string | null } | null) => {
      if (!j) return;
      setPresenters(j.presenters);
      setPresenter(j.me || j.presenters[0]?.email || "");
    }).catch(() => {});
  }, []);

  const lookUp = async () => {
    if (!url.trim()) return;
    setLooking(true); setScoutErr(""); setScout(null); setManual(false);
    try {
      const r = await fetch("/api/create/scout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await r.json().catch(() => null) as (Scout & { error?: string }) | null;
      if (!r.ok || !j || j.error && !j.name) { setScoutErr(j?.error || `Could not read that site (${r.status}).`); setManual(true); setClient(""); return; }
      setScout(j);
      setClient((j.name || "").replace(/\s*\|.*$/, "").trim());
      // default: the engine downloads every version (their site + a web search) and Claude picks the
      // official dark one; a white logo is recoloured, never put on a badge. The rep can still pick.
      setLogo(j.logos?.length || j.webLogos?.length ? "auto" : "upload");
      setHero(j.heroes?.length ? "auto" : "none");
      setLogoFile(null); setLogoPreview(""); setHeroFile(null); setHeroPreview("");
      if (!j.logos?.length) setManual(true);
    } catch (e) { setScoutErr(e instanceof Error ? e.message : String(e)); setManual(true); }
    finally { setLooking(false); }
  };

  const pickFile = (f: File | null) => {
    setLogoFile(f);
    if (f) { setLogo("upload"); const u = URL.createObjectURL(f); setLogoPreview(u); }
  };
  // the rep's own cover photo (their property, a venue shot, anything they prefer over what we found)
  const pickHero = (f: File | null) => {
    setHeroFile(f);
    if (f) { setHero("upload"); const u = URL.createObjectURL(f); setHeroPreview(u); }
  };

  const canCreate = phase === "form" && !!client.trim() && !!url.trim() && (logo !== "upload" || !!logoFile) && (hero !== "upload" || !!heroFile) && (!!scout || manual) && body.length > 0;
  // the form (once the site is read) takes two columns: the prospect on the left, the slide picker on the right
  const formOpen = phase === "form" && (!!scout || manual) && !looking;
  useEffect(() => { onLayout?.(formOpen); return () => onLayout?.(false); }, [formOpen, onLayout]);

  const submit = async () => {
    if (!canCreate) return;
    setPhase("submitting"); setErr("");
    try {
      const fd = new FormData();
      fd.append("url", url.trim());
      fd.append("client", client.trim());
      fd.append("logo", logo === "upload" ? "auto" : logo);
      if (logo === "upload" && logoFile) fd.append("logoFile", logoFile);
      fd.append("hero", hero === "upload" ? "auto" : hero);
      if (hero === "upload" && heroFile) fd.append("heroFile", heroFile);
      fd.append("notes", notes);
      fd.append("presenter", presenter);
      fd.append("body", JSON.stringify(body));
      if (scout) fd.append("scout", JSON.stringify({ ...scout, text: (scout.text || "").slice(0, 9000) }));
      const r = await fetch("/api/create/engage", { method: "POST", body: fd });
      const j = await r.json().catch(() => null) as { id?: string; slug?: string; title?: string; error?: string } | null;
      if (!r.ok || !j?.id || !j.slug) throw new Error(j?.error || `Could not queue the deck (${r.status}).`);
      setJob({ id: j.id, slug: j.slug, title: j.title || client });
      setPhase("generating");
      onCreated?.();
    } catch (e) { setPhase("error"); setErr(e instanceof Error ? e.message : String(e)); }
  };

  // live progress while the worker builds
  const poll = trpc.presentations.get.useQuery({ id: job?.id ?? "" }, {
    enabled: phase === "generating" && !!job,
    refetchInterval: (q) => { const s = (q.state.data as { status?: string } | undefined)?.status; return s === "ready" || s === "failed" ? false : 1500; },
  });
  useEffect(() => {
    const row = poll.data as { status: string; statusMsg?: string | null } | undefined;
    if (!row || phase !== "generating") return;
    if (row.status === "ready") { setPhase("done"); onCreated?.(); }
    else if (row.status === "failed") { setPhase("error"); setErr(row.statusMsg || "The build failed."); }
  }, [poll.data, phase, onCreated]);
  const cancelDeck = trpc.presentations.remove.useMutation();
  const reset = () => { setPhase("form"); setJob(null); setErr(""); };

  const pr = (poll.data as { progress?: { stage?: string; slidesTotal?: number; slidesDone?: number; log?: string[] } } | undefined)?.progress || {};
  const curIdx = Math.max(0, STAGES.findIndex((s) => s.key === pr.stage));
  const me = presenters.find((p) => p.email === presenter);
  const logoCands = (scout?.logos || []).filter((c) => !broken[c.url]).slice(0, 6);
  const webCands = (scout?.webLogos || []).filter((c) => !broken[c.url] && !logoCands.some((l) => l.url === c.url)).slice(0, 8);
  const heroCands = (scout?.heroes || []).filter((c) => !broken[c.url]).slice(0, 5);

  if (phase === "generating" || phase === "submitting") {
    return (
      <div className="cp-prog">
        <h2>Building {job?.title || `the ${client} deck`}…</h2>
        <div className="cp-stages">
          {STAGES.map((s, i) => {
            const state = phase === "submitting" ? "pend" : i < curIdx ? "done" : i === curIdx ? "active" : "pend";
            const isExport = s.key === "export";
            const total = pr.slidesTotal || 0, done = pr.slidesDone || 0;
            const pct = isExport && total ? Math.round((done / total) * 100) : state === "pend" ? 0 : 100;
            return (
              <div key={s.key} className={`cp-stage ${state}`}>
                <span className="cp-stage-dot">{state === "done" ? "✓" : i + 1}</span>
                <div className="cp-stage-body">
                  <div className="cp-stage-top">
                    <span className="cp-stage-label">{s.label}</span>
                    {isExport && total > 0 && state !== "pend" && <span className="cp-stage-count">{done}/{total} slides</span>}
                  </div>
                  <div className="cp-bar"><div className={`cp-bar-fill${state === "active" && !(isExport && total) ? " pulse" : ""}`} style={{ width: `${pct}%` }} /></div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="cp-loglabel">Live log</div>
        <div className="cp-log" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
          {(pr.log && pr.log.length ? pr.log : ["Queued…"]).slice(-40).map((l, i) => <div key={i} className="cp-logline">{l}</div>)}
        </div>
        <div className="cp-prog-foot">
          <button className="cp-cancel" disabled={cancelDeck.isPending || !job} onClick={() => { if (job) cancelDeck.mutate({ id: job.id }); onCreated?.(); reset(); }}>{cancelDeck.isPending && <Spinner style={{ marginRight: 6 }} />}Cancel &amp; start over</button>
          <span className="cp-prog-note">Two minutes for the Short Pack, about seven for a whole master deck. You can leave this page, it keeps building and lands under Sales Decks.</span>
        </div>
      </div>
    );
  }

  if (phase === "done" && job) {
    return (
      <div className="cp-status">
        <div className="cp-tick">✓</div>
        <h2>{job.title} is ready</h2>
        <p className="cp-sub">It&apos;s under Sales Decks with PowerPoint and PDF{me ? `, signed by ${me.name}` : ""}. Share the public link from its card.</p>
        <div className="cp-actions">
          <a className="cp-go" href={`/presentations/p/${job.slug}/`} target="_blank" rel="noopener noreferrer">Open it</a>
          <button className="cp-again" onClick={() => { reset(); setScout(null); setUrl(""); setClient(""); setNotes(""); setLogo("auto"); setLogoFile(null); setLogoPreview(""); setHero("auto"); setHeroFile(null); setHeroPreview(""); }}>Create another</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <h2>Sales deck for a prospect</h2>
      <button type="button" className="cp-linkbtn" style={{ marginBottom: 6 }} onClick={onBack}>← Change deck type</button>
      <p className="cp-sub">Paste the prospect&apos;s website. We read their site, take their logo, write opening slides for them, add the master slides you pick (Introduction deck, Sales deck or the Short Pack), and sign the closing page. You get the live deck, PowerPoint and PDF.</p>

      <div className="pc-row">
        <input className="pc-url" placeholder="www.example.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookUp(); } }} disabled={looking} />
        <button type="button" className="pc-look" onClick={lookUp} disabled={looking || !url.trim()}>{looking ? <><Spinner style={{ marginRight: 6 }} />Reading…</> : "Look up"}</button>
      </div>
      {scoutErr && <div className="cp-err" style={{ marginTop: 8 }}>{scoutErr}</div>}
      {looking && <p className="pc-hint">Opening their site in a browser and reading it. Ten to twenty seconds.</p>}

      {(scout || manual) && !looking && (
        <div className="pc-cols">
        <div className="pc-col">
          {scout?.description && <p className="pc-desc">{scout.description}</p>}

          <label className="pc-lbl">Company name, as it should appear</label>
          <input className="cp-title" style={{ marginTop: 0 }} value={client} onChange={(e) => setClient(e.target.value)} placeholder="Prospect name" />

          <label className="pc-lbl">Logo for the cover <span>(sits straight on the white cover, never in a box)</span></label>
          <div className="pc-grid">
            <button type="button" className={`pc-tile pc-auto${logo === "auto" ? " on" : ""}`} onClick={() => setLogo("auto")} title="We download every version from their site and the web; Claude picks the official dark one. A white-only logo is recoloured to their dark colour or black.">
              <span>Let the engine<br />choose</span>
            </button>
            {logoCands.map((c) => (
              <button type="button" key={c.url} className={`pc-tile${logo === c.url ? " on" : ""}`} onClick={() => setLogo(c.url)} title={c.kind === "icon" ? "Site icon" : "Logo from their site"}>
                <img src={c.url} alt="" onError={() => setBroken((b) => ({ ...b, [c.url]: true }))} />
              </button>
            ))}
            <button type="button" className={`pc-tile pc-up${logo === "upload" ? " on" : ""}`} onClick={() => fileRef.current?.click()} title="Upload a logo file (SVG or PNG with a transparent background is best)">
              {logoPreview ? <img src={logoPreview} alt="" /> : <span>+ Upload<br /><small>SVG or PNG</small></span>}
            </button>
            <input ref={fileRef} type="file" accept="image/*,.svg" hidden onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </div>
          {webCands.length > 0 && (
            <>
              <label className="pc-lbl" style={{ marginTop: ".6rem" }}>Found on the web <span>(other colours often live outside their site)</span></label>
              <div className="pc-grid">
                {webCands.map((c) => (
                  <button type="button" key={c.url} className={`pc-tile${logo === c.url ? " on" : ""}`} onClick={() => setLogo(c.url)} title={`${c.host || ""}${c.title ? ": " + c.title : ""}`}>
                    <img src={c.url} alt="" referrerPolicy="no-referrer" onError={() => setBroken((b) => ({ ...b, [c.url]: true }))} />
                  </button>
                ))}
              </div>
            </>
          )}
          {!logoCands.length && !webCands.length && logo !== "upload" && <p className="pc-hint">No logo found on the page or the web. Upload one.</p>}

          <label className="pc-lbl">Cover photo <span>(their property, right of the title)</span></label>
          <div className="pc-grid pc-photos">
            <button type="button" className={`pc-tile pc-none${hero === "none" ? " on" : ""}`} onClick={() => setHero("none")}><span>No photo</span></button>
            {heroCands.map((c, i) => (
              <button type="button" key={c.url} className={`pc-tile pc-photo${hero === c.url || (hero === "auto" && i === 0) ? " on" : ""}`} onClick={() => setHero(c.url)}>
                <img src={c.url} alt="" onError={() => setBroken((b) => ({ ...b, [c.url]: true }))} />
              </button>
            ))}
            <button type="button" className={`pc-tile pc-up${hero === "upload" ? " on" : ""}`} onClick={() => heroRef.current?.click()} title="Upload your own cover photo (their property or venue; a landscape JPG or PNG works best)">
              {heroPreview ? <img src={heroPreview} alt="" /> : <span>+ Upload<br /><small>JPG or PNG</small></span>}
            </button>
            <input ref={heroRef} type="file" accept="image/*" hidden onChange={(e) => pickHero(e.target.files?.[0] ?? null)} />
          </div>
          {!heroCands.length && hero !== "upload" && <p className="pc-hint">No usable photo found on their site. Upload one, or leave No photo for a full-width cover.</p>}

          <label className="pc-lbl">Notes for the writer <span>(optional, outranks the website)</span></label>
          <textarea className="cp-text" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Commercial terms to show (e.g. a discount or contract length), what they care about, who you met, the incumbent system or competitors to compare against…" />

          <div className="pc-two">
            <div>
              <label className="pc-lbl">Presented by <span>(signs the closing page)</span></label>
              <div className="pc-sel">
                <select value={presenter} onChange={(e) => setPresenter(e.target.value)}>
                  {presenters.map((p) => <option key={p.email} value={p.email}>{p.name}{p.title ? `, ${p.title}` : ""}</option>)}
                </select>
                <svg className="pc-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
          </div>

          {phase === "error" && <div className="cp-err">{err}</div>}
          <div className="cp-gorow">
            <button className="cp-go claude" disabled={!canCreate} onClick={submit}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>
              Create sales deck
            </button>
          </div>
          {!body.length && <p className="pc-hint" style={{ color: "#dc2626" }}>Pick at least one slide for after the opening slides.</p>}
        </div>

        {/* the slide library: whole decks with one tick, or open a deck and pick its slides. It stays
            beside the form while the (longer) left column scrolls, with its own scroll when taller
            than the window. */}
        <div className="pc-col pc-col-r">
        <div className="pc-sticky">
          <div className="pc-lib-top">
            <label className="pc-lbl" style={{ margin: 0 }}>Slides after their opening slides</label>
            <span className="pc-lib-n">{body.length} picked</span>
          </div>
          <p className="pc-hint" style={{ marginTop: ".35rem" }}>Tick a whole deck, or open it and pick slides. They follow the opening slides in the order the decks are listed here. Every slide stays editable afterwards.</p>
          {groups.map((d) => {
            const ids = d.slides.map((s) => s.sid);
            const on = ids.filter((x) => body.includes(x)).length;
            const all = on === ids.length;
            const isOpen = !!open[d.id];
            return (
              <div key={d.id} className={`pc-deck${on ? " has" : ""}`}>
                <div className="pc-deck-head">
                  <button type="button" className={`pc-deck-all${all ? " on" : on ? " part" : ""}`} title={all ? `Remove the whole ${d.title}` : `Add the whole ${d.title}`} aria-label={all ? `Remove the whole ${d.title}` : `Add the whole ${d.title}`}
                    onClick={() => setBody((cur) => (all ? cur.filter((x) => !ids.includes(x)) : [...cur.filter((x) => !ids.includes(x)), ...ids]))}>
                    {all ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : on ? <i className="pc-deck-dash" /> : null}
                  </button>
                  <button type="button" className="pc-deck-title" onClick={() => setOpen((o) => ({ ...o, [d.id]: !isOpen }))} aria-expanded={isOpen}>
                    <b>{d.title}</b>
                    <span>{on ? `${on} of ${ids.length} slides` : `${ids.length} slides`}</span>
                    <svg className={isOpen ? "up" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                </div>
                {isOpen && (
                  <>
                    {d.blurb && <p className="pc-deck-blurb">{d.blurb}</p>}
                    <div className="pc-thumbs">
                      {d.slides.map((s) => {
                        const picked = body.includes(s.sid);
                        return (
                          <button type="button" key={s.sid} className={`pc-thumb${picked ? " on" : ""}`} title={s.title} aria-pressed={picked}
                            onClick={() => setBody((cur) => (picked ? cur.filter((x) => x !== s.sid) : [...cur, s.sid]))}>
                            <span className="pc-thumb-img"><img src={`${s.thumb || `/p/_library/${s.sid}.webp`}?v=${LIB_V}`} alt="" loading="lazy" /><i className="pc-thumb-tick">✓</i></span>
                            <span className="pc-thumb-l">{s.label}</span>
                            {s.sub && <span className="pc-thumb-sub">{s.sub}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        </div>
        </div>
      )}
      <p className="cp-gohint" style={{ marginTop: 14 }}>Have slides of your own for this prospect? <button type="button" className="cp-linkbtn" onClick={onUseFile}>Build the sales deck from a file instead →</button></p>

      <style>{`
        .pc-row{display:flex;gap:.6rem;margin-top:.2rem}
        .pc-url{flex:1;min-width:0;padding:.75rem .85rem;border:1px solid #e3e0f0;border-radius:11px;font-size:.95rem;color:#0f1424;font-family:inherit}
        .pc-url:focus{outline:none;border-color:#8b5cf6}
        .pc-look{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;padding:0 1.1rem;border:0;border-radius:11px;background:#0f172a;color:#fff;font-weight:600;font-size:.9rem;cursor:pointer;white-space:nowrap}
        .pc-look:disabled{opacity:.5;cursor:default}
        .pc-hint{margin:.6rem 0 0;font-size:.8rem;color:#9aa0b0}
        .pc-desc{margin:.9rem 0 0;padding:.7rem .85rem;background:#f6f5fb;border-radius:10px;font-size:.84rem;color:#4b5563;line-height:1.45}
        .pc-lbl{display:block;margin:1.1rem 0 .45rem;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9aa0b0}
        .pc-lbl span{font-weight:500;text-transform:none;letter-spacing:0;color:#b4b8c6}
        .pc-grid{display:flex;flex-wrap:wrap;gap:.55rem}
        .pc-tile{position:relative;width:118px;height:64px;border:2px solid #ecebf5;border-radius:12px;background:#cfd3dc;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:8px;overflow:hidden;transition:border-color .15s,transform .15s}
        .pc-tile:hover{transform:translateY(-1px)}
        .pc-tile.on{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.18)}
        .pc-tile img{max-width:100%;max-height:100%;object-fit:contain;display:block}
        .pc-tile.pc-up{background:#fff;border-style:dashed;color:#6366f1;font-weight:600;font-size:.8rem;text-align:center;line-height:1.2}
        .pc-tile.pc-auto{background:linear-gradient(135deg,#f3edff,#eef2ff);color:#4338ca;font-weight:700;font-size:.78rem;text-align:center;line-height:1.2}
        .pc-tile.pc-up small{font-weight:500;color:#9aa0b0;font-size:.68rem}
        .pc-photos .pc-tile{width:124px;height:78px;padding:0;background:#f6f5fb}
        .pc-photos .pc-tile img{width:100%;height:100%;object-fit:cover}
        .pc-photos .pc-tile.pc-up{background:#fff}
        .pc-tile.pc-none{color:#6b6f80;font-size:.78rem;font-weight:600;background:#fff}
        .pc-two{display:grid;grid-template-columns:1fr;gap:.8rem}
        .pc-sel{position:relative}
        .pc-sel select{width:100%;appearance:none;-webkit-appearance:none;font:inherit;font-size:.9rem;color:#0f1424;background:#fff;border:1px solid #e3e0f0;border-radius:11px;padding:.7rem 2.2rem .7rem .85rem;cursor:pointer}
        .pc-sel select:focus{outline:none;border-color:#8b5cf6}
        .pc-caret{position:absolute;right:.75rem;top:50%;transform:translateY(-50%);color:#9aa0b0;pointer-events:none}
        /* two columns once the site is read: the prospect left, the slide library right */
        .pc-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 2.4rem;align-items:stretch}
        .pc-col{min-width:0}
        .pc-col-r{padding-top:1.1rem}
        .pc-sticky{position:sticky;top:.25rem;max-height:calc(100vh - 2.5rem);overflow-y:auto;padding:0 .3rem .5rem 0}
        @media(max-width:1000px){.pc-cols{grid-template-columns:1fr}.pc-col-r{padding-top:0}.pc-sticky{position:static;max-height:none;overflow:visible}}
        .pc-lib-top{display:flex;align-items:center;justify-content:space-between;gap:.6rem}
        .pc-lib-n{flex:0 0 auto;font-size:.72rem;font-weight:700;color:#4338ca;background:#f6f3ff;border-radius:999px;padding:.26rem .62rem;white-space:nowrap}
        .pc-deck{border:1px solid #e9e6f3;border-radius:14px;padding:.7rem .8rem;margin-top:.6rem;background:#fff}
        .pc-deck.has{border-color:#d6ccf5}
        .pc-deck-head{display:flex;align-items:center;gap:.7rem}
        .pc-deck-all{flex:0 0 auto;width:24px;height:24px;border-radius:7px;border:2px solid #d9d5ee;background:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;padding:0;transition:background .15s,border-color .15s}
        .pc-deck-all:hover{border-color:#6366f1}
        .pc-deck-all.on{background:#6366f1;border-color:#6366f1}
        .pc-deck-all.part{border-color:#6366f1}
        .pc-deck-dash{display:block;width:10px;height:3px;border-radius:2px;background:#6366f1}
        .pc-deck-title{flex:1;min-width:0;display:flex;align-items:center;gap:.6rem;background:none;border:0;padding:0;cursor:pointer;text-align:left;font:inherit;color:#0f1424}
        .pc-deck-title b{font-size:.92rem;white-space:nowrap}
        .pc-deck-title span{font-size:.76rem;color:#9aa0b0;font-weight:500;white-space:nowrap}
        .pc-deck-title svg{margin-left:auto;flex:0 0 auto;color:#9aa0b0;transition:transform .2s}
        .pc-deck-title svg.up{transform:rotate(180deg)}
        .pc-deck-blurb{margin:.55rem 0 .1rem;font-size:.78rem;color:#6b6f80;line-height:1.4}
        .pc-thumbs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.55rem .5rem;margin-top:.6rem}
        .pc-thumb{background:none;border:0;padding:0;cursor:pointer;text-align:left;font:inherit;min-width:0}
        .pc-thumb-img{position:relative;display:block;aspect-ratio:16/9;border-radius:9px;overflow:hidden;border:2px solid #ecebf5;background:#f3f2f8;transition:border-color .15s,transform .15s}
        .pc-thumb:hover .pc-thumb-img{transform:translateY(-1px);border-color:#c9bef1}
        .pc-thumb.on .pc-thumb-img{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.18)}
        .pc-thumb-img img{width:100%;height:100%;object-fit:cover;display:block}
        .pc-thumb-tick{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:#6366f1;color:#fff;font-size:.62rem;font-style:normal;font-weight:800;display:none;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2)}
        .pc-thumb.on .pc-thumb-tick{display:inline-flex}
        .pc-thumb-l{display:block;margin-top:.3rem;font-size:.7rem;font-weight:600;color:#4b5563;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pc-thumb.on .pc-thumb-l{color:#4338ca}
        .pc-thumb-sub{display:block;font-size:.64rem;color:#9aa0b0;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      `}</style>
    </>
  );
}
