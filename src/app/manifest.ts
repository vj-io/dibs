import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dibs — First tap wins",
    short_name: "Dibs",
    description: "First tap wins. Everyone sees it. Nobody gets lost in the DMs.",
    start_url: "/",
    display: "standalone",
    background_color: "#f0ede8",
    theme_color: "#f0ede8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
