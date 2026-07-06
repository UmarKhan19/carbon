import type Redis from "ioredis";

export const REDIS_TIMEOUT_MS = 2000;
const LOG_THROTTLE_MS = 10_000;

let lastLoggedAt = 0;
let unavailable = false;

export function logUnavailable(err: unknown): void {
  const now = Date.now();
  if (!unavailable || now - lastLoggedAt >= LOG_THROTTLE_MS) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Redis unavailable, falling back: ${message}`);
    lastLoggedAt = now;
  }
  unavailable = true;
}

function logReconnected(): void {
  if (unavailable) {
    console.info("Redis reconnected");
    unavailable = false;
  }
}

// Reconnect forever with capped backoff so the client auto-recovers when Redis
// returns. Never returns null — that would end reconnection permanently; a null
// here is the exact bug that defeats auto-recovery. Per-command latency is
// bounded by maxRetriesPerRequest + the guard timeout, not by giving up here.
export const reconnectStrategy = (times: number): number =>
  Math.min(times * 200, 5000);

function guard<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      logUnavailable(new Error("redis timeout"));
      finish(fallback);
    }, REDIS_TIMEOUT_MS);

    // A late settle after the timeout is intentionally swallowed here so it
    // can't surface as an unhandled rejection.
    promise.then(
      (value) => {
        clearTimeout(timer);
        logReconnected();
        finish(value);
      },
      (err) => {
        clearTimeout(timer);
        logUnavailable(err);
        finish(fallback);
      }
    );
  });
}

// Collection commands fall back to [] (not null) so callers can iterate safely.
const ARRAY_FALLBACK = new Set([
  "keys",
  "mget",
  "hkeys",
  "hvals",
  "smembers",
  "lrange",
  "zrange",
  "zrevrange",
  "sscan",
  "hscan",
  "zscan"
]);

const fallbackFor = (command: string): unknown =>
  ARRAY_FALLBACK.has(command.toLowerCase()) ? [] : null;

function wrapPipeline<
  T extends { exec?: (...args: unknown[]) => Promise<unknown> }
>(pipeline: T): T {
  // Pipelines are chainable objects, so the proxy can't reach their commands;
  // guard the terminal exec() instead.
  if (pipeline && typeof pipeline.exec === "function") {
    const originalExec = pipeline.exec.bind(pipeline);
    pipeline.exec = (...args: unknown[]) =>
      guard(originalExec(...args), [] as unknown[]);
  }
  return pipeline;
}

// Redis is a cache, never the source of truth. This Proxy makes an unreachable
// Redis degrade instead of crash: reads resolve null, collections [], writes
// null — so consumers keep the ordinary ioredis API with no per-call handling.
export function withResilience(client: Redis): Redis {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;

      const command = typeof prop === "string" ? prop : "";

      if (command === "pipeline" || command === "multi") {
        return (...args: unknown[]) =>
          wrapPipeline(
            (
              value as (...a: unknown[]) => {
                exec?: (...a: unknown[]) => Promise<unknown>;
              }
            ).apply(target, args)
          );
      }

      return (...args: unknown[]) => {
        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          logUnavailable(err);
          return Promise.resolve(fallbackFor(command));
        }
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return guard(result as Promise<unknown>, fallbackFor(command));
        }
        return result;
      };
    }
  }) as Redis;
}
