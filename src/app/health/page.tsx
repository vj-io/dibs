import type { Metadata } from "next";
import { HealthClient } from "@/components/info/health-client";

export const metadata: Metadata = { title: "Health", robots: { index: false, follow: false } };

export default function Health() {
  return <HealthClient />;
}
