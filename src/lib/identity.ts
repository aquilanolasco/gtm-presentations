// Display-name resolution.
//
// Most of the app derives a person's display name from their email local part
// ("jane.doe@..." -> "Jane Doe"). That breaks when someone's address does not match
// the name they go by, so these overrides win. Keep every address a person uses.
// (Sample identities: the real staff entries were replaced with placeholders.)
export const NAME_OVERRIDES: Record<string, string> = {
  "jane.doe@example.com": "Jane Doe",
  "jane.doe@example.org": "Jane Doe",
  "janedoe@example.com": "Jane Doe",
  "alex.lee@example.com": "Alex Lee",
  "alex.lee@example.org": "Alex Lee",
  "alexandra.lee@example.com": "Alex Lee",
  "alexandra.lee@example.org": "Alex Lee",
};

// People whose addresses do NOT share a local part across the two domains, so the
// domain-swap in emailVariants below cannot unify them (e.g. alex.lee vs alexandra.lee).
// Each inner array lists every address the person uses; signing in with any one of them
// resolves to the whole set, so they are one profile with access under either email.
// Add a group here whenever someone's two company emails have different local parts.
export const IDENTITY_ALIASES: string[][] = [
  ["jane.doe@example.com", "janedoe@example.com"],
  ["alex.lee@example.org", "alexandra.lee@example.com"],
];

/** Display name for an email: an explicit override, else derived from the local part. */
export function displayName(email: string | null | undefined): string {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return "";
  if (NAME_OVERRIDES[e]) return NAME_OVERRIDES[e];
  return (e.split("@")[0] ?? e)
    .split(/[._-]/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Every address the workspace owner signs in with. All three resolve to the same person. */
export const MY_EMAILS = [
  "jane.doe@example.com",
  "jane.doe@example.org",
  "janedoe@example.com",
] as const;

/** True when the email is one of the owner's addresses. */
export function isMe(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return (MY_EMAILS as readonly string[]).includes(e);
}

/** The two company domains are interchangeable for the same person. Everyone can sign in
 *  and be resolved under either @example.com or @example.org. */
export const COMPANY_DOMAINS = ["example.com", "example.org"] as const;

/** Both company-domain variants of an email (same local part), lowercased and de-duped.
 *  Used everywhere identity is resolved (roles, module access, meetings) so that whichever
 *  domain someone uses maps to the same person. Non-company emails return just themselves.
 *  Note: this cannot unify addresses whose local part changed (e.g. jane.doe vs
 *  janedoe); those are handled by explicit lists (NAME_OVERRIDES / FIXED_ROLES). */
export function emailVariants(email: string | null | undefined): string[] {
  const e = (email ?? "").trim().toLowerCase();
  if (!e.includes("@")) return e ? [e] : [];
  // Both company-domain forms of a single address (same local part).
  const domainForms = (addr: string): string[] => {
    const [local, domain] = addr.split("@");
    if (!(COMPANY_DOMAINS as readonly string[]).includes(domain!)) return [addr];
    return [addr, ...COMPANY_DOMAINS.map((d) => `${local}@${d}`)];
  };
  const out = new Set(domainForms(e));
  // Pull in any alias group this address belongs to (addresses with a different local
  // part that are still the same person), and every domain form of those addresses, so
  // all of a person's emails resolve to one GTM Workspace profile.
  for (const group of IDENTITY_ALIASES) {
    const g = group.map((x) => x.toLowerCase());
    if (g.some((x) => out.has(x))) {
      for (const addr of g) for (const v of domainForms(addr)) out.add(v);
    }
  }
  return [...out];
}
