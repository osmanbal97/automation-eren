"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n";
import { cx } from "./ui/cx";

type NavItem = {
  href: string;
  label: string;
  glyph: string;
  /** Sections whose screens land in later stories -- shown, but not linkable yet. */
  soon?: boolean;
};

function buildNav(dict: Dictionary["sidebar"]): NavItem[] {
  return [
    { href: "/", label: dict.nav.overview, glyph: "◎" },
    { href: "/niches", label: dict.nav.niches, glyph: "◇" },
    { href: "/settings/providers", label: dict.nav.providers, glyph: "⬡" },
    { href: "/history", label: dict.nav.history, glyph: "≡" },
    { href: "/socials", label: dict.nav.socials, glyph: "⚭" },
    { href: "/usage", label: dict.nav.usage, glyph: "◧" },
    { href: "/videos", label: dict.nav.videos, glyph: "▶", soon: true },
    { href: "/schedule", label: dict.nav.schedule, glyph: "◷", soon: true },
  ];
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ dict }: { dict: Dictionary["sidebar"] }) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = buildNav(dict);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-full flex-col gap-8 px-4 py-6 lg:w-64 lg:shrink-0">
      <Link href="/" className="flex items-center gap-3 px-2">
        <span className="bg-accent-gradient flex size-9 items-center justify-center rounded-xl text-base font-semibold text-white shadow-[0_8px_24px_-10px_rgba(139,92,246,0.9)]">
          ✦
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">{dict.brandName}</span>
          <span className="block text-xs text-fg-subtle">{dict.brandTagline}</span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {nav.map((item) => {
          const active = isActive(pathname, item.href);
          const content = (
            <>
              <span
                className={cx(
                  "w-4 text-center text-sm",
                  active ? "text-accent-violet" : "text-fg-subtle",
                )}
                aria-hidden
              >
                {item.glyph}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.soon ? (
                <span className="text-[10px] tracking-wide text-fg-subtle uppercase">{dict.soonTag}</span>
              ) : null}
            </>
          );

          if (item.soon) {
            return (
              <span
                key={item.href}
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-fg-subtle/70"
                title={dict.soonTooltip}
              >
                {content}
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                active
                  ? "glass text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-fg-muted hover:bg-white/[0.05] hover:text-fg",
              )}
            >
              {content}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={logout}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-fg-muted transition hover:bg-white/[0.05] hover:text-fg"
      >
        <span className="w-4 text-center text-sm text-fg-subtle" aria-hidden>
          ⏻
        </span>
        {dict.signOut}
      </button>
    </aside>
  );
}
