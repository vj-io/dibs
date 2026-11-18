import type { Metadata } from "next";
import { DropsPage } from "@/components/seller/DropsPage";

export const metadata: Metadata = { title: "Drops" };

export default function Page() {
  return <DropsPage />;
}
