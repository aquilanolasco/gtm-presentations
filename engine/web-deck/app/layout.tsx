import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600", "700", "800"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["500", "600"] });

export const metadata: Metadata = {
  title: "Acme for Example Hotels",
  description: "Sample product tagline.",
  robots: { index: false, follow: false },
};

// Base-path-aware @font-face for the raw /public fonts: absolute url() in globals.css
// does NOT get the sub-path prefix on export, so the display font 404s on the live
// site. These rules render after globals.css and win the cascade with correct URLs.
// "Brand Display" is an optional self-hosted display face (files not included); without
// it the --disp stack falls back to Inter.
const BASE = process.env.NEXT_PUBLIC_DECK_BASE_PATH || "";
const FONT_FACES = `
@font-face{font-family:"Brand Display";src:url("${BASE}/fonts/brand-display-400.woff2") format("woff2");font-weight:344;font-style:normal;font-display:swap}
@font-face{font-family:"Brand Display";src:url("${BASE}/fonts/brand-display-500.woff2") format("woff2");font-weight:500;font-style:normal;font-display:swap}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        {/* Runs at parse time, before hydration: if the deck is inside an iframe (the
            Presentations preview pane, or the public viewer) mark it embedded so the
            present-only top controls (Full screen / Presentations) are hidden. */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(window.top!==window.self)document.documentElement.setAttribute('data-embed','1')}catch(e){document.documentElement.setAttribute('data-embed','1')}" }} />
        {/* Pre-hydration keyboard nav: arrow/page/space advance a whole slide from the moment
            the HTML parses, so navigation never falls back to a small native scroll while the
            deck's JS is still loading. Yields to React once it hydrates (__ppReactNav). */}
        <script dangerouslySetInnerHTML={{ __html: "(function(){function S(){return document.querySelectorAll('.pp-slide')}function C(){var h=innerHeight,a=0,s=S();for(var i=0;i<s.length;i++){if(s[i].getBoundingClientRect().top<=h/2)a=i}return a}function G(n){var s=S();n=Math.max(0,Math.min(s.length-1,n));if(s[n])s[n].scrollIntoView({behavior:'smooth',block:'start'})}window.addEventListener('keydown',function(e){if(window.__ppReactNav)return;var k=e.key,f=(k==='ArrowDown'||k==='PageDown'||k===' '||k==='ArrowRight'),b=(k==='ArrowUp'||k==='PageUp'||k==='ArrowLeft');if(!f&&!b)return;e.preventDefault();try{window.focus()}catch(x){}G(C()+(f?1:-1))},{capture:true})})()" }} />
      </head>
      <body>
        <style dangerouslySetInnerHTML={{ __html: FONT_FACES }} />
        {children}
      </body>
    </html>
  );
}
