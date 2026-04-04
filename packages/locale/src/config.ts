export const supportedLanguages = ["en", "pl"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export const defaultLanguage: SupportedLanguage = "en";
export const localeCookieName = "locale";

export const resolveLanguage = (
  locale: string | null | undefined
): SupportedLanguage => {
  if (!locale) return defaultLanguage;
  const normalized = locale.toLowerCase().split("-")[0];
  if (normalized === "pl") return "pl";
  return "en";
};
