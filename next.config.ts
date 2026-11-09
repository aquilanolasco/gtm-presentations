import type { NextConfig } from "next";

// Trimmed: the original config also carried rewrites and redirects for other workspace modules.
const nextConfig: NextConfig = {
  // The workspace is internal and must never be indexed.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" }] }];
  },

  // deploy.sh ships .next/standalone (server.js) to the VPS and runs it under PM2.
  output: "standalone",
};

export default nextConfig;
