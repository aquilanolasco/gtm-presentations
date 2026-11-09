import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@/lib/auth";
import { z } from "zod";

export type Context = {
  userId: string | null;
  userEmail: string | null;   // effective identity (the "view as" target while previewing)
  realEmail: string | null;   // the person actually signed in (the super admin)
  name: string | null;        // the signed-in person's display name, for directory lookups when the email local-part differs
  impersonating: boolean;
};

// Mirror of the super_admin list in routers/admin.ts (same env var, same sample default). Kept
// inline to avoid a circular import into the context. "View as" belongs to the super admin alone.
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "jane.doe@example.com,jane.doe@example.org,janedoe@example.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

export async function createContext(req?: Request): Promise<Context> {
  const session = await auth();
  const realEmail = session?.user?.email ?? null;
  let userEmail = realEmail;
  let impersonating = false;

  // "View as": only the real super admin may adopt another person's identity, and only for
  // reads (writes are blocked below), so a preview can never change anyone's data.
  const viewAs = req?.headers.get("x-pp-view-as")?.trim() || null;
  if (viewAs && realEmail && SUPER_ADMIN_EMAILS.has(realEmail.toLowerCase()) && viewAs.toLowerCase() !== realEmail.toLowerCase()) {
    userEmail = viewAs;
    impersonating = true;
  }

  return {
    userId: session?.user?.id ?? null,
    userEmail,
    realEmail,
    name: session?.user?.name ?? null,
    impersonating,
  };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, type, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  // While previewing as another person, every write is blocked so the preview is faithful but
  // harmless: you see exactly what they see and which buttons are enabled, without touching data.
  if (ctx.impersonating && type === "mutation") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Preview only. Changes are turned off while you view as another person." });
  }
  return next({ ctx: { userId: ctx.userId } });
});

export { z };
