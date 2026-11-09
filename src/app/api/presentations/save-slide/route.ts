import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ownedDeck, PUBLIC, SPOOL } from "@/server/engage/deck-access";
import LIB from "@/lib/engage-library.json";

/* Slide Editor "Save this slide": a master slide (from the slide library, or the Short Pack), as the rep
   edited it in a sales deck (its words, text sizes, photos and hidden items), kept as a Saved slide:
   /var/www/presentation-public/_saved/<id>.json. Saved slides are listed under Presentations > Slides
   and offered in the Create pane's picker; picking one puts "<base>~<id>" into the new deck's body and
   the worker carries the patch into that deck's edits.json. The worker also captures a thumbnail from the
   source deck (spool marker in presentation-spool/_saved/). No database: the file is the record. */
export const dynamic = "force-dynamic";
const SAVED = path.join(PUBLIC, "_saved");
const LIB_LABEL: Record<string, { label: string; deck: string; deckTitle: string }> = {};
for (const d of LIB.decks) for (const s of d.slides) LIB_LABEL[s.sid] = { label: s.label, deck: d.id, deckTitle: d.title };

export type SavedSlide = {
  id: string; name: string; base: string; label: string; deck: string; deckTitle: string;
  from: { id: string; slug: string; title: string; sid: string };
  edits: Record<string, unknown>; owner: string; ownerName: string; createdAt: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null) as { id?: string; sid?: string; name?: string } | null;
  if (!b?.id || !b.sid) return NextResponse.json({ error: "id and sid required" }, { status: 400 });
  const row = await ownedDeck(b.id, email);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.engine !== "engage") return NextResponse.json({ error: "only sales decks have saved slides" }, { status: 400 });
  const sid = String(b.sid);
  if (!/^[a-z0-9-]+(~[a-z0-9]{4,16})?$/.test(sid)) return NextResponse.json({ error: "bad slide id" }, { status: 400 });
  const base = sid.split("~")[0];
  const lib = LIB_LABEL[base];
  if (!lib) return NextResponse.json({ error: "Only master slides can be saved. The opening slides are written for this prospect." }, { status: 400 });
  const name = String(b.name || lib.label).replace(/\s+/g, " ").trim().slice(0, 60) || lib.label;

  // the slide's part of the deck's patch, re-keyed to the master slide's id
  const all = (row.edits && typeof row.edits === "object" ? row.edits : {}) as Record<string, unknown>;
  const edits: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) {
    const m = k.match(/^([tixb])(.+)\.(\d+)$/);
    if (m && m[2] === sid && v && typeof v === "object") edits[`${m[1]}${base}.${m[3]}`] = v;
  }
  const id = crypto.randomBytes(5).toString("hex");
  const rec: SavedSlide = {
    id, name, base, label: lib.label, deck: lib.deck, deckTitle: lib.deckTitle,
    from: { id: row.id, slug: row.slug, title: row.title, sid },
    edits, owner: email.toLowerCase(), ownerName: session?.user?.name || email, createdAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(SAVED, { recursive: true });
    fs.writeFileSync(path.join(SAVED, `${id}.json`), JSON.stringify(rec, null, 2));
    // the worker captures the slide as it reads in this deck for the thumbnail
    fs.mkdirSync(path.join(SPOOL, "_saved"), { recursive: true });
    fs.writeFileSync(path.join(SPOOL, "_saved", `${id}.json`), JSON.stringify({ id, slug: row.slug, sid, at: Date.now() }));
  } catch (e) { return NextResponse.json({ error: "could not save: " + String(e) }, { status: 500 }); }
  return NextResponse.json({ ok: true, saved: { ...rec, edits: undefined, editCount: Object.keys(edits).length } });
}
