import type { Metadata } from "next";
import { ClubPage } from "@/components/club/ClubPage";

export const metadata: Metadata = { title: "Shop club" };

export default async function Page({ params }: { params: Promise<{ shop: string }> }) {
  const { shop } = await params;
  return <ClubPage slug={shop} />;
}
