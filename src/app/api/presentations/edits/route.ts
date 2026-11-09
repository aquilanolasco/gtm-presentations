import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getEffectiveRole } from "@/server/trpc/routers/admin";
import { isSuperAdmin, markReexport } from "@/server/engage/deck-access";
import fs from "node:fs";
import path from "node:path";

// Save the Slide Editor patch layer for a deck. Persists edits.json next to the published deck so
// standalone Present/view applies them, and backs up the PRIOR edits.json on every save so an earlier
// version is never lost. Two kinds of deck:
//   - USER decks: id is the presentations row id. Owner or super admin may edit; edits also stored on the row.
//   - MASTER decks: id is "master:<slug>" (master decks have no DB row). Any admin or super admin may edit.
// The original code-built master deck is never overwritten; edits are a patch layer on top, versioned.
export const dynamic = "force-dynamic";
const PUBLIC = "/var/www/presentation-public";

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { id?: string; edits?: Record<string, unknown> } | null;
  if (!body?.id || typeof body.edits !== "object" || body.edits === null) {
    return NextResponse.json({ error: "id and edits required" }, { status: 400 });
  }
  const json = JSON.stringify(body.edits);
  if (json.length > 800_000) return NextResponse.json({ error: "edits too large" }, { status: 413 });

  const isMaster = body.id.startsWith("master:");
  let slug: string;
  let engageRow: { id: string; slug: string; title: string } | null = null;

  if (isMaster) {
    slug = body.id.slice("master:".length);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return NextResponse.json({ error: "bad slug" }, { status: 400 });
    // master decks: the role check below currently admits the super admin only
    const role = await getEffectiveRole(email);
    if (role !== "super_admin") return NextResponse.json({ error: "Only the super admin edits master decks" }, { status: 403 });
  } else {
    const [row] = await db.select().from(presentations).where(eq(presentations.id, body.id)).limit(1);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.ownerEmail.toLowerCase() !== email.toLowerCase() && !isSuperAdmin(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    slug = row.slug;
    await db.update(presentations).set({ edits: body.edits, updatedAt: new Date() }).where(eq(presentations.id, body.id));
    if (row.engine === "engage") engageRow = { id: row.id, slug: row.slug, title: row.title };
  }

  // publish edits.json next to the deck (+ back up the prior version) and make sure the deck loads the
  // edit runtime so standalone view/Present applies the patch. Deck files live outside the app, so file
  // writes are best-effort (they no-op in local dev where the path does not exist).
  try {
    const deckDir = path.join(PUBLIC, slug, "deck");
    if (fs.existsSync(deckDir)) {
      const editsPath = path.join(deckDir, "edits.json");
      // back up the PRIOR edits so no version is ever lost
      if (fs.existsSync(editsPath)) {
        const backups = path.join(deckDir, "edits-backups");
        fs.mkdirSync(backups, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(editsPath, path.join(backups, `edits-${ts}.json`));
        try { // keep the 50 most recent backups
          const files = fs.readdirSync(backups).filter((f) => f.startsWith("edits-") && f.endsWith(".json")).sort();
          for (const f of files.slice(0, Math.max(0, files.length - 50))) fs.rmSync(path.join(backups, f));
        } catch { /* pruning is best-effort */ }
      }
      fs.writeFileSync(editsPath, json);
      const idx = path.join(deckDir, "index.html");
      if (fs.existsSync(idx)) {
        let html = fs.readFileSync(idx, "utf8");
        if (!html.includes("/pp-edit.js")) {
          html = html.replace("</body>", '<script src="/pp-edit.js"></script></body>');
          fs.writeFileSync(idx, html);
        }
      }
    }
  } catch { /* file layer is best-effort; for user decks the DB row is the source of truth */ }

  // a generated sales deck ships PowerPoint + PDF built from the deck: the worker rebuilds them so the
  // downloads carry the new words, sizes and photos too
  if (engageRow) markReexport(engageRow.id, engageRow.slug, engageRow.title);

  return NextResponse.json({ ok: true });
}
