import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/server/queries";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/try", "/how-it-works", "/impact"].map((p) => ({ url: appUrl() + p }));
}
