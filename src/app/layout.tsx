import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

// Trimmed root layout: the original also resolved per-page Open Graph share cards and mounted
// app-wide widgets from other modules. Only the providers the Presentations module needs remain.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Presentations · GTM Workspace",
  description: "Create, edit, export and share presentation decks.",
};

// Set the theme before first paint so there is no flash. Default is light; dark only applies
// once someone has chosen it (stored preference).
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'){t='light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} style={{ height: "100%" }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body style={{ height: "100%", margin: 0 }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
