import type { Metadata } from "next";
import { DeskView } from "@/components/seller/DeskView";

export const metadata: Metadata = { title: "Desk" };

export default function Page() {
  return <DeskView />;
}
