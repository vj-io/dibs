import type { HTMLAttributes, ReactNode } from "react";
import { cx, TINT_BG, type Tint } from "./cx";
import { DrawnFrame } from "./drawn-frame";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  tint?: Tint;
  /** The ink frame draws itself on entrance (motion-safe); at rest it is a plain drawn box. */
  draw?: boolean;
  /** Less shadow, for nested cards and list rows. */
  flat?: boolean;
  /** Use the alternate wobble so neighbouring cards don't look stamped from one mould. */
  alt?: boolean;
  as?: "div" | "section" | "article";
};

/** Hand-drawn box: ink border, wobbly radius, hard ink shadow. */
export function Card({ tint = "card", draw, flat, alt, as: Tag = "div", className, children, ...rest }: CardProps) {
  return (
    <Tag
      {...rest}
      className={cx(
        "relative border-[2.5px] border-ink",
        draw && "card-draw", alt ? "rounded-wobble-2" : "rounded-wobble",
        flat ? "shadow-ink-sm" : "shadow-ink",
        TINT_BG[tint], "p-4",
        className,
      )}
    >
      {draw && <DrawnFrame />}
      {children}
    </Tag>
  );
}

/** A taped sheet of paper: a Card with a title in handwriting and a strip of tape on top. */
export function Sheet({ title, tint = "card", className, children, ...rest }: Omit<CardProps, "title"> & { title?: ReactNode }) {
  return (
    <Card {...rest} tint={tint} className={cx("p-5 pt-6", className)}>
      <span aria-hidden="true" className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 -rotate-2 rounded-sm border border-ink/20 bg-yellow/80" />
      {title && <h2 className="mb-3 font-hand text-2xl font-normal tracking-normal">{title}</h2>}
      {children}
    </Card>
  );
}
