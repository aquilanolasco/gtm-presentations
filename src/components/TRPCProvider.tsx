"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "@/lib/trpc/client";

export default function TRPCProvider({ children }: { children: React.ReactNode }) {
  // App-wide caching: data loads once and stays warm, so moving between modules is
  // instant instead of re-fetching every time. No refetch just because you tabbed away
  // and back. Individual queries can still opt out with their own staleTime.
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,          // treat data as fresh for a minute
        gcTime: 5 * 60_000,         // keep it cached for 5 minutes after unmount
        refetchOnWindowFocus: false, // stop the flicker when you come back to the tab
        retry: 1,
      },
    },
  }));
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({
        url: "/api/trpc",
        // Carry the "view as" identity so the whole app renders as that person while the
        // super admin previews. Only honoured server-side when the real user is super admin.
        headers() {
          if (typeof window === "undefined") return {};
          try { const v = localStorage.getItem("pp_impersonate"); return v ? { "x-pp-view-as": v } : {}; } catch { return {}; }
        },
      })],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
