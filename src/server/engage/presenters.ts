import { db } from "@/server/db";
import { people } from "@/server/db/schema";

/* Who can sign a generated sales deck's closing page. Built from the team directory (name, title,
   phone, avatar) merged with the Meetings booker's members (public booking link), one entry per
   person across the example.com / example.org twin addresses. Cached for five minutes. */
export type Presenter = { email: string; name: string; title: string; phone?: string; avatar: string; booking?: string };

type Member = { name: string; email: string; title?: string; slug: string; avatar_url?: string };
let cache: { at: number; list: Presenter[] } | null = null;

const handle = (e: string) => e.toLowerCase().split("@")[0];
const normName = (n: string) => n.toLowerCase().replace(/\b(mih|mba|phd)\b/g, "").replace(/[^a-z]/g, "");
// avatars are served from /content-media/avatars/; the booker reports its own /avatars/ path
const fixAvatar = (a?: string | null) => (!a ? "" : a.startsWith("/avatars/") ? "/content-media" + a : a);

/* "+1-555-010-0100" / "555-010-0199" / "0491570156" / "+44 (0)7700 900 123" -> international, spaced */
export function tidyPhone(raw?: string | null, region?: string | null): string | undefined {
  if (!raw) return undefined;
  let d = raw.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (!d) return undefined;
  if (!d.startsWith("+")) {
    if (d.length === 10 && d.startsWith("0")) d = ((region || "").match(/apac|au|anz|sydney|melbourne|brisbane|nz/i) || !region ? "+61" : "+44") + d.slice(1);
    else if (d.length === 11 && d.startsWith("1")) d = "+" + d;
    else if (d.length === 10) d = "+1" + d;
    else if (d.length === 11 && d.startsWith("0")) d = "+44" + d.slice(1);
    else d = "+" + d;
  }
  const cc = d.startsWith("+1") ? "+1" : d.startsWith("+61") ? "+61" : d.startsWith("+44") ? "+44" : d.startsWith("+64") ? "+64" : d.startsWith("+65") ? "+65" : d.slice(0, 3);
  const rest = d.slice(cc.length);
  const groups = cc === "+1" ? [3, 3, 4] : cc === "+61" || cc === "+64" ? [3, 3, 3] : cc === "+44" ? [4, 3, 3] : [3, 3, 3];
  const parts: string[] = []; let i = 0;
  for (const g of groups) { if (i >= rest.length) break; parts.push(rest.slice(i, i + g)); i += g; }
  if (i < rest.length) parts.push(rest.slice(i));
  return `${cc} ${parts.join(" ")}`.trim();
}

export async function listPresenters(): Promise<Presenter[]> {
  if (cache && Date.now() - cache.at < 5 * 60e3) return cache.list;
  const rows = await db.select().from(people).catch(() => [] as (typeof people.$inferSelect)[]);
  let members: Member[] = [];
  try {
    const r = await fetch("http://127.0.0.1:3002/m/members", { signal: AbortSignal.timeout(3000) });
    if (r.ok) members = (await r.json()) as Member[];
  } catch { /* booker down: no booking links */ }

  const byName = new Map<string, Presenter>();
  for (const p of rows) {
    if (!p.email || !p.name || (p.personType && p.personType !== "employee")) continue;
    const key = normName(p.name);
    const cur = byName.get(key);
    const cand: Presenter = { email: p.email, name: p.name.replace(/\s+MIH$/i, ""), title: p.roleTitle || "", phone: tidyPhone(p.phone, p.region), avatar: fixAvatar(p.avatarUrl) };
    if (!cur) byName.set(key, cand);
    else byName.set(key, { ...cur, title: cur.title || cand.title, phone: cur.phone || cand.phone, avatar: cur.avatar || cand.avatar, email: cur.email.endsWith("@example.com") ? cur.email : cand.email.endsWith("@example.com") ? cand.email : cur.email });
  }
  for (const m of members) {
    if (!m.email || !m.name) continue;
    const key = normName(m.name);
    const booking = `https://${process.env.APP_DOMAIN ?? "app.example.com"}/book.html?u=${m.slug}`;
    const cur = byName.get(key) ?? [...byName.values()].find((p) => handle(p.email) === handle(m.email));
    if (cur) { cur.booking = booking; if (!cur.title) cur.title = m.title || ""; if (!cur.avatar) cur.avatar = fixAvatar(m.avatar_url); }
    else byName.set(key, { email: m.email, name: m.name, title: m.title || "", avatar: fixAvatar(m.avatar_url), booking });
  }
  const list = [...byName.values()].filter((p) => p.name && p.title).sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), list };
  return list;
}

/* the presenter record for a signed-in user (either twin address), or undefined */
export async function presenterFor(email: string): Promise<Presenter | undefined> {
  const list = await listPresenters();
  const h = handle(email);
  return list.find((p) => p.email.toLowerCase() === email.toLowerCase()) ?? list.find((p) => handle(p.email) === h);
}
