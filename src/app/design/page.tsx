import type { Metadata } from "next";
import { Gallery } from "./gallery";

export const metadata: Metadata = {
  title: "Design kit",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  return <Gallery />;
}
