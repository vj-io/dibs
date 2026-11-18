"use client";
// Error boundary body shared by the buyer routes (error.tsx files).
import { useEffect } from "react";
import { AppHeader, Button, EmptyState, LinkButton } from "@/components/ui";

export function RouteError({ error, retry, what }: { error: unknown; retry: () => void; what: string }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-xl px-4 pt-12">
        <EmptyState icon="warning" title={`Something broke while loading ${what}`}
          body="It's on our side, not yours. Try again; your holds and places in line are safe on the server."
          action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => retry()}>Try again</Button><LinkButton href="/me" variant="ghost">My stuff</LinkButton></div>} />
      </main>
    </>
  );
}
