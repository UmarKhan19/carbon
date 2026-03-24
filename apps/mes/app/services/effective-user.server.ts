import { getConsoleMode, getConsolePinIn } from "./console.server";

/**
 * Returns the effective user ID for action attribution.
 *
 * - Console mode OFF → returns session user
 * - Console mode ON + pinned in → returns operator
 * - Console mode ON + nobody pinned in → throws Response (blocks the action)
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
