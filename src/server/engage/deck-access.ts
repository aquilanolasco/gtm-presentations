import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

// Shared helpers for the Slide Editor's server side (words / sizes / photos patch, hidden slides, added
// slides, re-exports). A generated deck lives OUTSIDE the app: /var/www/presentation-public/<slug>/deck/
// holds index.html (the shared engage template), spec.json (the deck's content + the editor's structure
// layer: hidden ids and added slides), edits.json (the words / size / photo patch) and the images.
export const PUBLIC = "/var/www/presentation-public";
export const SPOOL = "/var/www/presentation-spool";

// The workspace owner: a company-domain address whose local part matches the owner's name (with or
// without a separator). Same rule as the Presentations page's client-side gate. Sample identity:
// the real domain and owner handle were replaced with example values.
export function isSuperAdmin(email?: string | null) {
  if (!email) return false;
  const e = email.toLowerCase();
  return e.endsWith("@example.com") && /jane[._-]?doe/.test(e);
}

/* The deck row when `email` may edit it (its owner, or the super admin), else null. */
export async function ownedDeck(id: string, email: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(presentations).where(eq(presentations.id, id)).limit(1);
  if (!row) return null;
  if (row.ownerEmail.toLowerCase() !== email.toLowerCase() && !isSuperAdmin(email)) return null;
  return row;
}

export const deckDir = (slug: string) => path.join(PUBLIC, slug, "deck");

export type DeckSpec = Record<string, unknown> & { hidden?: string[]; extra?: { after: string; slide: { id: string; label?: string } }[] };

export function readSpec(slug: string): DeckSpec | null {
  try { return JSON.parse(fs.readFileSync(path.join(deckDir(slug), "spec.json"), "utf8")) as DeckSpec; } catch { return null; }
}

/* Writes spec.json, keeping the engine's original next to it (spec.original.json) the first time the
   editor touches the deck, so the generated version is never lost. */
export function writeSpec(slug: string, spec: DeckSpec) {
  const dir = deckDir(slug);
  const file = path.join(dir, "spec.json"), orig = path.join(dir, "spec.original.json");
  if (fs.existsSync(file) && !fs.existsSync(orig)) fs.copyFileSync(file, orig);
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
}

/* Asks the engage worker to rebuild the PowerPoint, PDF and thumbnail from the deck as it now reads.
   The marker is rewritten on every save; the worker waits until it has been quiet for a moment. */
export function markReexport(id: string, slug: string, title?: string | null) {
  try {
    fs.mkdirSync(path.join(SPOOL, id), { recursive: true });
    fs.writeFileSync(path.join(SPOOL, id, "reexport.json"), JSON.stringify({ id, slug, title: title || "", at: Date.now() }));
  } catch { /* the spool lives on the VPS only; local dev has none */ }
}
