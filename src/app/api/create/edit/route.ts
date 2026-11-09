import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

// Apply edits to an existing deck from the live builder. The client sends the (already edited) deck.json
// plus an optional AI op {slide, instruction} for Regenerate / the AI assistant. We spool it and flip the row to
// "editing"; the relay picks it up, re-renders the deck from the edited spec (running the AI op if present),
// re-exports and re-publishes in place. No DB migration: reuse the status column + a spool edit.json.
export const dynamic = "force-dynamic";
const SPOOL = "/var/www/presentation-spool";

export async function POST(req: NextRequest) {
  const session = await auth();
  const em = session?.user?.email;
  if (!em) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => null);
  if (!b?.id || !b?.deck?.slides?.length) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const [row] = await db.select().from(presentations).where(eq(presentations.id, b.id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.ownerEmail !== em) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (row.status === "processing") return NextResponse.json({ error: "busy" }, { status: 409 });

  const op = b.op && typeof b.op.slide === "number" && typeof b.op.instruction === "string"
    ? { slide: b.op.slide, instruction: b.op.instruction.slice(0, 2000) } : null;
  try {
    fs.mkdirSync(path.join(SPOOL, b.id), { recursive: true });
    fs.writeFileSync(path.join(SPOOL, b.id, "edit.json"), JSON.stringify({ deck: b.deck, op }));
  } catch (e) {
    return NextResponse.json({ error: "spool write failed: " + String(e) }, { status: 500 });
  }
  await db.update(presentations).set({ status: "editing", statusMsg: op ? "Updating a slide" : "Applying edits", updatedAt: new Date() })
    .where(eq(presentations.id, b.id));
  return NextResponse.json({ ok: true });
}
