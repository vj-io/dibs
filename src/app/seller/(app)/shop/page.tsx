import type { Metadata } from "next";
import { ShopSettings } from "@/components/seller/ShopSettings";

export const metadata: Metadata = { title: "Shop" };

export default function Page() {
  return <ShopSettings />;
}
