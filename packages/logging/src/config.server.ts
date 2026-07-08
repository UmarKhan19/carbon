import { AsyncLocalStorage } from "node:async_hooks";
import {
  ansiColorFormatter,
  configureSync,
  getConsoleSink,
  getJsonLinesFormatter
} from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { type CarbonLogLevel, resolveLevel } from "./levels";
import { CARBON_ROOT_CATEGORY } from "./logger";

const CONFIGURED = Symbol.for("carbon.logging.configured");

export type ConfigureLoggingOptions = {
  /** Override the env-derived level. */
  level?: CarbonLogLevel;
  /** ANSI colored terminal output. Defaults to `NODE_ENV !== "production"`. */
  pretty?: boolean;
};

/**
 * Configure LogTape for a Node server once per process.
 *
 * - dev  → `ansiColorFormatter` (colored terminal)
 * - prod → `getJsonLinesFormatter()` (JSONL, no ANSI), field-redacted
 *
 * Idempotent: a `globalThis` flag survives Vite SSR module re-evaluation, and
 * `reset: true` means a re-eval race reconfigures instead of throwing.
 */
export function ensureLoggingConfigured(
  options: ConfigureLoggingOptions = {}
): void {
  const g = globalThis as Record<PropertyKey, unknown>;
  if (g[CONFIGURED]) return;

  const isProd = process.env.NODE_ENV === "production";
  const level = options.level ?? resolveLevel("server");
  const pretty = options.pretty ?? !isProd;

  const formatter = pretty ? ansiColorFormatter : getJsonLinesFormatter();
  const consoleSink = getConsoleSink({ formatter });
  // Redact sensitive field names (password, token, secret, …) before records
  // reach the sink. Cheap: matches field names, not values.
  const sink = pretty ? consoleSink : redactByField(consoleSink);

  configureSync({
    reset: true,
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: { console: sink },
    loggers: [
      {
        category: [CARBON_ROOT_CATEGORY],
        lowestLevel: level,
        sinks: ["console"]
      },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"]
      }
    ]
  });

  g[CONFIGURED] = true;
}
