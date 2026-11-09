import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// nginx auth_request target: every static surface served straight from disk (presentation
// decks, authed exports, the deck viewer) asks this endpoint whether the caller has a valid
// GTM Workspace session (the same Google OAuth cookie as the app). 204 = allowed, 401 = login.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  return session?.user?.email
    ? new NextResponse(null, { status: 204 })
    : new NextResponse(null, { status: 401 });
}
