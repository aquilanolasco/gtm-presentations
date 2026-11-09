import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

// Look up a prospect's website for the sales-deck Create flow: company name, description, logo and
// cover-photo candidates. Runs the engage scout (headless Chrome, lives with the VPS workers) so sites
// that block plain fetches or draw their logo with JS still read correctly. Quick mode: home page only.
export const dynamic = "force-dynamic";
// NOTE: Turbopack statically traces a direct execFile("node", [script]) call and fails the build when
// it cannot resolve the script as a module, so the call goes through a promisified alias (the same
// trick quick-brand's renderer uses) and the path stays a plain string.
const execFileP = promisify(execFile);
const SCOUT = process.env.ENGAGE_SCOUT || "/var/www/acme-gtm-workers/engage/engage-scout.mjs";
const WORKERS = path.dirname(SCOUT);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { url?: string } | null;
  let url = (body?.url || "").trim();
  if (!url) return NextResponse.json({ error: "Enter the prospect's website address." }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try { const u = new URL(url); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) throw new Error(); } catch { return NextResponse.json({ error: "That does not look like a website address." }, { status: 400 }); }
  if (!fs.existsSync(SCOUT)) return NextResponse.json({ error: "The site reader is not installed on this server." }, { status: 503 });

  let out = { stdout: "", stderr: "" };
  try {
    const r = await execFileP("node", [SCOUT, url], { cwd: WORKERS, timeout: 75000, maxBuffer: 16 * 1024 * 1024 });
    out = { stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    out = { stdout: String(err.stdout || ""), stderr: String(err.stderr || err.message || "") };
  }
  try {
    const data = JSON.parse(out.stdout);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: `Could not read that site (${out.stderr.trim().slice(0, 140) || "no response"}). You can still enter the name and upload a logo.` }, { status: 502 });
  }
}
