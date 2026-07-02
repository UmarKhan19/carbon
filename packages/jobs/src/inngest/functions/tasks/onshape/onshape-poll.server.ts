// Onshape translations can take minutes for large assemblies; the file pulls run
// in a retrying background job, so poll on a minutes-scale budget (≈150 × 2s).
export const BACKGROUND_POLL = { maxAttempts: 150, delayMs: 2000 } as const;

export function isTranslationTimeout(err: unknown): boolean {
  return err instanceof Error && /did not complete within/i.test(err.message);
}
