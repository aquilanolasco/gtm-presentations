// Public assets referenced by raw string (img src / CSS url) are NOT rewritten by
// Next's basePath/assetPrefix, so on the static export (served under a sub-path) they
// 404. Prefix them with the export base path. Empty in dev/normal build.
export const ASSET_BASE = process.env.NEXT_PUBLIC_DECK_BASE_PATH || "";

// The product screenshots keep the same filenames when re-captured, so a browser or the
// CDN happily serves a stale copy after a redeploy (this is why cleaned-up phone screens
// kept showing the old chrome). Stamp every screen URL with a version so a new capture is
// a new URL that caches can't answer from memory. Bump this whenever screens are recaptured.
export const SCREEN_V = "20260725a";
const isScreen = (p: string): boolean => /^\/screens[\w-]*\//.test(p) && p.endsWith(".webp");

export const asset = (p: string): string => {
  const base = `${ASSET_BASE}${p}`;
  return isScreen(p) ? `${base}?v=${SCREEN_V}` : base;
};
