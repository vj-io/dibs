import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
  },
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }] },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Camera and microphone are asked for only when a buyer starts a video viewing call.
        { key: "Permissions-Policy", value: "geolocation=(), camera=(self), microphone=(self)" },
      ],
    }];
  },
};

export default nextConfig;
