import type { OrderState } from "@/lib/codec";
import { cx } from "./cx";
import { Icon } from "./icons";

const STEPS = [
  { key: "held", word: "Held" },
  { key: "payment_claimed", word: "Payment claimed" },
  { key: "paid", word: "Paid" },
  { key: "shipped", word: "Shipped" },
] as const;

/**
 * Order status: Held → Payment claimed → Paid → Shipped.
 * Steps before `state` are done, `state` is current. `failed` marks the current step as failed
 * with `failedLabel` (e.g. state "held" + failed + "Payment not received"). State "cancelled" fails the first step.
 */
export function Timeline({ state, failed, failedLabel, className }: {
  state: OrderState; failed?: boolean; failedLabel?: string; className?: string;
}) {
  const cancelled = state === "cancelled";
  const cur = cancelled ? 0 : STEPS.findIndex((s) => s.key === state);
  const isFailed = failed || cancelled;
  return (
    <ol className={cx("flex flex-col", className)} aria-label="Order status">
      {STEPS.map((s, i) => {
        const status = i < cur ? "done" : i === cur ? (isFailed ? "failed" : state === "shipped" ? "done" : "current") : "todo";
        return (
          <li key={s.key} className="relative flex min-h-12 items-start gap-3 pb-3 last:pb-0" aria-current={i === cur ? "step" : undefined}>
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className={cx("absolute left-[15px] top-8 bottom-0 w-0 border-l-[3px]", i < cur ? "border-ink" : "border-dashed border-ink/30")} />
            )}
            <span className={cx(
              "relative z-10 grid size-8 shrink-0 place-items-center rounded-blob border-[2.5px]",
              status === "done" && "border-ink bg-mint",
              status === "current" && "border-ink bg-lime shadow-ink-sm",
              status === "failed" && "border-ink bg-pink",
              status === "todo" && "border-ink/40 bg-card",
            )}>
              {status === "done" && <Icon name="check" size={18} stroke={3} draw />}
              {status === "current" && <Icon name="clock" size={18} stroke={2.6} />}
              {status === "failed" && <Icon name="cross" size={16} stroke={3} />}
            </span>
            <span className="pt-1 leading-tight">
              <span className={cx("font-semibold", status === "todo" && "text-muted")}>{s.word}</span>
              <span className="sr-only"> ({status === "todo" ? "not yet" : status})</span>
              {status === "failed" && <span className="block font-hand text-lg text-pink-ink">{failedLabel ?? (cancelled ? "Cancelled" : "Didn't go through")}</span>}
              {status === "current" && <span className="block font-hand text-lg text-muted">Now</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
