import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ownedDeck, readSpec, SPOOL } from "@/server/engage/deck-access";

// Slide Editor: add a slide to an engagement deck. The rep says what the slide should carry (a prompt
// and / or a file: PDF, PowerPoint, Word, text, or an image) and where it goes (after slide `after`).
// The request is spooled and the row flips to "editing"; the engage worker on the VPS writes the slide
// with Claude inside the template's own slide types, renders it, screenshots it, has Claude check the
// screenshot for anything broken (and rewrite it if so), then re-exports the deck and marks it ready.
// GET ?id= reports progress for the editor's dialog.
export const dynamic = "force-dynamic";
const EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp", "gif", "txt", "md", "csv", "pptx", "docx"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const id = String(form.get("id") || "");
  const after = String(form.get("after") || "").trim().slice(0, 40);
  const prompt = String(form.get("prompt") || "").trim().slice(0, 4000);
  const file = form.get("file") as File | null;
  if (!id || !/^[a-z0-9~-]+$/i.test(after)) return NextResponse.json({ error: "id and after required" }, { status: 400 });
  if (!prompt && !(file && file.size)) return NextResponse.json({ error: "Describe the slide, or add a file for it." }, { status: 400 });

  const row = await ownedDeck(id, email);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.engine !== "engage") return NextResponse.json({ error: "only sales decks can take a written slide" }, { status: 400 });
  if (row.status !== "ready") return NextResponse.json({ error: "This deck is busy. Try again in a moment." }, { status: 409 });

  let fileName: string | null = null;
  try {
    fs.mkdirSync(path.join(SPOOL, id), { recursive: true });
    if (file && file.size) {
      if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "That file is over 25 MB." }, { status: 413 });
      const ext = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!EXT.has(ext)) return NextResponse.json({ error: "Use a PDF, PowerPoint, Word, text or image file." }, { status: 415 });
      fileName = `slide-${Date.now().toString(36)}.${ext}`;
      fs.writeFileSync(path.join(SPOOL, id, fileName), Buffer.from(await file.arrayBuffer()));
    }
    fs.writeFileSync(path.join(SPOOL, id, "slide.json"), JSON.stringify({ after, prompt, file: fileName, originalName: file?.name || null, by: email, requestedAt: new Date().toISOString() }));
  } catch (e) { return NextResponse.json({ error: "could not spool the request: " + String(e) }, { status: 500 }); }

  await db.update(presentations).set({ status: "editing", statusMsg: "Adding a slide", progress: { stage: "write", log: ["Queued…"] }, updatedAt: new Date() })
    .where(eq(presentations.id, id));
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const row = await ownedDeck(id, email);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const spec = readSpec(row.slug);
  const prog = (row.progress || {}) as { log?: string[]; stage?: string };
  return NextResponse.json({
    status: row.status, statusMsg: row.statusMsg, stage: prog.stage || null, log: (prog.log || []).slice(-10),
    extra: (spec?.extra || []).map((x) => x.slide.id), hidden: spec?.hidden || [],
  });
}
