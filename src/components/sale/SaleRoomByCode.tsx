"use client";
// Resolves a share link (/s/<shop>/d/<code>) to the drop, then hands over to the sale room.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useSlow, withTimeout } from "@/lib/client/hooks";
import type { DropState } from "@/lib/types";
import { AppHeader, EmptyState, LinkButton, Skeleton } from "@/components/ui";
import { SaleRoom } from "./SaleRoom";
import { StillConnecting } from "./StillConnecting";

export function SaleRoomByCode({ shop, code }: { shop: string; code: string }) {
  const [r, setR] = useState<{ dropId: string; state: DropState } | "missing" | "error" | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    // 12 s at most for the first paint's request; a timeout shows the retry screen (the late answer is ignored)
    let gone = false;
    withTimeout(api("GET /api/drops/by-code/:shop/:code", undefined, { shop, code }), 12_000)
      .then((x) => { if (!gone) setR(x); }, (e) => { if (!gone) setR(e instanceof ApiError && (e.status === 404 || e.status === 400) ? "missing" : "error"); });
    return () => { gone = true; };
  }, [shop, code, n]);

  // a failed or slow first load keeps trying by itself every 4 s (the screen says so and offers Try again)
  useEffect(() => {
    if (r !== "error") return;
    const t = setTimeout(() => { setR(null); setN((x) => x + 1); }, 4000);
    return () => clearTimeout(t);
  }, [r]);

  if (r && typeof r === "object") return <SaleRoom dropId={r.dropId} initial={r.state} />;
  if (r === null) return <SaleRoomLoading onRetry={() => setN((x) => x + 1)} />;
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-xl px-4 pt-12">
        {r === "missing" && <h1 className="sr-only">This sale room doesn&apos;t exist</h1>}
        {r === "missing" ? (
          <EmptyState icon="bag" title="This sale room doesn't exist"
            body="The link may be mistyped, or the seller removed this drop. Ask the seller for a fresh link."
            action={<LinkButton href="/" variant="ghost">Go home</LinkButton>} />
        ) : (
          <EmptyState icon="warning" title="We couldn't open the sale room"
            body="Trying again by itself every few seconds. You can also tap Try again."
            action={<button type="button" className="min-h-12 rounded-md px-3 font-semibold underline" onClick={() => { setR(null); setN((x) => x + 1); }}>Try again</button>} />
        )}
      </main>
    </>
  );
}

export function SaleRoomLoading({ onRetry }: { onRetry?: () => void }) {
  const slow = useSlow(6000);
  return (
    <>
      <AppHeader />
      <main id="main" aria-busy="true" aria-label="Loading the sale room" className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">
        {slow && <StillConnecting onRetry={onRetry ?? (() => location.reload())} />}
        <Skeleton className="aspect-[4/5] w-full rounded-wobble" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-14 w-full rounded-wobble-2" />
        <Skeleton className="h-24 w-full" />
      </main>
    </>
  );
}
