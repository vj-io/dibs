import type { CSSProperties, ReactNode } from "react";
import { rupees } from "@/lib/codec";
import { cx, TINT_BG, type Tint } from "./cx";
import { Icon, type IconName } from "./icons";

/** Highlighter swipe span. `swipe` animates it in (motion-safe); `delay` in seconds. */
export function Highlight({ children, color = "lime", swipe = true, delay, className }: {
  children: ReactNode; color?: "lime" | "pink"; swipe?: boolean; delay?: number; className?: string;
}) {
  return (
    <span className={cx("hl", color === "pink" && "hl-pink", swipe && "hl-in", className)}
      style={delay !== undefined ? ({ "--d": `${delay}s` } as CSSProperties) : undefined}>{children}</span>
  );
}

/** Rupee price from paise, in mono. */
export function Price({ paise, size = "md", className }: { paise: number; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  return (
    <span className={cx("font-mono font-bold tabular-nums tracking-tight", { sm: "text-base", md: "text-xl", lg: "text-3xl", xl: "text-5xl" }[size], className)}>
      {rupees(paise)}
    </span>
  );
}

const AVATAR_TINTS: Tint[] = ["yellow", "sky", "mint", "peach", "pink", "lime"];

/** Initial in a wobbly circle. `bot` shows 🤖 on the violet demo tint. */
export function Avatar({ name, bot, size = 40, className }: { name: string; bot?: boolean; size?: number; className?: string }) {
  const tint: Tint = bot ? "violet" : AVATAR_TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.45 }}
      className={cx("inline-grid shrink-0 place-items-center rounded-blob border-[2.5px] border-ink font-extrabold leading-none text-ink", TINT_BG[tint], className)}>
      {bot ? "🤖" : (name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Demo-room banner. Bots are always labelled. */
export function Banner({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div role="note" className={cx("flex items-center gap-2 border-y-2 border-ink bg-violet px-4 py-2 text-[0.95rem] font-semibold leading-snug", className)}>
      <Icon name="robot" size={20} stroke={2.4} className="text-violet-ink" />
      <p>{children ?? "Demo room · 40 🤖 demo buyers · nothing here is real money"}</p>
    </div>
  );
}

/** Live-connection strip. Renders nothing when connected. */
export function ConnectionBar({ status, className }: { status: "connecting" | "connected" | "offline"; className?: string }) {
  if (status === "connected") return null;
  return (
    <div role="status" className={cx("flex flex-wrap items-center gap-x-2 border-y-2 border-ink bg-peach px-4 py-2 font-semibold", className)}>
      <Icon name="warning" size={20} stroke={2.6} className="text-peach-ink" />
      <span>{status === "offline" ? "Reconnecting…" : "Connecting…"}</span>
      <span className="w-full pl-7 font-hand text-lg font-normal leading-tight text-peach-ink sm:ml-auto sm:w-auto sm:pl-0">Dibs is paused until we&apos;re back</span>
    </div>
  );
}

/** Nothing-here-yet panel with a doodle, a sentence and an optional action. */
export function EmptyState({ title, body, icon = "sparkle", action, className }: {
  title: ReactNode; body?: ReactNode; icon?: IconName; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center gap-2 rounded-wobble border-[2.5px] border-dashed border-ink/50 px-5 py-8 text-center", className)}>
      <span className="grid size-16 place-items-center rounded-blob border-[2.5px] border-ink bg-yellow">
        <Icon name={icon} size={30} stroke={2.4} draw />
      </span>
      <p className="mt-1 text-lg font-extrabold">{title}</p>
      {body && <p className="max-w-xs text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Loading placeholder block. Size it with className. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("shimmer block min-h-4 rounded-md border-2 border-ink/15 bg-grey", className)} />;
}
