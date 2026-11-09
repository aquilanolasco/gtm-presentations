import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
function authed(req: NextRequest) {
  const s = process.env.RELAY_SECRET;
  return !!s && (req.headers.get("x-relay-secret") === s);
}
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  if (!b?.id) return NextResponse.json({ error: "no id" }, { status: 400 });
  await db.update(presentations).set({
    status: b.status || "ready",
    statusMsg: b.statusMsg ?? (b.status === "failed" ? "Generation failed" : "Ready"),
    slideCount: b.slideCount ? String(b.slideCount) : undefined,
    deckUrl: b.deckUrl,
    pptxReady: !!b.pptxReady, pdfReady: !!b.pdfReady,
    canvaUrl: b.canvaUrl,
    // Gamma decks report the hosted gamma.app url so My Decks can Present / Edit on Gamma.
    ...(b.gammaUrl ? { gammaUrl: b.gammaUrl } : {}),
    // an engagement deck built with Saved slides starts with their words / photos / hidden items as its
    // patch layer (the editor seeds from this row, so it must match the deck's edits.json)
    ...(b.edits && typeof b.edits === "object" && !Array.isArray(b.edits) ? { edits: b.edits } : {}),
    updatedAt: new Date(),
  }).where(eq(presentations.id, b.id));
  return NextResponse.json({ ok: true });
}
