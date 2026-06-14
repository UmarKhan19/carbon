import type { TranslatableError } from "@carbon/result";
import type { I18n, MessageDescriptor } from "@lingui/core";
import type { FlashResult } from "../types";

function isI18n(value: unknown): value is I18n {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { _?: unknown })._ === "function"
  );
}

function isTranslatableError(value: unknown): value is TranslatableError {
  return (
    !!value &&
    typeof value === "object" &&
    "_tag" in value &&
    "messageDescriptor" in value
  );
}

function isMessageDescriptor(value: unknown): value is MessageDescriptor {
  return !!value && typeof value === "object" && "id" in value;
}

/** Fill `{placeholder}`s from values — used for the English fallback when no i18n is given. */
function interpolate(
  template: string,
  values: Record<string, unknown>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in values ? String(values[key]) : `{${key}}`
  );
}

/**
 * Builds an error FlashResult.
 *
 * Two modes:
 * - **Typed Result errors** — pass a tagged `TranslatableError` and the
 *   request i18n; the error's Lingui descriptor is resolved (with interpolation)
 *   in the requester's locale at write time. Omit i18n to fall back to the
 *   English source. The raw `cause` (e.g. a PostgrestError) is logged but never
 *   shown to the user.
 * - **Legacy** — pass any value plus a hardcoded English message string. Kept so
 *   un-migrated call sites keep working unchanged.
 *
 * Defects (raw throws, better-result `Panic`) must NOT be routed here — they
 * continue to the route ErrorBoundary. Result models expected failures only.
 */
export function error(error: TranslatableError, i18n?: I18n): FlashResult;
export function error(error?: unknown, message?: string): FlashResult;
export function error(error?: unknown, second?: string | I18n): FlashResult {
  if (isTranslatableError(error)) {
    const descriptor = error.messageDescriptor;
    const i18n = isI18n(second) ? second : undefined;
    const values = { ...descriptor.values, ...error.values };
    const message = i18n
      ? i18n._({ ...descriptor, values })
      : interpolate(descriptor.message ?? descriptor.id, values);

    console.error({
      tag: error._tag,
      message,
      values: error.values,
      ...(error.cause ? { cause: error.cause } : {})
    });

    return { success: false, message };
  }

  const message = typeof second === "string" ? second : "Request failed";
  if (error) console.error({ error, message });

  return { success: false, message };
}

/**
 * Builds a success FlashResult. Pass a Lingui descriptor + the request i18n to
 * translate at write time (i18n optional → English source), or a plain string
 * for the legacy path.
 */
export function success(message: MessageDescriptor, i18n?: I18n): FlashResult;
export function success(message?: string, data?: unknown): FlashResult;
export function success(
  message?: string | MessageDescriptor,
  second?: I18n | unknown
): FlashResult {
  if (isMessageDescriptor(message)) {
    const i18n = isI18n(second) ? second : undefined;
    return {
      success: true,
      message: i18n ? i18n._(message) : (message.message ?? message.id)
    };
  }

  return {
    success: true,
    message: typeof message === "string" ? message : "Request succeeded"
  };
}
