import { AsyncLocalStorage } from "node:async_hooks";
import { configureSync, reset } from "@logtape/logtape";
import { createLogRecorder } from "@logtape/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLogger } from "./logger";
import {
  getRequestId,
  REQUEST_ID_HEADER,
  requestIdContext,
  requestIdMiddleware
} from "./middleware.server";

const recorder = createLogRecorder();

// Minimal RouterContextProvider stub — a Map keyed by the context token.
function makeContext() {
  const store = new Map<unknown, unknown>();
  return {
    get: (c: unknown) => store.get(c),
    set: (c: unknown, v: unknown) => store.set(c, v)
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any;
}

beforeEach(() => {
  recorder.clear();
  configureSync({
    reset: true,
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: { recorder: recorder.sink },
    loggers: [
      { category: ["carbon"], lowestLevel: "trace", sinks: ["recorder"] }
    ]
  });
});

afterEach(async () => {
  await reset();
});

describe("requestIdMiddleware", () => {
  it("generates and echoes a request id", async () => {
    const request = new Request("http://x/dashboard");
    const context = makeContext();
    const next = async () => new Response("ok");

    const res = (await requestIdMiddleware(
      { request, context } as never,
      next
    )) as Response;

    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toBeTruthy();
    expect(context.get(requestIdContext)).toBe(id);
  });

  it("reuses an inbound x-request-id", async () => {
    const request = new Request("http://x/dashboard", {
      headers: { [REQUEST_ID_HEADER]: "abc-123" }
    });
    const context = makeContext();
    const res = (await requestIdMiddleware(
      { request, context } as never,
      async () => new Response("ok")
    )) as Response;
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("abc-123");
    expect(getRequestId(context)).toBe("abc-123");
  });

  it("propagates the request id into logs emitted inside the handler (ALS)", async () => {
    const request = new Request("http://x/dashboard", {
      headers: { [REQUEST_ID_HEADER]: "trace-me" }
    });
    const next = async () => {
      getLogger("erp", "sales").info("did a thing");
      return new Response("ok");
    };

    await requestIdMiddleware(
      { request, context: makeContext() } as never,
      next
    );

    const record = recorder.records.find(
      (r) => r.category.join(".") === "carbon.erp.sales"
    );
    expect(record).toBeDefined();
    expect(record?.properties.requestId).toBe("trace-me");
  });
});
