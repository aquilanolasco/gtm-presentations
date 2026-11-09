import { signIn } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const sp = await searchParams;
  // Only same-origin relative paths are honoured; anything else falls back to the dashboard.
  // Prevents open-redirect through the login.
  const cb = sp?.callbackUrl;
  const redirectTo = cb && cb.startsWith("/") && !cb.startsWith("//") ? cb : "/";
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #fff 0%, #eff6ff 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <div style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 20,
        padding: "48px 40px 40px",
        maxWidth: 380, width: "100%",
        textAlign: "center",
        boxShadow: "0 4px 40px rgba(59,130,246,.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 32 }}>
          <img src="/brand/logo-placeholder.svg" alt="Logo" style={{ height: 64, width: "auto" }} />
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", marginBottom: 8, lineHeight: 1.3, textWrap: "balance" } as React.CSSProperties}>
          Welcome to your GTM workspace
        </h1>

        <div style={{
          width: 40, height: 3,
          background: "linear-gradient(90deg, #8b5cf6, #3b82f6)",
          borderRadius: 2, margin: "0 auto 28px",
        }} />

        <p style={{ fontSize: 14, color: "#4B5563", marginBottom: 32, lineHeight: 1.5, textWrap: "balance" } as React.CSSProperties}>
          Sign in with your company Google account to access internal tools.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
        >
          <button
            type="submit"
            style={{
              width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              padding: "12px 20px", borderRadius: 100,
              border: "1px solid #e5e7eb", background: "#fff",
              color: "#374151", fontSize: 15, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </form>

        <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 20 }}>
          Team accounts only &middot; @example.com
        </p>
      </div>
    </div>
  );
}
