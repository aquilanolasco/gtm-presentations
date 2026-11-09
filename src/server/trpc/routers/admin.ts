import { router, protectedProcedure } from "../index";
import { emailVariants } from "@/lib/identity";
import { isExternalPartner } from "@/lib/externalPartners";

// Trimmed stub. The original admin router (user roles table, per-module access, feature permissions,
// team directory, login history, contractor onboarding) belongs to the wider GTM Workspace and was
// left out of this presentations-only export. Only what the Presentations module uses remains:
//   - getEffectiveRole(email): the presentations router and the Slide Editor routes gate on it
//   - admin.myProfile: the Presentations page reads `role` from it to gate master-deck editing
// Roles come from an env list here instead of the database.
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "jane.doe@example.com,jane.doe@example.org,janedoe@example.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

// Role resolved across both company-domain variants of the email (see emailVariants), so a person
// gets the same role whichever address they sign in with. External partners are clamped to
// external_partner; everyone else is a plain user.
export async function getEffectiveRole(email: string): Promise<string> {
  const variants = emailVariants(email);
  if (variants.some((v) => SUPER_ADMIN_EMAILS.has(v))) return "super_admin";
  if (variants.some((v) => isExternalPartner(v)) || isExternalPartner(email)) return "external_partner";
  return "user";
}

export const adminRouter = router({
  myProfile: protectedProcedure.query(async ({ ctx }) => {
    const email = ctx.userEmail ?? "";
    return { email, role: await getEffectiveRole(email) };
  }),
});
