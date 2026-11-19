import type { ReactNode } from "react";
import { cx, TINT_BG, TINT_INK, type Tint } from "./cx";
import { Icon, type IconName } from "./icons";

/** Small label: a sticky-note tint, an icon in the tint's ink, and an ink word. */
export function Badge({ tint = "card", icon, children, className, size = "md" }: {
  tint?: Tint; icon?: IconName; children: ReactNode; className?: string; size?: "sm" | "md";
}) {
  return (
    <span className={cx(
      "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-pill border-2 border-ink font-semibold leading-none text-ink",
      size === "sm" ? "px-2 py-1 text-sm" : "px-2.5 py-1.5 text-[0.95rem]",
      TINT_BG[tint], className,
    )}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} stroke={2.6} className={TINT_INK[tint]} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export type PillState =
  | "live" | "waiting" | "held" | "waitlisted" | "payment_claimed" | "paid" | "shipped"
  | "expired" | "released" | "cancelled" | "sold_out" | "closed" | "ended" | "demo";

export const PILL: Record<PillState, { tint: Tint; icon: IconName; word: string }> = {
  live: { tint: "lime", icon: "live", word: "LIVE" },
  waiting: { tint: "yellow", icon: "clock", word: "Waiting" },
  held: { tint: "lime", icon: "lock", word: "Held for you" },
  waitlisted: { tint: "yellow", icon: "queue", word: "Waitlisted" },
  payment_claimed: { tint: "sky", icon: "rupee", word: "Payment claimed" },
  paid: { tint: "mint", icon: "check", word: "Paid" },
  shipped: { tint: "mint", icon: "truck", word: "Shipped" },
  expired: { tint: "peach", icon: "clock", word: "Expired" },
  released: { tint: "grey", icon: "arrowRight", word: "Released" },
  cancelled: { tint: "grey", icon: "cross", word: "Cancelled" },
  sold_out: { tint: "pink", icon: "bag", word: "Sold out" },
  closed: { tint: "grey", icon: "lock", word: "Closed" },
  ended: { tint: "grey", icon: "check", word: "Ended" },
  demo: { tint: "violet", icon: "robot", word: "Demo" },
};

/** A state = icon + word + tint, never colour alone. `label` replaces the word (e.g. "#2 on the waitlist"). */
export function StatePill({ state, label, size, className }: { state: PillState; label?: ReactNode; size?: "sm" | "md"; className?: string }) {
  const p = PILL[state];
  return (
    <Badge tint={p.tint} size={size} className={cx(state === "live" && "font-extrabold tracking-wide", className)}
      icon={state === "live" ? undefined : p.icon}>
      {/* ml/mr leave room for the 2 px ring inside the label's overflow box: it clipped on the left and touched the L */}
      {state === "live" && <span aria-hidden="true" className="live-dot ml-0.5 mr-1.5 inline-block size-2.5 rounded-full bg-pink ring-2 ring-ink" />}
      {label ?? p.word}
    </Badge>
  );
}

export type StampWord = "SOLD" | "PAID" | "SHIPPED" | "YOURS";
const STAMP: Record<StampWord, string> = {
  SOLD: "text-pink-ink",
  PAID: "text-mint-ink",
  SHIPPED: "text-sky-ink",
  YOURS: "text-ink bg-lime",
};

/** Rotated rubber stamp that thuds down on mount (motion-safe). Position it with className. */
export function Stamp({ word, tilt = -8, className, size = "md" }: { word: StampWord; tilt?: number; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      role="img" aria-label={word.toLowerCase()}
      style={{ ["--tilt" as string]: `${tilt}deg` }}
      className={cx("stamp stamp-in font-sans", { sm: "text-base", md: "text-2xl", lg: "text-4xl" }[size], STAMP[word], className)}
    >{word}</span>
  );
}
