import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages retired in the 2026-10-17 nav cleanup; keep old bookmarks working.
  async redirects() {
    return [
      { source: "/cost",    destination: "/finance?tab=cost",   permanent: false },
      { source: "/billing", destination: "/finance?tab=stripe", permanent: false },
      { source: "/sales",   destination: "/content/research",   permanent: false },
      { source: "/backup",  destination: "/tools",              permanent: false },
    ];
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
