import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import fs from "node:fs";
import path from "node:path";
import { isSuperAdmin, PUBLIC, SPOOL } from "@/server/engage/deck-access";

/* The Saved slides (see save-slide/route.ts): GET lists them (yours; the super admin sees everyone's),
   newest first, with the thumbnail once the worker has captured it; DELETE removes one (its owner, or
   the super admin). */
export const dynamic = "force-dynamic";
const SAVED = path.join(PUBLIC, "_saved");

type Rec = { id: string; name: string; base: string; label: string; deck: string; deckTitle: string; from: { id: string; slug: string; title: string; sid: string }; edits?: Record<string, unknown>; owner: string; ownerName: string; createdAt: string };

function list(): Rec[] {
  let files: string[] = [];
  try { files = fs.readdirSync(SAVED).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out: Rec[] = [];
  for (const f of files) {
    try { const r = JSON.parse(fs.readFileSync(path.join(SAVED, f), "utf8")) as Rec; if (r && r.id && r.base) out.push(r); } catch { /* skip a broken file */ }
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const real = session?.user?.email?.toLowerCase();
  if (!real) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // "View as" (the x-pp-view-as header the app sends while the super admin previews another person):
  // the list is then that person's, read-only, exactly as the tRPC context does it
  const viewAs = req.headers.get("x-pp-view-as")?.trim().toLowerCase() || "";
  const email = viewAs && isSuperAdmin(real) && viewAs !== real ? viewAs : real;
  const admin = isSuperAdmin(email);
  const rows = list().filter((r) => admin || r.owner === email).map((r) => ({
    id: r.id, name: r.name, base: r.base, label: r.label, deck: r.deck, deckTitle: r.deckTitle, from: r.from,
    owner: r.owner, ownerName: r.ownerName, createdAt: r.createdAt, mine: r.owner === email,
    editCount: Object.keys(r.edits || {}).length,
    thumb: fs.existsSync(path.join(SAVED, `${r.id}.webp`)) ? `/p/_saved/${r.id}.webp` : null,
  }));
  return NextResponse.json({ saved: rows, admin });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null) as { id?: string } | null;
  const id = String(b?.id || "");
  if (!/^[a-z0-9]{4,16}$/.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const file = path.join(SAVED, `${id}.json`);
  let rec: Rec | null = null;
  try { rec = JSON.parse(fs.readFileSync(file, "utf8")) as Rec; } catch { rec = null; }
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (rec.owner !== email && !isSuperAdmin(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    fs.rmSync(file, { force: true }); fs.rmSync(path.join(SAVED, `${id}.webp`), { force: true });
    // and the worker's pending thumbnail job, if it has not got to it yet
    fs.rmSync(path.join(SPOOL, "_saved", `${id}.json`), { force: true });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
