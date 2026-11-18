import { displayName, tapTime, type Card } from "@/lib/codec";
import { cx } from "./cx";
import { Icon } from "./icons";

export type TickerCard = Extract<Card, { t: "DB:Sold" } | { t: "DB:Back" }>;
export type TickerLine = { id: string; card: TickerCard };

/** One ticker sentence, per the PRD key copy. */
export function tickerText(c: TickerCard): string {
  if (c.t === "DB:Sold") return `Sold to ${displayName(c.buyer)} · ${tapTime(c.ms)}`;
  if (c.buyer) return `Back in play → ${displayName(c.buyer)} from the waitlist`;
  return `Back in play → ${c.variantLabel} is free again`;
}

/**
 * "Sold to Priya S. · 0.4 s" lines, newest first. Pass lines newest-first with stable ids;
 * a line pops in when it first mounts. The list is a polite live region (additions only).
 */
export function Ticker({ lines, max = 6, className }: { lines: TickerLine[]; max?: number; className?: string }) {
  return (
    <ol aria-live="polite" aria-relevant="additions" aria-label="Sold and back in play" className={cx("flex flex-col gap-1.5", className)}>
      {lines.slice(0, max).map(({ id, card }) => {
        const sold = card.t === "DB:Sold";
        return (
          <li key={id}
            className={cx(
              "pop-in flex min-h-10 items-center gap-2 rounded-wobble border-2 border-ink px-3 py-1.5 font-hand text-lg leading-tight",
              sold ? "bg-card" : "bg-yellow",
            )}>
            <span className={cx("grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink", sold ? "bg-pink" : "bg-lime")}>
              <Icon name={sold ? "bag" : "arrowRight"} size={14} stroke={2.6} />
            </span>
            <span className="min-w-0 flex-1">
              {tickerText(card)}
              {card.variantLabel && sold && <span className="text-muted"> · {card.variantLabel}</span>}
            </span>
            {card.isBot && <span className="shrink-0 rounded-pill border-2 border-violet-ink bg-violet px-1.5 font-sans text-sm font-semibold text-violet-ink">🤖 Demo buyer</span>}
          </li>
        );
      })}
    </ol>
  );
}
