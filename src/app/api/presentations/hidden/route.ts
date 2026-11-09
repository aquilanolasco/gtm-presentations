import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ownedDeck, readSpec, writeSpec, markReexport } from "@/server/engage/deck-access";

// Slide Editor: which slides of an engagement deck are hidden from the presentation. The ids are saved
// into the deck's spec.json (`hidden`); the template drops them from the sequence outside the editor,
// so Present, the public link and the exports never show them. The worker then refreshes the exports.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null) as { id?: string; hidden?: unknown } | null;
  if (!b?.id || !Array.isArray(b.hidden)) return NextResponse.json({ error: "id and hidden required" }, { status: 400 });
  const row = await ownedDeck(b.id, email);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.engine !== "engage") return NextResponse.json({ error: "only sales decks have hidden slides" }, { status: 400 });
  const hidden = b.hidden.filter((x): x is string => typeof x === "string" && /^[a-z0-9~-]{1,60}$/i.test(x) && x !== "cover").slice(0, 60);
  const spec = readSpec(row.slug);
  if (!spec) return NextResponse.json({ error: "deck files not found" }, { status: 404 });
  spec.hidden = hidden;
  try { writeSpec(row.slug, spec); } catch (e) { return NextResponse.json({ error: "could not save: " + String(e) }, { status: 500 }); }
  markReexport(row.id, row.slug, row.title);
  return NextResponse.json({ ok: true, hidden });
}
