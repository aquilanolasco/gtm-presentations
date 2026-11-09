import { router, protectedProcedure, z } from "../index";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { presentations, people } from "@/server/db/schema";
import { eq, or, and, desc, sql } from "drizzle-orm";
import { getEffectiveRole } from "./admin";

const email = (ctx: { userEmail?: string | null }) => (ctx as { userEmail: string | null }).userEmail ?? "";

async function owned(id: string, who: string) {
  const [row] = await db.select().from(presentations).where(eq(presentations.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (row.ownerEmail !== who) throw new TRPCError({ code: "FORBIDDEN", message: "Not your presentation." });
  return row;
}

// Edit access: the owner, or anyone the deck was shared with as an editor (per-person
// role "edit", or a company-wide "edit" share).
async function canEdit(id: string, who: string) {
  const [row] = await db.select().from(presentations).where(eq(presentations.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  const shared = Array.isArray(row.sharedEmails) ? (row.sharedEmails as { email: string; role?: string }[]) : [];
  const mine = shared.find((s) => s.email === who);
  const editor = row.ownerEmail === who || mine?.role === "edit" || (row.companyShared && row.companyRole === "edit");
  if (!editor) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have edit access to this presentation." });
  return row;
}

export const presentationsRouter = router({
  // the signed-in user's own decks. Resilient: if the DB is unreachable (e.g. the Neon
  // compute quota is exhausted) or the table is not migrated yet, return [] so the
  // Presentations page never breaks — the master decks are always available regardless.
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const me = email(ctx);
    try {
      return await db.select().from(presentations)
        .where(and(eq(presentations.ownerEmail, me), eq(presentations.archived, false)))
        .orderBy(desc(presentations.createdAt));
    } catch { return []; }
  }),

  // Super-admin only: EVERY user-created deck, tagged with the creator's display name so the
  // Presentations list can break decks down by person. Non-admins get [] (they use listMine).
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const me = email(ctx);
    try {
      if ((await getEffectiveRole(me)) !== "super_admin") return [];
      const rows = await db.select().from(presentations).orderBy(desc(presentations.createdAt));
      const dir = await db.select({ email: people.email, name: people.name }).from(people);
      const nameByEmail = new Map(dir.map((p) => [(p.email ?? "").toLowerCase(), p.name ?? ""]));
      // inDirectory flags a real teammate (vs a system account like master@) so the By-person
      // breakdown lists only people, never phantom accounts.
      return rows.map((r) => {
        const key = (r.ownerEmail ?? "").toLowerCase();
        return { ...r, ownerName: nameByEmail.get(key) || (r.ownerEmail ?? "").split("@")[0], inDirectory: nameByEmail.has(key) };
      });
    } catch { return []; }
  }),

  // Every teammate's prospect sales decks (kind "sales", built by the engage worker or uploaded as a
  // sales deck). Sales decks are team assets, so the Sales Decks tab shows them to everyone; only the
  // owner (or a super admin) can edit or archive one. Tagged with the creator's name for the card.
  listSales: protectedProcedure.query(async () => {
    try {
      const rows = await db.select().from(presentations)
        .where(and(eq(presentations.kind, "sales"), eq(presentations.archived, false)))
        .orderBy(desc(presentations.createdAt));
      const dir = await db.select({ email: people.email, name: people.name }).from(people);
      const nameByEmail = new Map(dir.map((p) => [(p.email ?? "").toLowerCase(), p.name ?? ""]));
      return rows.map((r) => ({ ...r, ownerName: nameByEmail.get((r.ownerEmail ?? "").toLowerCase()) || (r.ownerEmail ?? "").split("@")[0] }));
    } catch { return []; }
  }),

  // the Archived (recover) view. A super admin sees every archived deck (tagged with the owner's
  // name); a normal user sees only their own archived decks. Used to restore or permanently delete.
  listArchived: protectedProcedure.query(async ({ ctx }) => {
    const me = email(ctx);
    try {
      const admin = (await getEffectiveRole(me)) === "super_admin";
      const rows = await db.select().from(presentations)
        .where(admin ? eq(presentations.archived, true) : and(eq(presentations.archived, true), eq(presentations.ownerEmail, me)))
        .orderBy(desc(presentations.updatedAt));
      const dir = await db.select({ email: people.email, name: people.name }).from(people);
      const nameByEmail = new Map(dir.map((p) => [(p.email ?? "").toLowerCase(), p.name ?? ""]));
      return rows.map((r) => ({ ...r, ownerName: nameByEmail.get((r.ownerEmail ?? "").toLowerCase()) || (r.ownerEmail ?? "").split("@")[0] }));
    } catch { return []; }
  }),

  // decks other people shared with me (company-wide, or my email in the pick-list), each tagged
  // with the role I was granted (view | edit) so the UI can show "Can edit" vs "View only".
  listShared: protectedProcedure.query(async ({ ctx }) => {
    const me = email(ctx);
    try {
      const rows = await db.select().from(presentations)
        .where(and(
          sql`${presentations.ownerEmail} <> ${me}`,
          eq(presentations.archived, false),
          or(eq(presentations.companyShared, true), sql`${presentations.sharedEmails} @> ${JSON.stringify([{ email: me }])}::jsonb`),
        ))
        .orderBy(desc(presentations.createdAt));
      return rows.map((r) => {
        const mine = (Array.isArray(r.sharedEmails) ? (r.sharedEmails as { email: string; role?: string }[]) : []).find((s) => s.email === me);
        const myRole = mine?.role || (r.companyShared ? r.companyRole : "view");
        return { ...r, myRole };
      });
    } catch { return []; }
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const me = email(ctx);
    const [row] = await db.select().from(presentations).where(eq(presentations.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    const shared = Array.isArray(row.sharedEmails) && (row.sharedEmails as { email: string }[]).some((s) => s.email === me);
    const allowed = row.ownerEmail === me || row.companyShared || shared;
    if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
    return row;
  }),

  // Register a new deck row (Create calls this before/at generation). The generation worker
  // updates status/urls directly in the DB.
  create: protectedProcedure.input(z.object({
    title: z.string().min(1),
    slug: z.string().min(1),
    sourceFile: z.string().optional(),
    status: z.enum(["generating", "ready", "failed"]).optional(),
  })).mutation(async ({ ctx, input }) => {
    const me = email(ctx);
    const [row] = await db.insert(presentations).values({
      title: input.title, slug: input.slug, ownerEmail: me,
      sourceFile: input.sourceFile, status: input.status ?? "generating",
    }).returning();
    return row;
  }),

  rename: protectedProcedure.input(z.object({ id: z.string(), title: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const me = email(ctx);
      // owner / shared-editor can rename; a super admin can rename any deck (to fix bad auto-names).
      if ((await getEffectiveRole(me)) === "super_admin") {
        const [row] = await db.select().from(presentations).where(eq(presentations.id, input.id)).limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      } else {
        await canEdit(input.id, me);
      }
      await db.update(presentations).set({ title: input.title.trim(), updatedAt: new Date() }).where(eq(presentations.id, input.id));
      return { ok: true };
    }),

  // Soft-delete / restore. Owner or super admin. Archived decks disappear from every list but are
  // fully recoverable from the Archived view — nothing is destroyed.
  setArchived: protectedProcedure.input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const me = email(ctx);
      const [row] = await db.select().from(presentations).where(eq(presentations.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const admin = (await getEffectiveRole(me)) === "super_admin";
      if (row.ownerEmail !== me && !admin) throw new TRPCError({ code: "FORBIDDEN", message: "Not your presentation." });
      await db.update(presentations).set({ archived: input.archived, updatedAt: new Date() }).where(eq(presentations.id, input.id));
      return { ok: true };
    }),

  setSharing: protectedProcedure.input(z.object({
    id: z.string(),
    companyShared: z.boolean(),
    companyRole: z.enum(["view", "edit"]).default("view"),
    sharedEmails: z.array(z.object({ email: z.string(), role: z.enum(["view", "edit"]) })),
  })).mutation(async ({ ctx, input }) => {
    await owned(input.id, email(ctx));
    await db.update(presentations).set({
      companyShared: input.companyShared, companyRole: input.companyRole,
      sharedEmails: input.sharedEmails, updatedAt: new Date(),
    }).where(eq(presentations.id, input.id));
    return { ok: true };
  }),

  setPublic: protectedProcedure.input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await owned(input.id, email(ctx));
      await db.update(presentations).set({ publicEnabled: input.enabled, updatedAt: new Date() }).where(eq(presentations.id, input.id));
      return { ok: true };
    }),

  // PERMANENT delete (irreversible). Normal UI never calls this — the card action is Archive.
  // Reserved for the Archived view: owner, or a super admin clearing out an archived deck.
  remove: protectedProcedure.input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const me = email(ctx);
      if ((await getEffectiveRole(me)) === "super_admin") {
        const [row] = await db.select().from(presentations).where(eq(presentations.id, input.id)).limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      } else {
        await owned(input.id, me);
      }
      await db.delete(presentations).where(eq(presentations.id, input.id));
      return { ok: true };
    }),

  // colleagues for the "share with specific people" pick-list (any authed user)
  people: protectedProcedure.query(async () => {
    try {
      const rows = await db.select({ email: people.email, name: people.name }).from(people).orderBy(people.name);
      return rows.filter((r) => r.email);
    } catch { return []; }
  }),
});
