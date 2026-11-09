"use client";

import { useEffect, useState } from "react";
import GenDeckClient from "./GenDeckClient";

// The generated-deck shell. Built ONCE (static), reused by every generated deck: at runtime it
// fetches ./spec.json (sitting next to it in /p/<slug>/) and renders those slides through the real
// master DeckShell. So every generated deck gets the master nav / rail / chrome, only text differs.
type Spec = { title?: string; slides: { type: string }[] };

export default function GenPage() {
  const [spec, setSpec] = useState<Spec | null>(null);
  useEffect(() => {
    fetch("./spec.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => { if (s?.slides?.length) { setSpec(s); if (s.title) document.title = s.title + " | Acme"; } else throw new Error("empty"); })
      .catch(() => setSpec({ slides: [{ type: "cover" }] }));
  }, []);
  if (!spec) return null;
  return <GenDeckClient spec={spec as Parameters<typeof GenDeckClient>[0]["spec"]} />;
}
