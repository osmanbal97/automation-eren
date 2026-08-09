"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/app/actions";
import { cx } from "@/components/ui";
import type { Locale } from "@/lib/i18n";

const OPTIONS: { locale: Locale; flag: string; label: string }[] = [
  { locale: "en", flag: "🇬🇧", label: "English" },
  { locale: "tr", flag: "🇹🇷", label: "Türkçe" },
];

/** Fixed top-right flag pill. Clicking a flag flips the `locale` cookie via a server
 * action and calls router.refresh() -- every Server Component re-renders with the new
 * dictionary immediately, no navigation and no full page reload. */
export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSelect(next: Locale) {
    if (next === locale || isPending) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <div
      className="glass fixed top-4 right-4 z-50 flex gap-1 rounded-full p-1"
      role="group"
      aria-label="Language"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.locale}
          type="button"
          title={option.label}
          aria-pressed={option.locale === locale}
          onClick={() => handleSelect(option.locale)}
          disabled={isPending}
          className={cx(
            "flex size-8 items-center justify-center rounded-full text-base leading-none transition",
            option.locale === locale
              ? "bg-white/15 ring-1 ring-white/25"
              : "opacity-50 hover:opacity-90",
            isPending && "cursor-wait",
          )}
        >
          <span aria-hidden>{option.flag}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
