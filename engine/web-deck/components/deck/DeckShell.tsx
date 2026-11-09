"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { asset } from "@/lib/asset";
import "./deck.css";

export type Section = { id: string; label: string; dark?: boolean; sub?: boolean };

/* Slide Editor controls in the left nav (engagement decks opened with ?edit=1): an eye before each
   name hides / shows that slide in the presentation, and a + between names adds a slide after it.
   The deck page owns the state and tells the GTM app (its parent window) what changed. */
export type EditNav = {
  hidden: string[];
  onToggleHidden: (id: string) => void;
  onAdd: (afterId: string, afterLabel: string) => void;
  /* a master slide, as edited in this deck, can be kept as a Saved slide (a bookmark at the row's end) */
  canSave?: (id: string) => boolean;
  onSave?: (id: string, label: string) => void;
};

const SaveIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.6" />
    {off && <path d="M4 4l16 16" strokeWidth="2.2" />}
  </svg>
);

// Proposed/Current mode is owned by DeckShell but the switch UI is rendered by the
// page inside the top-right control cluster — this context bridges the two.
type DeckMode = "proposed" | "current";
export const DeckModeCtx = createContext<{ mode: DeckMode; setMode: (m: DeckMode) => void }>({ mode: "current", setMode: () => {} });
export const useDeckMode = () => useContext(DeckModeCtx);

/* Proposed / Current design switch — swaps the product screenshots only. Rendered by
   the page inside .v2-topctl so it sits beside Full screen / Presentations. */
/* The Proposed/Current toggle is retired: every deck now ships only the current
   (live) UI, so this renders nothing. Kept as a no-op so the existing <ModeSwitch />
   imports across all decks stay valid without editing each page. */
export function ModeSwitch() {
  return null;
}

/* Full-screen toggle whose label/icon flips to "Windowed" while in full screen. */
export function FullscreenToggle() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const d = document as Document & { webkitFullscreenElement?: Element };
    const sync = () => setFs(!!(d.fullscreenElement || d.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    sync();
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);
  const toggle = () => {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen)?.call(document); }
    else { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); }
  };
  return (
    <button className="v2-ctl" aria-label={fs ? "Exit full screen" : "Enter full screen"} onClick={toggle}>
      {fs ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
      )}
      <span>{fs ? "Windowed" : "Full screen"}</span>
    </button>
  );
}

type Bg = "light" | "grad" | "dark";

