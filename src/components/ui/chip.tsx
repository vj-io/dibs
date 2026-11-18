"use client";
import { cx } from "./cx";
import { Icon } from "./icons";

export type ChipProps = {
  label: string;
  /** Units left; 0 = sold out. Omit to show only the label. */
  left?: number;
  /** People on the waitlist for this variant (shown when sold out). */
  waiting?: number;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  className?: string;
};

/** Variant chip, e.g. "M · 2 left". Toggle button (aria-pressed); sold-out chips stay tappable to join the waitlist. */
export function Chip({ label, left, waiting, selected, disabled, onSelect, className }: ChipProps) {
  const soldOut = left === 0;
  const stock = left === undefined ? null : soldOut ? (waiting ? `sold out · ${waiting} waiting` : "sold out") : `${left} left`;
  return (
    <button
      type="button"
      aria-pressed={!!selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "inline-flex min-h-12 items-center gap-1.5 rounded-wobble border-2 border-ink px-3.5 text-base font-semibold",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "bg-lime shadow-ink-sm" : soldOut ? "bg-pink-soft" : "bg-card",
        className,
      )}
    >
      {selected && <Icon name="check" size={16} stroke={3} />}
      <span className={cx(soldOut && !selected && "line-through decoration-pink decoration-2")}>{label}</span>
      {stock && (
        <>
          <span aria-hidden="true">·</span>
          <span className={cx("font-mono text-sm", selected || (left !== undefined && left > 0 && left <= 2) ? "text-ink" : soldOut ? "text-pink-ink" : "text-muted")}>{stock}</span>
        </>
      )}
    </button>
  );
}
