import { getConsoleMode, getConsolePinIn } from "./console.server";

/**
 * Returns the effective user ID for action attribution.
 *
 * - Console mode OFF → returns session user
 * - Console mode ON + pinned in → returns operator
 * - Console mode ON + nobody pinned in → returns session user
 *
 * Write operations are gated by the middleware (user.ts) which
 * rejects non-GET requests when console mode is on and nobody
 * is pinned in. Routes don't need to check for null.
 *
 * This is a pure cookie read — no DB queries, fully synchronous.
 */
export function getEffectiveUserId(
  request: Request,
  args: { companyId: string; sessionUserId: string }
): string {
  const { companyId, sessionUserId } = args;

  if (!getConsoleMode(request, companyId)) {
    return sessionUserId;
  }

  const pinIn = getConsolePinIn(request, companyId);
  return pinIn?.userId ?? sessionUserId;
}
