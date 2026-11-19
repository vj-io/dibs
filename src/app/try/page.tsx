import type { Metadata } from "next";
import { WhatYoullSee } from "@/components/info/WhatYoullSee";
import { TryEntry } from "@/components/sale/TryEntry";

export const metadata: Metadata = { title: "Try the live demo" };

export default async function Page({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  return (
    // TryEntry (off-limits here) renders its own header, main and footer. display:contents lets the
    // "What you'll see" block sit between its main and its footer inside the body's flex column.
    <div className="contents [&>footer]:order-2 [&>main]:flex-none">
      <TryEntry suggested={role === "seller" ? "seller" : "buyer"} />
      <div className="order-1 flex-1"><WhatYoullSee /></div>
    </div>
  );
}
