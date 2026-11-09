import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq, and, asc, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";
function authed(req: NextRequest) {
  const s = process.env.RELAY_SECRET;
  if (!s) return false;
  return (req.headers.get("x-relay-secret") || new URL(req.url).searchParams.get("secret")) === s;
}
// Two consumers poll this: the Mac relay (Create-with-Claude decks, engine "claude"/"gamma") and the
// VPS engage worker (?engine=engage, prospect sales decks). Each only ever receives its own kind of job.
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const wantEngine = new URL(req.url).searchParams.get("engine");
  const engineFilter = wantEngine === "engage" ? eq(presentations.engine, "engage") : ne(presentations.engine, "engage");
  // edits are picked up FIRST (the live builder should feel snappy), then new generations. For engage
  // decks an "editing" row is a Slide Editor "add a slide" request (its brief sits in the spool).
  let row: typeof presentations.$inferSelect | undefined;
  let isEdit = false;
  [row] = await db.select().from(presentations)
    .where(and(eq(presentations.status, "editing"), engineFilter)).orderBy(asc(presentations.updatedAt)).limit(1);
  isEdit = !!row;
  if (!row) {
    [row] = await db.select().from(presentations)
      .where(and(eq(presentations.status, "generating"), engineFilter)).orderBy(asc(presentations.createdAt)).limit(1);
  }
  if (!row) return NextResponse.json({ job: null });
  await db.update(presentations).set({ status: "processing", statusMsg: isEdit ? "Applying edits" : "Generating",
    progress: { stage: isEdit ? "edit" : "read", log: [isEdit ? "Applying your edits…" : (row.engine === "engage" ? "Picked up your prospect…" : "Picked up your file…")] }, updatedAt: new Date() })
    .where(and(eq(presentations.id, row.id), eq(presentations.status, isEdit ? "editing" : "generating")));
  const ext = (row.sourceFile?.split(".").pop() || "pdf").toLowerCase();
  return NextResponse.json({ job: { id: row.id, title: row.title, slug: row.slug, ext, cover: row.coverStyle || "master", mode: row.buildMode || "full", engine: row.engine || "claude", audio: row.sourceAudio || null, edit: isEdit, ownerEmail: row.ownerEmail, brief: row.brief || {} } });
}
