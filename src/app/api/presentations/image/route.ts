import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import fs from "node:fs";
import path from "node:path";
import { ownedDeck, deckDir, PUBLIC } from "@/server/engage/deck-access";

// Slide Editor: a replacement photo for an image on a deck. The file (already cropped to the frame by the
// editor) is stored next to the deck and its relative name goes into the edits patch as `imgSrc`.
export const dynamic = "force-dynamic";
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const id = String(form.get("id") || "");
  const file = form.get("file") as File | null;
  if (!id || !file || !file.size) return NextResponse.json({ error: "id and file required" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "That image is over 15 MB." }, { status: 413 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Use a PNG, JPG, WebP or GIF image." }, { status: 415 });

  let slug: string;
  if (id.startsWith("master:")) {
    slug = id.slice("master:".length);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return NextResponse.json({ error: "bad slug" }, { status: 400 });
    const { getEffectiveRole } = await import("@/server/trpc/routers/admin");
    const role = await getEffectiveRole(email);
    if (role !== "super_admin") return NextResponse.json({ error: "Only the super admin edits master decks" }, { status: 403 });
  } else {
    const row = await ownedDeck(id, email);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    slug = row.slug;
  }
  const dir = deckDir(slug);
  if (!dir.startsWith(PUBLIC) || !fs.existsSync(dir)) return NextResponse.json({ error: "deck files not found" }, { status: 404 });
  const name = `u-${Date.now().toString(36)}.${ext}`;
  try { fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer())); }
  catch (e) { return NextResponse.json({ error: "could not store the image: " + String(e) }, { status: 500 }); }
  return NextResponse.json({ ok: true, url: `./${name}` });
}
