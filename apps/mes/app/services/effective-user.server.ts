import { getConsoleMode, getConsolePinIn } from "./console.server";

/**
 * Returns the effective user ID for action attribution.
 *
 * In console mode with a pinned-in operator, returns the operator's ID.
 * Otherwise returns the session user's ID.
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
