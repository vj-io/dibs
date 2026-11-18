import { AppHeader, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <AppHeader title="Order" />
      <main id="main" aria-busy="true" aria-label="Loading your order" className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">
        <Skeleton className="h-36 w-full rounded-wobble" />
        <Skeleton className="h-48 w-full rounded-wobble" />
        <Skeleton className="h-40 w-full" />
      </main>
    </>
  );
}
