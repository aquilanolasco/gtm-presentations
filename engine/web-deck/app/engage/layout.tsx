import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acme Sales Deck",
  description: "Sample product tagline.",
  robots: { index: false, follow: false },
};

export default function EngageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
