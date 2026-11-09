"use client";

// Minimal stub. The full GTM Workspace app shell (module navigation, role-gated nav items, the
// "view as" preview menu, profile menu, build stamp) was trimmed from this presentations-only
// export. Same default export and props as the original: a header plus the page content, with
// `fullHeight` pinning the layout to the viewport the way the Presentations page expects.
export default function AppShell({ children, fullHeight }: { children: React.ReactNode; fullHeight?: boolean }) {
  return (
    <div style={{
      height: fullHeight ? "100vh" : undefined,
      minHeight: fullHeight ? undefined : "100vh",
      overflow: fullHeight ? "hidden" : undefined,
      display: "flex",
      flexDirection: "column",
      background: "var(--page-bg)",
      fontFamily: "inherit",
    }}>
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        height: 56,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", padding: "0 24px",
        fontWeight: 600,
      }}>
        GTM Workspace
      </header>
      <main style={{ flex: 1, overflow: fullHeight ? "hidden" : undefined, display: fullHeight ? "flex" : undefined, flexDirection: fullHeight ? "column" : undefined }}>
        {children}
      </main>
    </div>
  );
}
