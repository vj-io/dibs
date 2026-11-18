// Decorative strokes and the Dibs logo. All aria-hidden except the logo.
import { cx } from "./cx";

const S = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The price-tag mark: a tilted tag with a hand-drawn "!" and a string. */
export function TagMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={cx("shrink-0", className)}>
      <g transform="rotate(-14 20 20)">
        <path d="M9.5 9.8 L24.6 9.2 L33.4 19.6 L24.9 30.4 L9.8 30.9 C8.5 23.8 8.4 16.6 9.5 9.8 Z" fill="var(--color-lime)" stroke="var(--color-ink)" strokeWidth={2.6} strokeLinejoin="round" />
        <circle cx={26.2} cy={19.8} r={2.1} fill="var(--color-card)" stroke="var(--color-ink)" strokeWidth={2} />
        <path d="M16.6 14.4 C16.4 17 16.5 19.4 16.8 21.8 M16.9 25.6 L16.9 25.8" {...S} stroke="var(--color-ink)" strokeWidth={3.2} />
      </g>
      <path d="M29.6 15.4 C33 12.6 35.2 9.4 35.6 4.6" {...S} stroke="var(--color-ink)" strokeWidth={2} />
    </svg>
  );
}

/** Wordmark "Dibs!" with a lime swipe and the tag mark. */
/** `compact`: below 640 px only the tag mark shows (for crowded headers). */
export function Logo({ size = "md", compact, className }: { size?: "sm" | "md" | "lg"; compact?: boolean; className?: string }) {
  const text = { sm: "text-xl", md: "text-2xl", lg: "text-5xl" }[size];
  const mark = { sm: 26, md: 32, lg: 60 }[size];
  return (
    <span className={cx("inline-flex items-center gap-1.5 font-extrabold tracking-tight text-ink", text, className)}>
      <TagMark size={mark} />
      <span className={cx("hl leading-none", compact && "hidden sm:inline")} style={{ backgroundSize: "100% 46%" }}>Dibs!</span>
    </span>
  );
}

/** Wavy underline. Give it a width (e.g. w-40 or w-full). */
export function Squiggle({ className, color = "currentColor", draw = true }: { className?: string; color?: string; draw?: boolean }) {
  return (
    <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true" className={cx("block h-3", className)}>
      <path d="M2 7 C10 1, 18 1, 26 6 S42 11, 50 6 S66 1, 74 6 S90 11, 98 6 S112 2, 118 5" {...S} stroke={color} strokeWidth={3} pathLength={draw ? 1 : undefined} className={draw ? "draw" : undefined} />
    </svg>
  );
}

/** Curved hand-drawn arrow pointing right (rotate it with CSS for other directions). */
export function Arrow({ className, color = "currentColor", draw = true }: { className?: string; color?: string; draw?: boolean }) {
  return (
    <svg viewBox="0 0 80 36" aria-hidden="true" className={cx("h-9 w-20", className)}>
      <path d="M4 22 C20 8, 44 30, 70 15 M58 7 C63 10, 67 12, 71 15 C67 19, 63 23, 61 28" {...S} stroke={color} strokeWidth={3.2} pathLength={draw ? 1 : undefined} className={draw ? "draw" : undefined} />
    </svg>
  );
}

/** Pen scribble: crossing-out or emphasis. */
export function Scribble({ className, color = "currentColor", draw = true }: { className?: string; color?: string; draw?: boolean }) {
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" className={cx("block", className)}>
      <path d="M4 30 L24 8 L18 32 L44 6 L38 34 L66 6 L58 34 L86 8 L80 30 L96 14" {...S} stroke={color} strokeWidth={3} pathLength={draw ? 1 : undefined} className={draw ? "draw" : undefined} />
    </svg>
  );
}

/** Win burst: lime and pink doodle sparks around a centre. Static when motion is reduced. */
export function Burst({ className }: { className?: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    const r1 = i % 2 ? 30 : 36, r2 = i % 2 ? 44 : 56;
    const p = (r: number) => `${(60 + Math.cos(a) * r).toFixed(1)} ${(60 + Math.sin(a) * r).toFixed(1)}`;
    return { d: `M${p(r1)} L${p(r2)}`, c: i % 3 === 0 ? "var(--color-pink)" : i % 3 === 1 ? "var(--color-ink)" : "var(--color-lime-ink)" };
  });
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={cx("burst-in pointer-events-none", className)}>
      {rays.map((r, i) => (
        <path key={i} d={r.d} {...S} stroke={r.c} strokeWidth={4} pathLength={1} strokeDasharray={1} style={{ animationDelay: `${(i % 4) * 0.04}s` }} />
      ))}
      <path d="M22 26 C24 30 26 32 30 33 C26 34 24 36 22 40 C20 36 18 34 14 33 C18 32 20 30 22 26 Z M96 82 C97.5 85 99 86.5 102 87 C99 88 97.5 89.5 96 92 C94.5 89.5 93 88 90 87 C93 86.5 94.5 85 96 82 Z" fill="var(--color-lime)" stroke="var(--color-ink)" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
