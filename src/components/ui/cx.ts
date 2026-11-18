export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Sticky-note tints. Each pairs a fill with its measured text colour. */
export type Tint = "card" | "paper" | "lime" | "pink" | "yellow" | "sky" | "mint" | "peach" | "grey" | "violet";

export const TINT_BG: Record<Tint, string> = {
  card: "bg-card", paper: "bg-paper", lime: "bg-lime", pink: "bg-pink-soft", yellow: "bg-yellow",
  sky: "bg-sky", mint: "bg-mint", peach: "bg-peach", grey: "bg-grey", violet: "bg-violet",
};

/** Icon/accent colour that reads on its own tint (>= 4.5:1). Body text on tints stays ink. */
export const TINT_INK: Record<Tint, string> = {
  card: "text-ink", paper: "text-ink", lime: "text-ink", pink: "text-pink-ink", yellow: "text-yellow-ink",
  sky: "text-sky-ink", mint: "text-mint-ink", peach: "text-peach-ink", grey: "text-grey-ink", violet: "text-violet-ink",
};
