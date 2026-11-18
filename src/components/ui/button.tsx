"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "dibs" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  dibs: "bg-lime text-ink w-full min-h-14 text-2xl shadow-ink-lg",
  primary: "bg-lime text-ink shadow-ink",
  ghost: "bg-card text-ink shadow-ink-sm",
  danger: "bg-pink text-ink shadow-ink",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-12 px-3.5 text-base",
  md: "min-h-12 px-5 text-lg",
  lg: "min-h-14 px-6 text-xl",
};

/**
 * Class string for any button-looking element (links included).
 * Pressed state is pure CSS `:active` with no transition, so it lands in the same frame as the tap.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cx(
    "relative inline-flex select-none items-center justify-center gap-2 border-[2.5px] border-ink font-extrabold leading-tight tracking-tight no-underline",
    "rounded-wobble-2 touch-manipulation",
    "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
    "disabled:cursor-not-allowed disabled:bg-grey disabled:text-grey-ink disabled:shadow-none disabled:active:translate-x-0 disabled:active:translate-y-0",
    "aria-busy:cursor-progress",
    variant !== "dibs" && SIZE[size],
    VARIANT[variant],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Shows a working state; the button stays focusable but ignores taps. */
  busy?: boolean;
  busyLabel?: string;
  /** Disables the button and says why, inside the button (e.g. "Reconnecting…"). */
  disabledReason?: string;
};

export function Button({
  variant = "primary", size = "md", icon, busy, busyLabel = "Checking…", disabledReason, disabled,
  className, children, onPointerDown, onClick, type = "button", ...rest
}: ButtonProps) {
  const off = disabled || !!disabledReason;
  return (
    <button
      {...rest}
      type={type}
      disabled={off}
      aria-busy={busy || undefined}
      onPointerDown={(e) => {
        if (variant === "dibs" && !off && !busy) navigator.vibrate?.(12);
        onPointerDown?.(e);
      }}
      onClick={(e) => { if (busy) { e.preventDefault(); return; } onClick?.(e); }}
      className={buttonClasses(variant, size, cx((variant === "dibs" || disabledReason) && "flex-col gap-0 py-1.5", className))}
    >
      <span className="inline-flex items-center gap-2">
        {busy ? <Icon name="clock" size={variant === "dibs" ? 26 : 20} className="motion-safe:animate-spin motion-safe:[animation-duration:1.6s]" />
          : icon ? <Icon name={icon} size={variant === "dibs" ? 28 : 20} stroke={variant === "dibs" ? 2.6 : 2.2} /> : null}
        <span>{busy ? busyLabel : children}</span>
      </span>
      {disabledReason && !busy && (
        <span className={cx("font-hand font-normal tracking-normal", variant === "dibs" ? "text-lg leading-tight" : "text-base")}>{disabledReason}</span>
      )}
    </button>
  );
}

/** A Next.js link that looks like a button. */
export function LinkButton({
  variant = "primary", size = "md", icon, className, children, ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; children: ReactNode }) {
  return (
    <Link {...rest} className={buttonClasses(variant, size, className)}>
      {icon && <Icon name={icon} size={20} />}
      <span>{children}</span>
    </Link>
  );
}
