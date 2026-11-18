import type { Metadata } from "next";
import { TryEntry } from "@/components/sale/TryEntry";

export const metadata: Metadata = { title: "Try the live demo" };

export default async function Page({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  return <TryEntry suggested={role === "seller" ? "seller" : "buyer"} />;
}
