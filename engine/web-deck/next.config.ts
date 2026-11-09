import type { NextConfig } from "next";

// Static-export mode for hosting the deck under <APP_DOMAIN>/presentations/... :
//   DECK_EXPORT=1 DECK_BASE_PATH=/presentations/acme-introduction-deck npm run build
// Normal `npm run dev` / `npm run build` behaviour is unchanged when DECK_EXPORT is unset.
const basePath = process.env.DECK_BASE_PATH || "";
// ASSET_PREFIX lets the generated-deck shell (/gen) load its _next assets from a fixed shared path
// (so it can be built ONCE and reused by every generated deck). Defaults to basePath, so master
// deck builds (which never set it) are completely unchanged.
const assetPrefix = process.env.ASSET_PREFIX || basePath;
const nextConfig: NextConfig = {
  ...(process.env.DECK_EXPORT === "1"
    ? { output: "export" as const, basePath, assetPrefix, images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
