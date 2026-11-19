import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/server/queries";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/seller", "/o/", "/me", "/health", "/api/", "/design", "/poc"] },
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
