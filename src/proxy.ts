import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Next.js 16 proxy (formerly middleware): every page needs a GTM Workspace session except the
// surfaces below. Trimmed to what the Presentations module needs; the original also listed the
// public paths of other modules (booking pages, webhooks, landing pages).
//
// /pp-edit.js is the deck edit runtime: every generated deck loads it to APPLY its saved edits,
// including a prospect's public link and the worker's headless export, neither of which has a
// session. It holds no secrets; editing itself is gated by the editor's API routes.
const PUBLIC_PATHS = new Set(["/robots.txt", "/pp-edit.js"]);

function isPublic(pathname: string) {
  return (
    PUBLIC_PATHS.has(pathname) ||
    // tRPC guards itself: protectedProcedure throws UNAUTHORIZED with no session.
    pathname.startsWith("/api/trpc") ||
    // Create relay endpoints: the local generation relay authenticates with the
    // x-relay-secret header, not a session (the upload POST /api/create stays protected).
    pathname === "/api/create/next" ||
    pathname === "/api/create/done"
  );
}

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();
  if (!isLoggedIn && !isLoginPage) return NextResponse.redirect(new URL("/login", req.url));
  if (isLoggedIn && isLoginPage) return NextResponse.redirect(new URL("/presentations", req.url));
  return NextResponse.next();
});

export const config = {
  // api/create is excluded so large uploads (PDF/PPTX, voice memos) are not truncated by the
  // proxy's body cap, and so the relay reaches it with an x-relay-secret header instead of a
  // session. Every one of those routes enforces its own auth (session or x-relay-secret).
  matcher: ["/((?!api/auth|api/create|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|ttf|woff|woff2|pdf)$).*)"],
};
