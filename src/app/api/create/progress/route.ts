import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq } from "drizzle-orm";

// The local relay streams live generation progress here (stage changes, per-slide counts, log
// lines). Auth is the shared relay secret. Patches merge into the row's `progress` jsonb.
export const dynamic = "force-dynamic";
function authed(req: NextRequest) {
  const s = process.env.RELAY_SECRET;
  return !!s && req.headers.get("x-relay-secret") === s;
}

type Progress = { stage?: string; slidesTotal?: number; slidesDone?: number; log?: string[] };

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "no id" }, { status: 400 });

  const [row] = await db.select({ progress: presentations.progress }).from(presentations).where(eq(presentations.id, b.id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cur = (row.progress || {}) as Progress;
  const next: Progress = { ...cur };
  if (typeof b.stage === "string") next.stage = b.stage;
  if (typeof b.slidesTotal === "number") next.slidesTotal = b.slidesTotal;
  if (typeof b.slidesDone === "number") next.slidesDone = b.slidesDone;
  if (b.log != null) {
    const add = Array.isArray(b.log) ? b.log : [String(b.log)];
    next.log = [...(cur.log || []), ...add].slice(-50); // keep the last 50 lines
  }
  await db.update(presentations).set({ progress: next, updatedAt: new Date() }).where(eq(presentations.id, b.id));
  return NextResponse.json({ ok: true });
}
