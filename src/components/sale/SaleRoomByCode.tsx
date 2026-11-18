"use client";
// Resolves a share link (/s/<shop>/d/<code>) to the drop, then hands over to the sale room.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { DropState } from "@/lib/types";
import { AppHeader, EmptyState, LinkButton, Skeleton } from "@/components/ui";
import { SaleRoom } from "./SaleRoom";

export function SaleRoomByCode({ shop, code }: { shop: string; code: string }) {
  const [r, setR] = useState<{ dropId: string; state: DropState } | "missing" | "error" | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    api("GET /api/drops/by-code/:shop/:code", undefined, { shop, code })
      .then(setR, (e) => setR(e instanceof ApiError && (e.status === 404 || e.status === 400) ? "missing" : "error"));
  }, [shop, code, n]);

  if (r && typeof r === "object") return <SaleRoom dropId={r.dropId} initial={r.state} />;
  if (r === null) return <SaleRoomLoading />;
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-xl px-4 pt-12">
        {r === "missing" ? (
          <EmptyState icon="bag" title="This sale room doesn't exist"
            body="The link may be mistyped, or the seller removed this drop. Ask the seller for a fresh link."
            action={<LinkButton href="/" variant="ghost">Go home</LinkButton>} />
        ) : (
          <EmptyState icon="warning" title="We couldn't open the sale room"
            body="Check your connection and try again."
            action={<button type="button" className="min-h-12 rounded-md px-3 font-semibold underline" onClick={() => { setR(null); setN((x) => x + 1); }}>Try again</button>} />
        )}
      </main>
    </>
  );
}

export function SaleRoomLoading() {
  return (
    <>
      <AppHeader />
      <main id="main" aria-busy="true" aria-label="Loading the sale room" className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">
        <Skeleton className="aspect-[4/5] w-full rounded-wobble" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-14 w-full rounded-wobble-2" />
        <Skeleton className="h-24 w-full" />
      </main>
    </>
  );
}
