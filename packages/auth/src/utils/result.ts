import type { TranslatableError } from "@carbon/result";
import type { I18n, MessageDescriptor } from "@lingui/core";
import type { FlashResult } from "../types";

export function error(error: any, message = "Request failed"): FlashResult {
  if (error) console.error({ error, message });

  return {
    success: false,
    message: message
  };
}

export function success(
  message = "Request succeeded",
  data?: any
): FlashResult {
  return {
    success: true,
    message
  };
}

/**
 * Converts a failed Result's error into a FlashResult, resolving the error's
 * Lingui descriptor in the requester's locale at write time. This is the
 * boundary between the typed Result world (services) and the existing
 * flash/toast machinery — the user sees a message in their own language.
 *
 * Like the legacy `error()` helper, it logs: a DatabaseError carries the raw
 * PostgrestError on `cause`, so on-call developers keep full debugging detail
 * even though the user only ever sees the generic translated message.
 *
 * Defects (raw throws, better-result `Panic`) must NOT be routed here — they
 * continue to the route ErrorBoundary. Result models expected failures only.
 */
export function errorFlash(error: TranslatableError, i18n: I18n): FlashResult {
  const descriptor = error.messageDescriptor;
  const message = i18n._({
    ...descriptor,
    values: { ...descriptor.values, ...error.values }
  });

  console.error({
    tag: error._tag,
    message,
    values: error.values,
    ...(error.cause ? { cause: error.cause } : {})
  });

  return {
    success: false,
    message
  };
}

/** The success counterpart of {@link errorFlash}: translates a descriptor at write time. */
export function successFlash(
  message: MessageDescriptor | string,
  i18n: I18n
): FlashResult {
  return {
    success: true,
    message: typeof message === "string" ? message : i18n._(message)
  };
}
