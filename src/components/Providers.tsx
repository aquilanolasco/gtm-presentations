"use client";

import { SessionProvider } from "next-auth/react";
import TRPCProvider from "./TRPCProvider";
import ConfirmProvider from "./ConfirmProvider";
import { ThemeProvider } from "./theme";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <TRPCProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </TRPCProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
