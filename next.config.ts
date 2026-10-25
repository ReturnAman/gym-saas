import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server is the security boundary: authorization, tenant isolation,
  // and database access always happen server-side (see ADR 015).
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
};

export default nextConfig;