export function DeckShell({ sections, logo = asset("/brand/logo-placeholder.svg"), modGradLogo = false, edit, children }: { sections: Section[]; logo?: string; modGradLogo?: boolean; edit?: EditNav; children: React.ReactNode }) {
  const deckRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // Background actually behind the top-left logo vs the vertically-centred chrome
  // (sidenav / rail / arrows). Each cross-fades independently as its own region
  // scrolls over a new background, so the logo only changes once it is fully over it.
  const [logoBg, setLogoBg] = useState<Bg>("light");
  const [navBg, setNavBg] = useState<Bg>("light");
  // slides tagged .pp-hide-logo fade the top-left lockup out (e.g. the closing
  // slide, which shows its own centred vertical logo instead)
  const [hideLogo, setHideLogo] = useState(false);
  // Per-module background: a slide can carry data-mg="<css gradient>". Two planes hold the
  // current and incoming module gradient so scrolling from one module to the next CROSS-FADES
  // colour to colour (a single plane would snap). null = no module active (fall back to the
  // brand grad / dark / white planes).
  const [modA, setModA] = useState("");
  const [modB, setModB] = useState("");
  const [modOn, setModOn] = useState<0 | 1 | null>(null);
  const modSlot = useRef<0 | 1>(1);
  const modShown = useRef("");

  // When the deck is embedded (the Presentations preview iframe) we hide the top-right
  // "Full screen" / "Presentations" controls: clicking "Presentations" inside the preview
  // just reloaded the hub in the pane (a loop). They only make sense in real present mode
  // (the deck opened top-level in its own tab), so show them only when NOT in an iframe.
  useEffect(() => {
    try { if (window.top !== window.self) document.documentElement.setAttribute("data-embed", "1"); } catch { document.documentElement.setAttribute("data-embed", "1"); }
  }, []);

  // Arrow-key navigation needs THIS window to hold keyboard focus. When the deck is
  // embedded (the hub preview or the /p/<slug>/ wrapper), the parent page holds focus on
  // load, so ArrowDown scrolls the parent instead of advancing a slide. Grab focus on load
  // and whenever the pointer is over the deck, so the arrows drive the deck in every context
  // (top-level tab, wrapper, or hub iframe). window.focus() when already focused is a no-op,
  // and pointermove never fires over the live product iframe, so this never fights it.
  useEffect(() => {
    const grab = () => { try { window.focus(); } catch { /* focus can throw when cross-origin embedded */ } };
    grab();
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", grab, opts);
    window.addEventListener("pointermove", grab, opts);
    return () => { window.removeEventListener("pointerdown", grab); window.removeEventListener("pointermove", grab); };
  }, []);

  // Reveal is opt-in: slide content is visible by default (so nothing is blank while the
  // JS loads). We "arm" the reveal animation only after mount, and tell the pre-hydration
  // keyboard handler (in layout.tsx) to hand navigation over to React.
  useEffect(() => {
    (window as unknown as { __ppReactNav?: boolean }).__ppReactNav = true;
    const id = requestAnimationFrame(() => deckRef.current?.closest(".pp")?.setAttribute("data-armed", "1"));
    return () => { cancelAnimationFrame(id); (window as unknown as { __ppReactNav?: boolean }).__ppReactNav = false; };
  }, []);
  // "Proposed" (the redesign) vs "Current" (the real product app today).
  // Defaults to Current on every load/refresh so the deck opens on the real app;
  // toggling only swaps each product screenshot's src — no layout/animation changes,
  // so Proposed mode remains byte-for-byte the existing deck.
  const [mode, setMode] = useState<"proposed" | "current">("current");
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    deck.querySelectorAll<HTMLImageElement>("img[data-cur]").forEach((img) => {
      if (!img.dataset.proposed) img.dataset.proposed = img.getAttribute("src") || "";
      const next = mode === "current" ? img.dataset.cur! : img.dataset.proposed!;
      if (img.getAttribute("src") !== next) img.setAttribute("src", next);
    });
    // Only the platform tablet (#dashFrame) is interactive, so only its iframe loads.
    // Module slides keep their original 3D device showing the current-design poster.
    if (mode === "current") {
      const f = deck.querySelector<HTMLIFrameElement>("#dashFrame iframe.cur-frame");
      if (f && !f.getAttribute("src") && f.dataset.html) f.setAttribute("src", f.dataset.html);
    }
  }, [mode]);

  // ===== Content fit (OPT-IN ONLY) =====
  // Scale a slide's content block down uniformly so everything inside shrinks together
  // and the slide fits one screen. This is opt-in per slide via `data-fit` — a blanket
  // rule is WRONG, because slides like the hero have intentionally oversized decorative
  // art (a 150vh emblem) whose natural height reads as overflow and gets wrongly shrunk.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const fit = () => {
      deck.querySelectorAll<HTMLElement>(".pp-slide[data-fit]").forEach((slide) => {
        const inner = slide.querySelector<HTMLElement>(":scope > .pp-inner");
        if (!inner) return;
        inner.style.transform = "none";
        inner.style.height = "auto";
        const cs = getComputedStyle(slide);
        const padT = parseFloat(cs.paddingTop) || 0;
        const padB = parseFloat(cs.paddingBottom) || 0;
        const avail = window.innerHeight - padT - padB;
        const nat = inner.scrollHeight;
        if (nat <= avail + 2) return;           // already fits — don't touch it
        const s = Math.max(0.4, avail / nat);
        inner.style.transformOrigin = "top center";
        inner.style.transform = `scale(${s})`;
        inner.style.height = `${nat * s}px`;    // keep layout in step with the visual size
      });
    };
    fit();
    const t1 = setTimeout(fit, 300), t2 = setTimeout(fit, 1000), t3 = setTimeout(fit, 2200);
    window.addEventListener("resize", fit);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); window.removeEventListener("resize", fit); };
  }, [mode]);

  // Which background sits at a given viewport Y. Dark/gradient slides only "count"
  // past their edge-fade zone, so chrome flips only when truly over the new colour.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const slides = Array.from(deck.querySelectorAll<HTMLElement>(".pp-slide"));
    const typeOf = (s: HTMLElement): Bg => {
      const c = s.className;
      if (c.includes("pp-grad")) return "grad";
      if (c.includes("neb-slide") || c.includes("glow-slide") || c.includes("msl-dk")) return "dark";
      // sales decks only (opt-in): a per-module gradient slide (data-mg) is a coloured ground, so
      // the top-left logo + chrome flip fully white. Other decks pass no flag, so they are untouched.
      if (modGradLogo && s.getAttribute("data-mg")) return "grad";
      return "light";
    };
    // each colour slide's actual top edge-fade height (matches the CSS) — chrome flips
    // to that colour only once its SOLID region reaches the element, i.e. past the fade
    const topFade = (s: HTMLElement): number => {
      const c = s.className;
      if (c.includes("neb-slide")) return 40;
      if (c.includes("glow-slide")) return 200;
      if (c.includes("pp-grad-top")) return 150;
      return 0;
    };
    // Walk top->bottom; the lowest slide whose solid zone has begun above y wins.
    // isTop = the top-left logo (no early light flip); otherwise the centred chrome,
    // which returns to light 200px early so it flows as the slide above fades to white.
    const bgAt = (y: number, isTop: boolean): Bg => {
      let t: Bg = "light";
      for (const s of slides) {
        const r = s.getBoundingClientRect();
        const ty = typeOf(s);
        const solidTop = ty === "light" ? r.top - (isTop ? 0 : 200) : r.top + topFade(s);
        if (solidTop <= y) t = ty;
      }
      return t;
    };
    // Only measure when the page has actually scrolled (or resized). The per-frame
    // read of scrollY is free; the layout-reading bgAt() runs only on real movement,
    // so an idle deck costs nothing.
    let alive = true;
    let raf = 0;
    let lastL: Bg | "" = "";
    let lastN: Bg | "" = "";
    let lastY = -1;
    let lastH = -1;
    let lastA = -1;
    let lastHide = false;
    const loop = () => {
      if (!alive) return;
      const y = window.scrollY;
      const h = window.innerHeight;
      if (y !== lastY || h !== lastH) {
        lastY = y; lastH = h;
        const lb = bgAt(56, false);
        const nb = bgAt(h / 2, false);
        if (lb !== lastL) { lastL = lb; setLogoBg(lb); }
        if (nb !== lastN) { lastN = nb; setNavBg(nb); }
        // active section from geometry (the slide containing the viewport middle):
        // IntersectionObserver entry ordering desyncs on fast upward jumps, this can't
        let ai = 0;
        for (let i = 0; i < slides.length; i++) {
          if (slides[i].getBoundingClientRect().top <= h / 2) ai = i;
        }
        if (ai !== lastA) {
          lastA = ai;
          setActive(ai);
          // guarantee the slide at the viewport centre is revealed, even if the
          // IntersectionObserver misses it (e.g. a slide taller than the viewport, or a
          // direct jump), so its content is never left invisible
          slides[ai]?.classList.add("in");
          if (barRef.current) barRef.current.style.transform = `scaleX(${(ai + 1) / slides.length})`;
        }
        // per-module gradient: cross-fade to the active slide's data-mg (if any)
        const mg = slides[ai]?.getAttribute("data-mg") || "";
        if (mg !== modShown.current) {
          modShown.current = mg;
          if (!mg) { setModOn(null); }
          else {
            const slot: 0 | 1 = modSlot.current === 0 ? 1 : 0;
            modSlot.current = slot;
            if (slot === 0) setModA(mg); else setModB(mg);
            setModOn(slot);
          }
        }
        // hide the top-left logo while a .pp-hide-logo slide sits under it
        let logoSlide: HTMLElement | null = null;
        for (const s of slides) { const r = s.getBoundingClientRect(); if (r.top <= 80 && r.bottom > 80) logoSlide = s; }
        const hide = !!(logoSlide && logoSlide.classList.contains("pp-hide-logo"));
        if (hide !== lastHide) { lastHide = hide; setHideLogo(hide); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
    // modGradLogo is a constant prop read once when the detection loop is set up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const slides = Array.from(deck.querySelectorAll<HTMLElement>(".pp-slide"));
    // reveal-on-enter, re-armed on exit so every slide-to-slide transition animates
    const ioReveal = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          // reveal the first fragment on enter so the slide is never empty;
          // the presenter steps the rest in with Down/Right (see onKey below)
          // reveal EVERY fragment on entry (lightly staggered) so the whole slide is
          // visible — the arrow keys are for moving between slides, not stepping content
          const frags = e.target.querySelectorAll<HTMLElement>(".frag");
          frags.forEach((f, fi) => setTimeout(() => f.classList.add("frag-in"), 90 + fi * 110));
        } else {
          e.target.classList.remove("in");
          // reset fragments so the reveal replays next time this slide is reached
          e.target.querySelectorAll<HTMLElement>(".frag.frag-in").forEach((f) => f.classList.remove("frag-in"));
        }
      }),
      { root: null, threshold: 0.15 }
    );
    // (active-section tracking lives in the scroll rAF loop above: geometry-based,
    // immune to IntersectionObserver entry-ordering desyncs on fast jumps)
    slides.forEach((s) => { ioReveal.observe(s); });

    const onKey = (ev: KeyboardEvent) => {
      const right = ev.key === "ArrowRight";
      const left = ev.key === "ArrowLeft";
      const fwd = ["ArrowDown", " ", "PageDown"].includes(ev.key) || right;
      const back = ["ArrowUp", "PageUp"].includes(ev.key) || left;
      if (!fwd && !back) return;
      // Slides that carry their own stepper (the module showcase, for example) take
      // Left/Right for that, so the presenter can move inside the slide. Up/Down
      // always move between slides.
      if (right || left) {
        const h0 = window.innerHeight;
        let at = 0;
        for (let i = 0; i < slides.length; i++) if (slides[i].getBoundingClientRect().top <= h0 / 2) at = i;
        const inner = slides[at]?.querySelector<HTMLElement>(right ? "[data-nav-next]" : "[data-nav-prev]");
        if (inner) { ev.preventDefault(); inner.click(); return; }
      }
      ev.preventDefault();
      // Down / Right / Space / PageDown => next slide.  Up / Left / PageUp => previous.
      // Arrows never step content: every fragment is revealed on slide entry instead.
      // Read the current slide from geometry rather than the `active` state, which can
      // still be catching up right after a keypress and would send the deck the wrong way.
      const h = window.innerHeight;
      let cur = 0;
      for (let i = 0; i < slides.length; i++) if (slides[i].getBoundingClientRect().top <= h / 2) cur = i;
      go(fwd ? cur + 1 : cur - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => { ioReveal.disconnect(); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Reflect the active slide in the URL so every slide has its own shareable link, and the
  // left-nav click changes the address. On load, deep-link to the slide named in the hash.
  useEffect(() => {
    const sec = sections[active];
    if (sec) { try { history.replaceState(null, "", "#" + sec.id); } catch {} }
  }, [active, sections]);
  useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!h) return;
    const i = sections.findIndex((s) => s.id === h);
    if (i > 0) { const t = setTimeout(() => go(i), 450); return () => clearTimeout(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(i: number) {
    const deck = deckRef.current;
    if (!deck) return;
    const slides = deck.querySelectorAll<HTMLElement>(".pp-slide");
    const n = Math.max(0, Math.min(slides.length - 1, i));
    const el = slides[n];
    if (!el) return;
    // controlled, consistent-speed scroll — snappier than the browser's native
    // smooth scroll, which slows to a crawl over long / heavy pages
    const startY = window.scrollY;
    const dist = el.getBoundingClientRect().top; // distance from current position to the slide
    if (Math.abs(dist) < 2) return;
    const dur = 460;
    const t0 = performance.now();
    const ease = (p: number) => 1 - Math.pow(1 - p, 3);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      // behavior:"instant" is essential: the page has CSS scroll-behavior:smooth,
      // and a plain scrollTo() every frame restarts a smooth animation at zero
      // velocity — the scroll never moves and the deck reads as "stuck".
      window.scrollTo({ top: startY + dist * ease(p), behavior: "instant" as ScrollBehavior });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return (
    <DeckModeCtx.Provider value={{ mode, setMode }}>
    <div className="pp" data-logobg={logoBg} data-navbg={navBg} data-mode={mode}>
      {/* Slide backgrounds live on ONE fixed layer stack so a colour change cross-fades
          (fade out / fade in) instead of scrolling past as a hard horizontal edge.
          Base is white; the gradient and dark planes fade their opacity as the active
          background changes. Slides themselves are transparent (see deck.css). */}
      <div className="pp-bgfade" aria-hidden="true">
        <div className={`ppbg ppbg-grad${navBg === "grad" ? " on" : ""}`} />
        <div className={`ppbg ppbg-dark${navBg === "dark" ? " on" : ""}`} />
        {/* module gradient planes sit on top and cross-fade between module colours */}
        <div className={`ppbg ppbg-mod${modOn === 0 ? " on" : ""}`} style={modA ? { background: modA } : undefined} />
        <div className={`ppbg ppbg-mod${modOn === 1 ? " on" : ""}`} style={modB ? { background: modB } : undefined} />
      </div>
      <div className="pp-progress" ref={barRef} style={{ transform: "scaleX(0.02)" }} />

      <nav className={`pp-sidenav${sections.length > 15 ? " pp-sidenav--dense" : ""}`} aria-label="Sections">
        {/* logo cross-fades between three lockups depending on the background behind it:
            colour emblem + dark word (white bg), colour emblem + white word (dark bg),
            fully white (gradient bg). */}
        <span className="pp-logo-stack" aria-label="Acme" style={{ opacity: hideLogo ? 0 : 1, transition: "opacity .55s var(--ease)" }}>
          <img className="lo lo-color" src={logo} alt="Acme" />
          {/* reversed + all-white lockups: point these at your own logo variants */}
          <img className="lo lo-rev" src={asset("/brand/logo-placeholder.svg")} alt="" aria-hidden="true" />
          <img className="lo lo-white" src={asset("/brand/logo-placeholder.svg")} alt="" aria-hidden="true" />
        </span>
        {sections.map((s, i) => {
          if (s.sub) return null; // sub-slides live under the previous chapter
          // chapter is active while any of its sub-slides is the current slide
          let end = i + 1;
          while (end < sections.length && sections[end].sub) end++;
          const on = active >= i && active < end;
          const item = (
            <button key={s.id} className={`pp-sidenav__item ${on ? "on" : ""}`} onClick={() => go(i)}>
              <span className="bar" />
              <span>{s.label}</span>
            </button>
          );
          if (!edit) return item;
          const off = edit.hidden.includes(s.id);
          const canHide = s.id !== "cover";
          return (
            <div key={s.id} className={`pp-nav-row${off ? " off" : ""}`}>
              <button
                type="button" className="pp-nav-eye" disabled={!canHide}
                title={!canHide ? "The cover is always shown" : off ? "Show this slide in the presentation" : "Hide this slide from the presentation"}
                aria-label={off ? `Show ${s.label}` : `Hide ${s.label}`}
                onClick={() => edit.onToggleHidden(s.id)}
              ><EyeIcon off={off} /></button>
              {item}
              {edit.onSave && edit.canSave?.(s.id) && (
                <button type="button" className="pp-nav-save" title="Save this slide, as edited here, to your Saved slides" aria-label={`Save ${s.label} to your Saved slides`} onClick={() => edit.onSave!(s.id, s.label)}><SaveIcon /></button>
              )}
              {i < sections.length - 1 && (
                <button type="button" className="pp-nav-add" title={`Add a slide after ${s.label}`} aria-label={`Add a slide after ${s.label}`} onClick={() => edit.onAdd(s.id, s.label)}>+</button>
              )}
            </div>
          );
        })}
        {edit && (
          <style>{`
            .pp-nav-row{position:relative;display:flex;align-items:center;pointer-events:auto}
            .pp-nav-row .pp-sidenav__item{flex:1 1 auto}
            .pp-nav-row.off .pp-sidenav__item span:last-child{text-decoration:line-through;opacity:.45}
            .pp-nav-eye{position:absolute;left:1rem;top:50%;transform:translateY(-50%);width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--muted,#8b83a8);cursor:pointer;padding:0;z-index:2;opacity:.55;transition:opacity .2s,color .2s,background .2s}
            .pp-nav-row:hover .pp-nav-eye,.pp-nav-row.off .pp-nav-eye{opacity:1}
            .pp-nav-eye:hover{color:#8b5cf6;background:rgba(139,92,246,.12)}
            .pp-nav-row.off .pp-nav-eye{color:#8b5cf6}
            .pp-nav-eye:disabled{opacity:.18;cursor:default}
            .pp[data-navbg="grad"] .pp-nav-eye,.pp[data-navbg="dark"] .pp-nav-eye{color:rgba(255,255,255,.75)}
            .pp-nav-add{position:absolute;left:4rem;bottom:-12px;width:22px;height:22px;border-radius:50%;border:0;background:linear-gradient(135deg,#8b5cf6,#8b5cf6,#3b82f6);color:#fff;font:700 15px/1 Inter,system-ui,sans-serif;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0 0 1px;z-index:3;opacity:0;transform:scale(.7);transition:opacity .18s,transform .18s;box-shadow:0 6px 16px rgba(139,92,246,.35)}
            .pp-nav-row:hover .pp-nav-add,.pp-nav-add:focus-visible{opacity:1;transform:scale(1)}
            .pp-nav-add:hover{filter:brightness(1.08)}
            .pp-sidenav--dense .pp-nav-add{left:2.5rem;width:18px;height:18px;font-size:12px;bottom:-9px}
            .pp-sidenav--dense .pp-nav-eye{left:.5rem;width:18px;height:18px}
            .pp-nav-save{position:absolute;right:.35rem;top:50%;transform:translateY(-50%);width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--muted,#8b83a8);cursor:pointer;padding:0;z-index:2;opacity:0;transition:opacity .2s,color .2s,background .2s}
            .pp-nav-row:hover .pp-nav-save,.pp-nav-save:focus-visible{opacity:1}
            .pp-nav-save:hover{color:#8b5cf6;background:rgba(139,92,246,.12)}
            .pp[data-navbg="grad"] .pp-nav-save,.pp[data-navbg="dark"] .pp-nav-save{color:rgba(255,255,255,.75)}
            .pp-sidenav--dense .pp-nav-save{width:18px;height:18px;right:.15rem}
          `}</style>
        )}
      </nav>

      <div className="pp-slidenum" aria-label="Slide number">{String(active + 1).padStart(2, "0")} / {String(sections.length).padStart(2, "0")}</div>

      <button className={`pp-arrow up${sections.length > 15 ? " dense" : ""}`} aria-label="Previous" onClick={() => go(active - 1)}>↑</button>
      <div className={`pp-rail${sections.length > 15 ? " dense" : ""}`} aria-label="Slides">
        {sections.map((s, i) => (
          <button key={s.id} className={i === active ? "on" : ""} aria-label={s.label} onClick={() => go(i)} />
        ))}
      </div>
      <button className={`pp-arrow down${sections.length > 15 ? " dense" : ""}`} aria-label="Next" onClick={() => go(active + 1)}>↓</button>

      <div className="pp-deck" ref={deckRef}>{children}</div>
    </div>
    </DeckModeCtx.Provider>
  );
}

/* Count-up number, fires when its slide gets .in */
export function Counter({ to, prefix = "", suffix = "", decimals = 0, group = false }: { to: number; prefix?: string; suffix?: string; decimals?: number; group?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const slide = el.closest(".pp-slide");
    if (!slide) return;
    let started = false;
    const tick = () => {
      if (started || !slide.classList.contains("in")) return;
      started = true;
      const t0 = performance.now(), dur = 1300;
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        setV(to * e);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const mo = new MutationObserver(tick);
    mo.observe(slide, { attributes: true, attributeFilter: ["class"] });
    tick();
    return () => mo.disconnect();
  }, [to]);
  let s = decimals ? v.toFixed(decimals) : Math.round(v).toString();
  if (group) { const p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = p.join("."); }
  return <span ref={ref}>{prefix}{s}{suffix}</span>;
}
