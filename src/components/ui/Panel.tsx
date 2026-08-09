import type { ReactNode } from "react";
import { cx } from "./cx";

/** Elevated translucent surface used for every card and section on the dashboard. */
export function Panel({
  children,
  className,
  interactive,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cx(
        "glass rounded-panel",
        interactive && "transition hover:border-line-strong hover:bg-white/[0.06]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="animate-rise mb-8">
      {eyebrow ? (
        <div className="mb-2 text-xs font-medium tracking-[0.18em] text-fg-subtle uppercase">
          {eyebrow}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="rule-accent mt-6" />
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-line px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="mt-2 text-sm text-fg-muted">{children}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <Panel className="p-5">
      <div className="text-xs font-medium tracking-wide text-fg-subtle uppercase">{label}</div>
      <div
        className={cx(
          "mt-3 text-3xl font-semibold tracking-tight tabular-nums",
          tone === "accent" && "text-gradient",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-fg-muted">{hint}</div> : null}
    </Panel>
  );
}
