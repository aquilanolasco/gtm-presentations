// Single source of truth for external partners: contractors who sign in on a non-company email.
//
// This list is authoritative in TWO places that MUST agree, which is why it lives on its own
// (and stays edge-safe: a plain Set + function, no DB, no node-only imports):
//
//  1. auth.ts (edge middleware) — ADMITS their Google sign-in (they're not on a company domain).
//  2. admin.ts getEffectiveRole — CLAMPS them to the `external_partner` role, overriding whatever
//     the user_roles table says. external_partner is deny-by-default: they see ONLY the modules
//     explicitly granted to them in module_access. This makes it STRUCTURALLY IMPOSSIBLE for a
//     contractor to inherit the broad `user`/`manager` default module set (e.g. land on Outbound)
//     because a stray, missing or wrong role row was written. Worst case they see nothing, never
//     more than what was granted.
//
// To onboard a contractor: add their exact sign-in email here, then grant their modules
// (Directory → Add contractor, or module_access rows). Order doesn't matter; the clamp runs first.
export const EXTERNAL_PARTNER_EMAILS = new Set<string>([
  // sample entries (the real contractor addresses were removed)
  "sam.taylor@example.net",         // Sam Taylor, paid acquisition advisor
  "john.smith@consulting.example",  // John Smith, marketing consultant
]);

export function isExternalPartner(email?: string | null): boolean {
  return !!email && EXTERNAL_PARTNER_EMAILS.has(email.trim().toLowerCase());
}
