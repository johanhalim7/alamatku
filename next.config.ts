import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Dataset wilayah dibaca dari disk oleh route server ini; pastikan ikut
  // terbundel ke fungsi serverless (Vercel).
  outputFileTracingIncludes: {
    "/api/desa": ["./data/wilayah.json"],
    "/api/resolve": ["./data/wilayah.json"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
