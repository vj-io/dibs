"use client";
import { useEffect } from "react";
import { Button, EmptyState } from "@/components/ui";

export default function SellerError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.warn(error); }, [error]);
  return (
    <EmptyState icon="warning" title="This page didn't load."
      body="Your sale data is safe. Check your connection and try again."
      action={<Button icon="arrowRight" onClick={() => retry()}>Try again</Button>} />
  );
}
