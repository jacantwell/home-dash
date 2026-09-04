import type { NextConfig } from "next";

import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    // Bumped by release-please; surfaced for footers / debugging.
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
