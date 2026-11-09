import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { NAME_OVERRIDES } from "@/lib/identity";
import { EXTERNAL_PARTNER_EMAILS } from "@/lib/externalPartners";

// The company's two sign-in domains (sample values; mirror COMPANY_DOMAINS in @/lib/identity).
const ALLOWED_DOMAINS = ["example.com", "example.org"];

// External partners (contractors) are admitted on any email domain from the shared allowlist in
// @/lib/externalPartners — the SAME list that clamps them to the external_partner role in admin.ts,
// so sign-in admission and role can never drift apart. It MUST be a static list, not a DB lookup:
// this sign-in callback is bundled into the edge middleware (proxy.ts imports auth), where the
// node-postgres db throws. Their in-app access is deny-by-default (see externalPartners.ts).

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      // Edge-safe admission (no db here — see EXTERNAL_PARTNER_EMAILS note above).
      const allowed = ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`)) || EXTERNAL_PARTNER_EMAILS.has(email);
      return allowed;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      // The Google profile name is not always the name someone goes by, so the
      // workspace's own mapping wins for every address we have an override for.
      if (session.user?.email) {
        const override = NAME_OVERRIDES[session.user.email.trim().toLowerCase()];
        if (override) session.user.name = override;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
