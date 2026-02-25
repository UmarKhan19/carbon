declare const document: unknown;
declare const process: unknown;

export const isBrowser =
  typeof document !== "undefined" && typeof process === "undefined";
