import type { Metadata } from "next";
import { SaleRoomByCode } from "@/components/sale/SaleRoomByCode";

export const metadata: Metadata = { title: "Sale room" };

export default async function Page({ params }: { params: Promise<{ shop: string; drop: string }> }) {
  const { shop, drop } = await params;
  return <SaleRoomByCode shop={shop} code={drop} />;
}
