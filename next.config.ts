import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server is the security boundary: authorization, tenant isolation,
  // and database access always happen server-side (see ADR 015).
  reactStrictMode: true,
  images: {
    // The landing page's editorial imagery is served from the Pexels CDN
    // (see docs/ui-media-integration.md). Exact hostname only — no
    // wildcards. The landing also references a video (and its poster)
    // hosted on videos.pexels.com / images.pexels.com, which the browser
    // loads directly and this config does not govern.
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
};

export default nextConfig;
