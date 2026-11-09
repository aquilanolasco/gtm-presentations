import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import fs from "node:fs";
import path from "node:path";

// Create: accept an uploaded file, spool it to disk, register a DB row (status generating).
// The local relay agent picks it up, generates + exports the deck, and marks it ready.
export const dynamic = "force-dynamic";
const SPOOL = "/var/www/presentation-spool";

export async function POST(req: NextRequest) {
  const session = await auth();
  const emailAddr = session?.user?.email;
  if (!emailAddr) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const title = (form.get("title") as string || "").trim() || (file?.name?.replace(/\.[^.]+$/, "") ?? "Presentation");
  const coverStyle = (["device", "master", "gradient", "light", "dark"].includes(form.get("cover") as string) ? form.get("cover") : "device") as string;
  const buildMode = (form.get("mode") === "quick" ? "quick" : "full") as string;
  // Claude is the only build engine now (Gamma retired); always build in-app HTML decks.
  const engine = "claude";
  // "sales" decks land in the Sales Decks tab; anything else is a general deck in My Decks.
  const kind = (form.get("kind") === "sales" ? "sales" : "general") as string;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  // Accept any file — the relay's ingest handles PDF/PPTX/DOCX natively, reads text-based files
  // (txt/md/html/code/csv/json) directly, transcribes audio, and OCRs/urls images.
  const ext = (file.name.split(".").pop() || "txt").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "txt";
  // A recorded voice memo is uploaded alongside the content so it is stored with the deck (the
  // live transcript is the content; this is the original audio, kept as an attachment).
  const audio = form.get("audio") as File | null;
  const audioExt = audio ? (audio.name.split(".").pop() || "webm").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "webm" : null;

  const id = crypto.randomUUID();
  const slug = "u-" + id.slice(0, 8);
  try {
    fs.mkdirSync(path.join(SPOOL, id), { recursive: true });
    fs.writeFileSync(path.join(SPOOL, id, `source.${ext}`), Buffer.from(await file.arrayBuffer()));
    if (audio && audioExt) fs.writeFileSync(path.join(SPOOL, id, `audio.${audioExt}`), Buffer.from(await audio.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: "spool write failed: " + String(e) }, { status: 500 });
  }
  await db.insert(presentations).values({
    id, title, slug, ownerEmail: emailAddr, status: "generating",
    sourceFile: file.name, coverStyle, buildMode, engine, kind,
    sourceAudio: audio && audioExt ? `audio.${audioExt}` : null, statusMsg: "Queued",
  });
  return NextResponse.json({ id, slug });
}
