import type { Result } from "../types";

export function error(error: any, message = "Request failed"): Result {
  // Log the raw error (DB constraint names, stack, etc.) for developers via the
  // server console — never surface it in the user-facing toast, which shows only
  // the curated `message`.
  if (error) console.error({ error, message });

  return {
    success: false,
    message
  };
}

export function success(message = "Request succeeded", data?: any): Result {
  return {
    success: true,
    message
  };
}
