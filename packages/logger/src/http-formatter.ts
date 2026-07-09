import { getAnsiColorFormatter, type TextFormatter } from "@logtape/logtape";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

/** Morgan "dev"-style status color: red 5xx, yellow 4xx, cyan 3xx, green 2xx. */
function statusColor(status: number): string {
  if (status >= 500) return "\x1b[31m";
  if (status >= 400) return "\x1b[33m";
  if (status >= 300) return "\x1b[36m";
  if (status >= 200) return "\x1b[32m";
  return RESET;
}

/**
 * Same timestamp/level/category prefix as the standard `ansiColorFormatter`,
 * but the message portion of an HTTP access-log record (set by
 * `requestIdMiddleware`) renders Morgan "dev"-style: `GET /dashboard 200
 * 12.3 ms`, with the status colored by range. Any `carbon.http` record that
 * isn't a recognized access log (e.g. a manual `getLogger("http")` call)
 * falls back to the normally-rendered message.
 */
export const httpDevFormatter: TextFormatter = getAnsiColorFormatter({
  format({ timestamp, level, category, message, record }) {
    const { method, pathname, status, responseTime, body } = record.properties;

    let line = message;
    if (
      typeof method === "string" &&
      typeof pathname === "string" &&
      typeof status === "number"
    ) {
      // Truncate (not round) to at most 1 decimal — no padded trailing zero.
      const time =
        typeof responseTime === "number"
          ? ` ${DIM}${Math.trunc(responseTime * 10) / 10} ms${RESET}`
          : "";
      line = `${BOLD}${method}${RESET} ${pathname} ${statusColor(status)}${status}${RESET}${time}`;
      // The Morgan line only renders method/path/status/time, so a captured
      // request body (debug only, already redacted) would otherwise be dropped
      // in dev — append it dimmed on its own line.
      if (body !== undefined) {
        const rendered = typeof body === "string" ? body : JSON.stringify(body);
        line += `\n  ${DIM}body ${rendered}${RESET}`;
      }
    }

    return `${timestamp ? `${timestamp} ` : ""}${level} ${category}: ${line}`;
  }
});
