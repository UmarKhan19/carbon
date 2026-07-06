import { REDIS_URL } from "@carbon/env";
import Redis from "ioredis";

declare global {
  var __redis: Redis | undefined;
}

if (!REDIS_URL) {
  throw new Error("REDIS_URL is not defined");
}

if (!global.__redis) {
  global.__redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true, // don't connect until first command
    enableOfflineQueue: true, // buffer commands while connecting
    retryStrategy(times) {
      if (times > 3) return null; // stop retrying, don't hang the lambda
      return Math.min(times * 50, 2000);
    }
  });
}

const redis = global.__redis;

export default redis;

// --- Resilience layer --------------------------------------------------------
// Foundation only: consumers keep using the raw `redis` export until they
// migrate to the safe helpers below. When Redis is unreachable these helpers
// return a fallback instead of letting the rejection propagate into a 5xx.

const REDIS_TIMEOUT_MS = 500;
const LOG_DEBOUNCE_MS = 10_000;

let lastLoggedAt = 0;
let degraded = false;

/**
 * Debounced degraded-state logger. Emits at most one line per 10s: a
 * "Redis degraded" line on the first failure and a "Redis recovered" line on
 * the first success after a failure — avoids per-request log noise while Redis
 * is down.
 */
function logDegraded(err: unknown): void {
  const now = Date.now();
  if (!degraded || now - lastLoggedAt >= LOG_DEBOUNCE_MS) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Redis degraded: ${message}`);
    lastLoggedAt = now;
  }
  degraded = true;
}

function logRecovered(): void {
  if (degraded) {
    console.info("Redis recovered");
    degraded = false;
  }
}

/**
 * Run a Redis operation with a per-call timeout, returning `fallback` on any
 * error (connection refused, timeout, offline-queue overflow, etc.) instead of
 * throwing. Callers never hang longer than {@link REDIS_TIMEOUT_MS}.
 */
export async function withRedis<T>(
  fn: (client: Redis) => Promise<T>,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fn(redis),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("redis timeout")),
          REDIS_TIMEOUT_MS
        );
      })
    ]);
    logRecovered();
    return result;
  } catch (err) {
    logDegraded(err);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Redis GET that yields `null` when Redis is unavailable. */
export const safeGet = (key: string): Promise<string | null> =>
  withRedis((r) => r.get(key), null);

/** Redis SET that silently no-ops when Redis is unavailable. */
export const safeSet = (
  key: string,
  value: string,
  options?: { ex?: number }
): Promise<void> =>
  withRedis<void>(async (r) => {
    if (options?.ex !== undefined) {
      await r.set(key, value, "EX", options.ex);
    } else {
      await r.set(key, value);
    }
  }, undefined);

/** Redis DEL that silently no-ops when Redis is unavailable. */
export const safeDel = (key: string): Promise<void> =>
  withRedis<void>(async (r) => {
    await r.del(key);
  }, undefined);
