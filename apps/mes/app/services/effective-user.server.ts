import { getConsoleMode, getConsolePinIn } from "./console.server";

/**
 * Returns the effective user ID for action attribution.
 *
 * - Console mode OFF → returns session user
 * - Console mode ON + pinned in → returns operator
 * - Console mode ON + nobody pinned in → returns session user for reads,
 *   throws 403 for writes (use requirePinnedIn for actions)
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

/**
 * Same as getEffectiveUserId but throws 403 if console mode is on
 * and nobody is pinned in. Use this in action routes (POST/writes)
 * to enforce pin-in before performing work.
 */
export function requirePinnedIn(
  request: Request,
  args: { companyId: string; sessionUserId: string }
): string {
  const { companyId, sessionUserId } = args;

  if (!getConsoleMode(request, companyId)) {
    return sessionUserId;
  }

  const pinIn = getConsolePinIn(request, companyId);
  if (!pinIn) {
    throw new Response(
      JSON.stringify({
        error: "Please pin in before performing this action"
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return pinIn.userId;
}
