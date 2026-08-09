import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "success" | "pending" | "idle" | "danger" | "accent";

const TONES: Record<BadgeTone, string> = {
  success: "bg-success-dim text-success ring-success/25",
  pending: "bg-warn-dim text-warn ring-warn/25",
  idle: "bg-white/[0.05] text-fg-subtle ring-white/10",
  danger: "bg-danger-dim text-danger ring-danger/25",
  accent: "bg-accent-violet/12 text-accent-violet ring-accent-violet/30",
};

export function Badge({
  tone = "idle",
  children,
  title,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
