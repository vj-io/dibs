import { AppHeader, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <AppHeader />
      <main id="main" aria-busy="true" aria-label="Loading the demo" className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-8">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-28 w-full rounded-wobble" />
        <Skeleton className="h-28 w-full rounded-wobble" />
      </main>
    </>
  );
}
