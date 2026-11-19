"use client";
import { Button, Icon } from "@/components/ui";

/** Never a silent wait: a loading screen that has taken more than ~6 s says so and offers a retry. */
export function StillConnecting({ onRetry, what = "the sale room" }: { onRetry: () => void; what?: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-wobble border-2 border-ink bg-peach px-3 py-2">
      <Icon name="clock" size={20} className="text-peach-ink" />
      <p className="min-w-0 flex-1 font-semibold">Still connecting to {what}…</p>
      <Button size="sm" variant="ghost" onClick={onRetry}>Retry</Button>
    </div>
  );
}
