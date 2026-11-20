import { AppHeader, Skeleton } from "@/components/ui";

// Own loading state: without it the drop segment's sale-room skeleton would show while the record loads.
export default function Loading() {
  return (
    <>
      <AppHeader />
      <main id="main" aria-busy="true" aria-label="Loading the fairness record" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full rounded-wobble" />
      </main>
    </>
  );
}
