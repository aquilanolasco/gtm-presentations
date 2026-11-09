import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { presentations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { listPresenters, presenterFor } from "@/server/engage/presenters";
import fs from "node:fs";
import path from "node:path";
import LIB from "@/lib/engage-library.json";

// Queue a prospect sales deck ("Create from a Master Deck"). The rep gives the prospect's website, the
// company name, a logo pick (a URL from the scout, or an uploaded file), an optional cover photo, notes
// for the writer, who presents it, and which master slides to include. The VPS engage worker builds it.
export const dynamic = "force-dynamic";
const SPOOL = "/var/www/presentation-spool";
// the slide library (the master decks and the Short Pack): any of its slides may follow the opening
// slides, as "<sid>" or "<sid>~<savedId>" (a Saved slide: that master slide with a rep's kept edits,
// /var/www/presentation-public/_saved/<savedId>.json); nothing ticked = the Short Pack
const LIB_SIDS = new Set(LIB.decks.flatMap((d) => d.slides.map((s) => s.sid)));
const BODY = (LIB.decks.find((d) => d.id === "shortpack")?.slides || []).map((s) => s.sid);
const SAVED = "/var/www/presentation-public/_saved";
const validRef = (b: string): boolean => {
  const m = b.match(/^([a-z0-9-]+)(?:~([a-z0-9]{4,16}))?$/);
  if (!m || !LIB_SIDS.has(m[1])) return false;
  return !m[2] || fs.existsSync(path.join(SAVED, `${m[2]}.json`));
};

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export async function POST(req: NextRequest) {
  const session = await auth();
  const me = session?.user?.email;
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const url = String(form.get("url") || "").trim();
  const client = String(form.get("client") || "").trim().slice(0, 80);
  if (!url || !client) return NextResponse.json({ error: "The website and the company name are both needed." }, { status: 400 });
  const notes = String(form.get("notes") || "").trim().slice(0, 6000);
  const heroRaw = String(form.get("hero") || "auto").trim();
  let hero = heroRaw === "none" || heroRaw === "auto" ? heroRaw : /^https?:\/\//i.test(heroRaw) ? heroRaw.slice(0, 2000) : "auto";
  let body: string[] = [];
  try { body = JSON.parse(String(form.get("body") || "[]")); } catch { body = []; }
  body = Array.isArray(body) ? body.filter((b): b is string => typeof b === "string" && validRef(b)) : [];
  if (!body.length) body = BODY;
  let scout: unknown = null;
  try { const s = String(form.get("scout") || ""); if (s && s.length < 400_000) scout = JSON.parse(s); } catch { scout = null; }

  // presenter: the chosen colleague, else the signed-in rep, else nobody (the deck falls back to its default presenter)
  const presenterEmail = String(form.get("presenter") || "").trim();
  const roster = await listPresenters();
  const presenter = (presenterEmail && roster.find((p) => p.email.toLowerCase() === presenterEmail.toLowerCase())) || await presenterFor(me) || undefined;

  // slug: readable and unique (acme-<client>-sales-deck, -2, -3 ...)
  const base = `acme-${slugify(client) || "prospect"}-sales-deck`;
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const [dup] = await db.select({ id: presentations.id }).from(presentations).where(eq(presentations.slug, slug)).limit(1);
    const onDisk = fs.existsSync(path.join("/var/www/presentation-public", slug));
    if (!dup && !onDisk) break;
    slug = `${base}-${n}`;
  }

  const id = crypto.randomUUID();
  // logo: an uploaded file is spooled and referenced as spool:<file>; otherwise the scout URL / data URL
  let logo = String(form.get("logo") || "auto").trim();
  const logoFile = form.get("logoFile") as File | null;
  if (logoFile && logoFile.size > 0) {
    if (logoFile.size > 8 * 1024 * 1024) return NextResponse.json({ error: "That logo file is over 8 MB." }, { status: 413 });
    const ext = (logoFile.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
    try {
      fs.mkdirSync(path.join(SPOOL, id), { recursive: true });
      fs.writeFileSync(path.join(SPOOL, id, `logo.${ext}`), Buffer.from(await logoFile.arrayBuffer()));
      logo = `spool:logo.${ext}`;
    } catch (e) { return NextResponse.json({ error: "could not store the logo: " + String(e) }, { status: 500 }); }
  } else if (logo !== "auto" && !/^(https?:\/\/|data:image\/)/i.test(logo)) {
    logo = "auto";
  }
  if (logo.length > 300_000) return NextResponse.json({ error: "That logo is too large to use inline. Upload it as a file." }, { status: 413 });
  // cover photo: the rep's own file is spooled the same way (spool:photo.<ext>); the worker uses it as is
  const heroFile = form.get("heroFile") as File | null;
  if (heroFile && heroFile.size > 0) {
    if (heroFile.size > 20 * 1024 * 1024) return NextResponse.json({ error: "That photo is over 20 MB." }, { status: 413 });
    const ext = (heroFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    try {
      fs.mkdirSync(path.join(SPOOL, id), { recursive: true });
      fs.writeFileSync(path.join(SPOOL, id, `photo.${ext}`), Buffer.from(await heroFile.arrayBuffer()));
      hero = `spool:photo.${ext}`;
    } catch (e) { return NextResponse.json({ error: "could not store the photo: " + String(e) }, { status: 500 }); }
  }

  const title = `${client} Sales Deck`;
  await db.insert(presentations).values({
    id, title, slug, ownerEmail: me, status: "generating", statusMsg: "Queued",
    sourceFile: url, coverStyle: "master", buildMode: "full", engine: "engage", kind: "sales",
    brief: { url, client, logo, hero, notes, presenter, body, scout, requestedBy: me, requestedAt: new Date().toISOString() },
  });
  return NextResponse.json({ id, slug, title, presenter: presenter?.name || null });
}

// the presenter roster for the Create pane's "Presented by" picker (+ who the signed-in user is)
export async function GET() {
  const session = await auth();
  const me = session?.user?.email;
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const list = await listPresenters();
  const mine = await presenterFor(me);
  return NextResponse.json({ presenters: list.map((p) => ({ email: p.email, name: p.name, title: p.title, avatar: p.avatar, hasPhone: !!p.phone, hasBooking: !!p.booking })), me: mine?.email || null });
}
