import type { Result } from "../types";

export function error(error: any, message = "Request failed"): Result {
  if (error) console.error({ error, message });

  // Surface the underlying error text as the toast description, but only when it
  // adds information beyond the curated title.
  const detail =
    typeof error === "string"
      ? error
      : typeof error?.message === "string"
        ? error.message
        : undefined;

  return {
    success: false,
    message,
    ...(detail && detail !== message ? { description: detail } : {})
  };
}

export function success(message = "Request succeeded", data?: any): Result {
  return {
    success: true,
    message
  };
}
