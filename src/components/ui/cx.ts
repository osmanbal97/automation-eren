/** Tiny class-name joiner. Deliberately not clsx/tailwind-merge -- the app has no
 * runtime UI dependencies and the primitives here never need class conflict resolution. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
