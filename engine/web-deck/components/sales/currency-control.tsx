"use client";

/* Top-of-deck currency switcher. Picking a currency (a) converts the deck's own dollar
   figures in place, (b) tells every live product screen iframe to re-price itself by
   postMessage, (c) remembers the choice (localStorage + ?cur= in the deck URL) and (d) tells
   the page around the deck (the Presentations viewer bar) by postMessage. That page can also
   drive it: {type:"ppSetCur", cur:"AUD"}. Every text node keeps its BASE-currency text on a
   property and is re-derived from it on each pick, so switching never compounds, and a text
   node the Slide Editor runtime replaces later (saved edits) is simply picked up as base text
   on the next pass. Not rendered in the Slide Editor (?edit=1): the editor must see and save
   the base figures. */

import { useEffect, useRef } from "react";
import { useCurrency, CURRENCIES, SYM, isCur, convAmt, type Cur } from "./currency-ctx";

const AMT_RE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
const DATE_RE = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\b/g;
type BaseText = Text & { __ppBase?: string };
const isEdit = () => { try { return /[?&]edit=1/.test(window.location.search); } catch { return false; } };

export default function CurrencyControl() {
  const { cur, setCur, base } = useCurrency();
  const edit = useRef<boolean | null>(null);
  if (edit.current === null) edit.current = isEdit();

  // Convert a string, preserving each figure's original decimal places so prose like
  // "$18" doesn't become "$18.00". The AUD master also flips "20 Oct 2026" to US order for
  // a US audience; a deck written in USD keeps its dates as authored.
  const conv = (t: string, c: Cur) => {
    t = t.replace(AMT_RE, (m, num: string) => {
      const a = parseFloat(num.replace(/,/g, ""));
      if (isNaN(a)) return m;
      const dot = num.indexOf(".");
      const dec = dot >= 0 ? num.length - dot - 1 : 0;
      return SYM[c] + convAmt(a, c, base).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    });
    if (base !== "USD") t = t.replace(DATE_RE, (m, d: string, mo: string, y: string) => (c === "USD" ? `${mo} ${parseInt(d, 10)}, ${y}` : m));
    return t;
  };

  // Walk the deck's own text (iframes are separate documents and are never walked; the
  // interactive showcase .ms manages its own currency via context). A node converted before
  // carries its base text; a new node's current text IS its base text.
  const apply = (c: Cur) => {
    const root = document.querySelector(".pp") || document.body;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = (node as Text).parentElement;
        if (!p || p.closest(".sd-cur-ctl, .ms, script, style")) return NodeFilter.FILTER_REJECT;
        const n = node as BaseText;
        if (n.__ppBase !== undefined) return NodeFilter.FILTER_ACCEPT;
        const v = n.nodeValue || "";
        DATE_RE.lastIndex = 0;
        return v.indexOf("$") >= 0 || DATE_RE.test(v) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes: BaseText[] = [];
    let n: Node | null;
    while ((n = w.nextNode())) nodes.push(n as BaseText);
    for (const node of nodes) {
      if (node.__ppBase === undefined) node.__ppBase = node.nodeValue || "";
      const next = c === base ? node.__ppBase : conv(node.__ppBase, c);
      if (node.nodeValue !== next) node.nodeValue = next;
    }
    document.querySelectorAll<HTMLIFrameElement>("iframe.sales-cur-frame").forEach((f) => {
      try { f.contentWindow?.postMessage({ type: "setCurrency", cur: c }, "*"); } catch {}
      // lazy iframes that load later (off-screen slides) re-apply on load
      f.onload = () => { try { f.contentWindow?.postMessage({ type: "setCurrency", cur: c }, "*"); } catch {} };
    });
  };

  const announce = (c: Cur) => {
    try { if (window.parent !== window) window.parent.postMessage({ type: "ppCur", cur: c, base }, "*"); } catch {}
  };

  // always apply (idempotent): avoids a stale-closure skip when currencies are clicked fast
  const pick = (c: Cur, tell = true) => {
    setCur(c); apply(c);
    try { localStorage.setItem("ppCur", c); } catch {}
    try {
      const u = new URL(window.location.href);
      if (c === base) u.searchParams.delete("cur"); else u.searchParams.set("cur", c);
      history.replaceState(null, "", u);
    } catch {}
    if (tell) announce(c);
  };

  useEffect(() => {
    if (edit.current) return;
    // first choice: ?cur= on the deck URL (the viewer passes its own through), else this browser's last pick
    let want: Cur | null = null;
    try { const q = new URLSearchParams(window.location.search).get("cur"); if (isCur(q)) want = q; } catch {}
    if (!want) { try { const s = localStorage.getItem("ppCur"); if (isCur(s)) want = s; } catch {} }
    const onMsg = (e: MessageEvent) => {
      const d = (e.data || {}) as { type?: string; cur?: unknown };
      if (d.type === "ppSetCur" && isCur(d.cur)) pick(d.cur, false);
    };
    window.addEventListener("message", onMsg);
    if (want && want !== base) pick(want); else announce(base);
    // the Slide Editor runtime applies saved edits a moment after mount by replacing slide text;
    // once it has, run the conversion again so the edited words show the chosen currency too
    let tries = 0;
    const timer = window.setInterval(() => {
      const w = window as Window & { __ppEditsApplied?: number };
      if (w.__ppEditsApplied === 1 || ++tries > 60) {
        window.clearInterval(timer);
        if (w.__ppEditsApplied === 1) { let c: Cur = base; try { const s = new URLSearchParams(window.location.search).get("cur"); if (isCur(s)) c = s; } catch {} if (c !== base) apply(c); }
      }
    }, 150);
    return () => { window.removeEventListener("message", onMsg); window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (edit.current) return null;
  const order: Cur[] = [base, ...CURRENCIES.filter((c) => c !== base)];
  return (
    <div className="sd-cur-ctl" role="group" aria-label="Currency">
      {order.map((c) => (
        <button
          key={c}
          type="button"
          className={"sd-cur-pill" + (c === cur ? " on" : "")}
          onClick={() => pick(c)}
          aria-pressed={c === cur}
        >
          {c}
        </button>
      ))}
      <style>{`
        /* match the white Proposed/Current-style pill group and the other top controls */
        .sd-cur-ctl{display:inline-flex;align-items:center;gap:.15rem;padding:.22rem;border-radius:999px;
          background:rgba(255,255,255,.92);border:1px solid var(--border);box-shadow:var(--shadow-sm);
          backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
        .sd-cur-pill{appearance:none;border:0;cursor:pointer;font-family:var(--mono);font-size:.72rem;font-weight:700;
          letter-spacing:.05em;text-transform:uppercase;padding:7px 13px;border-radius:999px;color:#6b6f86;
          background:transparent;transition:all .25s var(--ease)}
        .sd-cur-pill:hover{color:var(--ink)}
        .sd-cur-pill.on{background:var(--grad);color:#fff;box-shadow:0 6px 16px -6px rgba(139,92,246,.6)}
      `}</style>
    </div>
  );
}
