"use client";

/* Export / share controls shown inside a deck's top-right rail (present mode only — the
   whole rail is hidden when the deck is embedded in the app preview or the public viewer).
   Slug is the deck folder; exports are served (authed) at /presentation-exports/<slug>/ and
   the public link is /p/<slug>. */

import { useState } from "react";

export default function DeckExports({ slug }: { slug: string; canva?: string }) {
  const [copied, setCopied] = useState(false);
  const share = `https://${process.env.NEXT_PUBLIC_APP_DOMAIN ?? "app.example.com"}/p/${slug}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(share); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };
  return (
    <>
      <a className="v2-ctl" href={`/presentation-exports/${slug}/${slug}.pptx`} download title="Download as PowerPoint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" /></svg>
        <span>PPTX</span>
      </a>
      <a className="v2-ctl" href={`/presentation-exports/${slug}/${slug}.pdf`} download title="Download as PDF">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" /></svg>
        <span>PDF</span>
      </a>
      <button className="v2-ctl" onClick={copy} title="Copy public share link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" /></svg>
        <span>{copied ? "Copied" : "Share"}</span>
      </button>
    </>
  );
}
