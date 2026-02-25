export function parseBoolean<T = undefined>(
  value: string | undefined,
  defaultValue?: T
): boolean | T {
  if (!value) return defaultValue as T;

  if (typeof value === "boolean") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue as T; // or throw an error if invalid
}

/**
 * Returns the singular or plural form of a word based on count.
 * @param count - The number to check
 * @param singular - The singular form of the word
 * @param plural - The plural form (defaults to singular + "s")
 * @returns The appropriate form of the word
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
