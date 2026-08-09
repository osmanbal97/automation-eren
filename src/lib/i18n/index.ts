import { cookies } from "next/headers";
import type { Dictionary } from "./dictionary";
import { en } from "./en";
import { tr } from "./tr";

export type { Dictionary } from "./dictionary";

export type Locale = "en" | "tr";

export const LOCALE_COOKIE = "locale";

const DICTIONARIES: Record<Locale, Dictionary> = { en, tr };

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "tr";
}

/** Maps our internal locale codes to BCP 47 tags for `.toLocaleString()`/`Intl` calls. */
export function toBcp47(locale: Locale): string {
  return locale === "tr" ? "tr-TR" : "en-US";
}

/**
 * Reads the active locale from the `locale` cookie (server-side only) and returns it
 * alongside the matching dictionary. This is the one call every Server Component page
 * makes; client components receive their slice of `t` as a prop instead, since they
 * can't read cookies directly.
 */
export async function getT(): Promise<{ locale: Locale; t: Dictionary }> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(raw) ? raw : "en";
  return { locale, t: DICTIONARIES[locale] };
}
