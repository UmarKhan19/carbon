import { REDIS_URL } from "@carbon/env";
import Redis, { type ChainableCommander } from "ioredis";

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

// --- Resilience layer --------------------------------------------------------
// The exported `redis` is a transparent proxy: every command is wrapped with a
// short timeout and, when Redis is unreachable, returns a type-appropriate empty
// value instead of throwing. Consumers keep calling `redis.get(...)` /
// `redis.set(...)` unchanged — a Redis outage degrades to no-op reads/writes
// rather than 5xxing the request.

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
 * Test-only hook to reset the module-global degraded/debounce state between
 * cases. Not re-exported from the package index.
 */
export function __resetResilienceState(): void {
  lastLoggedAt = 0;
  degraded = false;
}

/**
 * Run a Redis operation with a per-call timeout, returning `fallback` on any
 * error (connection refused, timeout, offline-queue overflow, etc.) instead of
 * throwing. Callers never hang longer than {@link REDIS_TIMEOUT_MS}.
 */
async function runSafe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      op(),
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

// Command → fallback classification. Reads that yield collections must fall back
// to the matching empty shape so callers can still `.map`/`.length`/spread the
// result; everything else falls back to `null`.
const ARRAY_REPLY = new Set([
  "keys",
  "mget",
  "hmget",
  "hvals",
  "hkeys",
  "lrange",
  "smembers",
  "sinter",
  "sunion",
  "sdiff",
  "zrange",
  "zrevrange",
  "zrangebyscore",
  "zrevrangebyscore",
  "zrangebylex",
  "zrevrangebylex",
  "zpopmin",
  "zpopmax",
  "sort",
  "xrange",
  "xrevrange",
  "georadius",
  "geopos",
  "geohash"
]);
const OBJECT_REPLY = new Set(["hgetall"]);
// scan-family replies are [cursor, elements].
const SCAN_REPLY = new Set(["scan", "hscan", "sscan", "zscan"]);
const INTEGER_REPLY = new Set([
  "del",
  "unlink",
  "exists",
  "expire",
  "expireat",
  "pexpire",
  "pexpireat",
  "persist",
  "ttl",
  "pttl",
  "incr",
  "incrby",
  "decr",
  "decrby",
  "hincrby",
  "hdel",
  "hset",
  "hsetnx",
  "hlen",
  "hexists",
  "llen",
  "lpush",
  "rpush",
  "lpushx",
  "rpushx",
  "lrem",
  "sadd",
  "srem",
  "scard",
  "sismember",
  "smove",
  "zadd",
  "zrem",
  "zcard",
  "zcount",
  "zrank",
  "zrevrank",
  "setnx",
  "setrange",
  "append",
  "strlen",
  "getbit",
  "setbit",
  "bitcount",
  "publish",
  "pfadd",
  "pfcount",
  "geoadd",
  "xlen",
  "dbsize",
  "touch",
  "move",
  "renamenx",
  "msetnx"
]);
const STATUS_REPLY = new Set([
  "set",
  "setex",
  "psetex",
  "mset",
  "hmset",
  "rename",
  "ltrim",
  "flushall",
  "flushdb"
]);

// Commands overloaded on their argument count: `spop key` / `srandmember key`
// return a single member (scalar), while `spop key count` / `srandmember key
// count` return an array. The fallback shape therefore depends on whether a
// count argument was supplied — see the count check in the proxy `get` trap.
const COUNT_OPTIONAL_ARRAY = new Set(["spop", "srandmember"]);

/**
 * Blocking / wait commands that intentionally park until data arrives or their
 * own BLOCK/numreplicas/timeout argument elapses. Wrapping them in the 500ms
 * {@link REDIS_TIMEOUT_MS} race would defeat their purpose — they would always
 * lose the race and return the fallback instead of blocking. These pass through
 * to the raw client unmodified, with no timeout wrapper and no fallback, so
 * their real blocking semantics are preserved.
 */
