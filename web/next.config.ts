import type { NextConfig } from "next";

import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    // Bumped by release-please; surfaced for footers / debugging.
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // /blog is the old name for /chatroom; keep existing links working.
  redirects: async () => [
    { source: "/blog", destination: "/chatroom", permanent: true },
    { source: "/blog/:slug", destination: "/chatroom/:slug", permanent: true },
  ],
  // Dev only: proxy /api to the FastAPI dev server. In prod vercel.json routes /api/* to the
  // python service before Next ever sees it.
  rewrites:
    process.env.NODE_ENV === "development"
      ? async () => [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }]
      : undefined,
};

export default nextConfig;
