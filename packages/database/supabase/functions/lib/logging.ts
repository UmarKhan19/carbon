import { AsyncLocalStorage } from "node:async_hooks";
import {
  configureSync,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
  type Logger,
  withContext,
} from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";

/**
 * Deno-native twin of `@carbon/logging` for Supabase edge functions.
 *
 * Edge functions run on Deno and cannot import the workspace package, so this
 * mirrors its config: LogTape configured on first use, always JSON Lines (edge
 * logs go to the Supabase log drain), field-redacted, level from `LOG_LEVEL`.
 * Keep this in sync with `packages/logging/src/config.server.ts`.
 */
const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const;
type Level = (typeof LOG_LEVELS)[number];

const REQUEST_ID_HEADER = "x-request-id";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  const raw = Deno.env.get("LOG_LEVEL")?.toLowerCase().trim();
  const level: Level =
    raw && (LOG_LEVELS as readonly string[]).includes(raw)
      ? (raw as Level)
      : "info";

  configureSync({
    reset: true,
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
      console: redactByField(
        getConsoleSink({ formatter: getJsonLinesFormatter() })
      ),
    },
    loggers: [
      { category: ["carbon"], lowestLevel: level, sinks: ["console"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
  });

  configured = true;
}

/** Logger for an edge function → category `["carbon","edge",fnName]`. */
export function getFunctionLogger(fnName: string): Logger {
  ensureConfigured();
  return getLogger(["carbon", "edge", fnName]);
}

/**
 * Wrap an edge-function handler so every log during the request carries a
 * request id (reused from `x-request-id` or generated) and the function name,
 * and the id is echoed on the response.
 */
export function withRequestLogging(
  fnName: string,
  handler: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  return async (req) => {
    ensureConfigured();
    const requestId =
      req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    const response = await withContext(
      { requestId, function: fnName },
      async () => await handler(req)
    );
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };
}
