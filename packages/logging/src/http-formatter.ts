import type { LogRecord, TextFormatter } from "@logtape/logtape";
import { ansiColorFormatter } from "@logtape/logtape";

const RESET = "\x1b[0m";

/** Morgan "dev"-style status color: red 5xx, yellow 4xx, cyan 3xx, green 2xx. */
function statusColor(status: number): string {
  if (status >= 500) return "\x1b[31m";
  if (status >= 400) return "\x1b[33m";
  if (status >= 300) return "\x1b[36m";
  if (status >= 200) return "\x1b[32m";
  return RESET;
}

/**
 * Colored HTTP access-log line in the style of Morgan's "dev" format:
 * `GET /dashboard 200 12.3 ms`. Reads `method`/`pathname`/`status`/
 * `responseTime` off `record.properties` (set by `requestIdMiddleware`).
 * Falls back to `ansiColorFormatter` for any `carbon.http` record that
 * doesn't look like an access log (e.g. a manual `getLogger("http")` call).
 */
export const httpDevFormatter: TextFormatter = (record: LogRecord) => {
  const { method, pathname, status, responseTime } = record.properties;
  if (
    typeof method !== "string" ||
    typeof pathname !== "string" ||
    typeof status !== "number"
  ) {
    return ansiColorFormatter(record);
  }

  const color = statusColor(status);
  // Truncate (not round) to at most 1 decimal — no padded trailing zero.
  const time =
    typeof responseTime === "number"
      ? ` ${Math.trunc(responseTime * 10) / 10} ms`
      : "";
  return `${method} ${pathname} ${color}${status}${RESET}${time}`;
};