const BLOCKING_COMMANDS = new Set([
  "blpop",
  "brpop",
  "blmove",
  "brpoplpush",
  "bzpopmin",
  "bzpopmax",
  "xread",
  "xreadgroup",
  "wait"
]);

function fallbackFor(command: string, args: unknown[]): unknown {
  const name = command.toLowerCase();
  if (ARRAY_REPLY.has(name)) return [];
  // `spop`/`srandmember` without a count return a scalar member (null on miss);
  // with a count they return an array.
  if (COUNT_OPTIONAL_ARRAY.has(name)) return args.length > 1 ? [] : null;
  if (OBJECT_REPLY.has(name)) return {};
  if (SCAN_REPLY.has(name)) return ["0", []];
  if (INTEGER_REPLY.has(name)) return 0;
  if (STATUS_REPLY.has(name)) return "OK";
  return null;
}

// Members that must NOT be command-wrapped: EventEmitter surface, connection
// lifecycle, command definition, and streaming helpers. These are returned
// bound to the raw client so `this` stays correct.
const PASSTHROUGH = new Set([
  "on",
  "once",
  "off",
  "emit",
  "addListener",
  "removeListener",
  "removeAllListeners",
  "listeners",
  "rawListeners",
  "listenerCount",
  "eventNames",
  "prependListener",
  "prependOnceListener",
  "setMaxListeners",
  "getMaxListeners",
  "connect",
  "disconnect",
  "quit",
  "end",
  "duplicate",
  "defineCommand",
  "createBuiltinCommand",
  "sendCommand",
  "scanStream",
  "hscanStream",
  "sscanStream",
  "zscanStream"
]);

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Wrap a pipeline/multi so its command builders keep chaining but `exec` never
 * throws — a downed Redis yields an empty result set instead of rejecting.
 */
function createSafePipeline(pipeline: ChainableCommander): ChainableCommander {
  return new Proxy(pipeline, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "exec" || prop === "execBuffer") {
        return (...args: unknown[]) =>
          runSafe(
            () => (value as AnyFn).apply(target, args) as Promise<unknown>,
            []
          );
      }
      return (...args: unknown[]) => {
        const result = (value as AnyFn).apply(target, args);
        // Command builders return the pipeline itself; keep the wrapper chained.
        return result === target ? receiver : result;
      };
    }
  });
}

/**
 * Return a `Redis` proxy whose every command call is timeout-bounded and
 * failure-safe. The runtime shape is identical to the wrapped client, so the
 * cast to `Redis` preserves the full typed command surface for callers.
 */
export function createSafeRedis(client: Redis): Redis {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "pipeline" || prop === "multi") {
        const build = Reflect.get(target, prop, target) as (
          ...args: unknown[]
        ) => ChainableCommander;
        return (...args: unknown[]) =>
          createSafePipeline(build.apply(target, args));
      }

      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;

      // Non-command members keep their real behavior, bound to the raw client.
      // Blocking commands also pass through unwrapped so the 500ms timeout race
      // can't defeat their intended blocking semantics.
      if (
        typeof prop !== "string" ||
        PASSTHROUGH.has(prop) ||
        BLOCKING_COMMANDS.has(prop.toLowerCase())
      ) {
        return (value as AnyFn).bind(target);
      }

      const command = prop;
      return (...args: unknown[]) =>
        runSafe(
          () => (value as AnyFn).apply(target, args) as Promise<unknown>,
          fallbackFor(command, args)
        );
    }
  }) as Redis;
}

// The raw, unguarded client. Exposed for `withRedis` and tests; not re-exported
// from the package index (consumers should use the safe default or `withRedis`).
export const rawRedis = global.__redis;

const redis = createSafeRedis(rawRedis);

export default redis;

/**
 * Lower-level escape hatch for custom multi-step operations that need an
 * explicit fallback value. Runs `fn` against the raw client with the same
 * timeout + degraded-logging behavior as the safe proxy.
 */
export async function withRedis<T>(
  fn: (client: Redis) => Promise<T>,
  fallback: T
): Promise<T> {
  return runSafe(() => fn(rawRedis), fallback);
}
