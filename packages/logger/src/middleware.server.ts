import { withContext } from "@logtape/logtape";
import { nanoid } from "nanoid";
import {
  createContext,
  type MiddlewareFunction,
  type RouterContextProvider
} from "react-router";
import { getLogger } from "./logger";

export const REQUEST_ID_HEADER = "x-request-id";

/** Request-scoped correlation id, readable in loaders/actions via `getRequestId`. */
export const requestIdContext = createContext<string | null>(null);

export function getRequestId(context: RouterContextProvider): string | null {
  return context.get(requestIdContext);
}

const log = getLogger("http");

/**
 * Assigns a cloud-agnostic request id (reuses an inbound `x-request-id`, else
 * generates one), echoes it on the response, and runs the rest of the request
 * inside a LogTape implicit-context scope so every `getLogger(...)` call in
 * loaders/actions/services during this request carries `{ requestId }`.
 *
 * Register FIRST in an app's `middleware` array so downstream middleware and
 * handlers run inside the context scope.
 */
export const requestIdMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? nanoid();
  context.set(requestIdContext, requestId);

  const { method } = request;
  const { pathname } = new URL(request.url);
  const start = performance.now();

  const response = await withContext({ requestId }, async () => {
    const res = await next();
    // Debug-level so it is visible in dev but filtered by the prod `info`
    // default — the pipeline is observable with zero migrated call sites.
    // Rendered as a Morgan "dev"-style colored line in dev (see
    // http-formatter.ts) and as a structured JSONL record in prod.
    log.debug("{method} {pathname} → {status} in {responseTime}ms", {
      method,
      pathname,
      status: res.status,
      responseTime: performance.now() - start
    });
    return res;
  });

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
};
