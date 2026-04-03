export const isBrowser =
  typeof document !== "undefined" &&
  typeof (globalThis as Record<string, unknown>).process === "undefined";
