import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/** One shared control skin, replacing the `inputClass` string that used to be
 * duplicated across NicheFormFields and IdeaReviewCard. */
export const controlClass =
  "w-full rounded-lg border border-line bg-ink-900/70 px-3.5 py-2.5 text-sm text-fg " +
  "placeholder:text-fg-subtle transition outline-none " +
  "focus:border-accent-violet/60 focus:ring-2 focus:ring-accent-violet/25";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(controlClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(controlClass, "resize-y leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(controlClass, "appearance-none pr-8", className)} {...props} />;
}
