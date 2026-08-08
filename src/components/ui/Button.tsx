import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet/70 " +
  "disabled:cursor-not-allowed disabled:opacity-45";

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-gradient text-white shadow-[0_10px_30px_-14px_rgba(139,92,246,0.9)] " +
    "hover:brightness-110 active:brightness-95",
  secondary:
    "glass text-fg hover:border-line-strong hover:bg-white/[0.07]",
  ghost: "text-fg-muted hover:text-fg hover:bg-white/[0.05]",
  danger:
    "border border-danger/40 bg-danger-dim text-danger hover:border-danger/70 hover:bg-danger/15",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return cx(BASE, SIZES[size], VARIANTS[variant]);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />;
}
