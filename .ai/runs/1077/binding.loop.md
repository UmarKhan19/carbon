---
id: "1077"
kind: bug
risk: low
issue: 1077
title: "Redis resilience: withRedis wrapper + convenience helpers + tests in @carbon/kv"
acceptance:
  - "withRedis<T>(fn, fallback) exported from packages/kv/src/index.ts; catches all Redis errors (ECONNREFUSED, timeouts, ioredis offline-queue full) and returns fallback without throwing"
  - "safeGet(key) => string | null, safeSet(key, value, options?) => void, safeDel(key) => void exported from packages/kv/src/index.ts; all use withRedis internally"
  - "ioredis-mock unit tests pass: normal path returns real data, Redis-down returns fallback without throw, recovery after mock restored"
  - "No changes to existing consumer call sites (foundation only — no migration in this PR)"
  - "TypeScript typecheck clean (pnpm --filter @carbon/kv tsc --noEmit)"
  - "Biome lint clean (pnpm --filter @carbon/kv run lint or equivalent)"
---

# Redis resilience: withRedis wrapper + convenience helpers + tests in @carbon/kv

## Context
Part of epic #1076: Redis downtime kills the entire app.

`packages/kv/src/client.ts` exports a raw singleton ioredis client with no error handling. All consumers await Redis commands directly — when Redis is unreachable the rejection propagates up, causing app-wide 5xx.

This PR introduces the resilience layer (foundation only, no consumer migration).

## Current code (at dispatch time — pre-PR #1083)
```ts
// packages/kv/src/client.ts — at the time this task was dispatched
import { REDIS_URL } from "@carbon/env";
import Redis from "ioredis";

if (!global.__redis) {
  global.__redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: true,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 50, 2000);
    }
  });
}
const redis = global.__redis;
export default redis;
```

**Note:** PR #1083 (merged 2026-07-06) subsequently wrapped the singleton with `withResilience()` from `packages/kv/src/resilient.ts`. The current `client.ts` applies the Proxy-based resilience wrapper at import time. This snapshot records the pre-resilience baseline for historical context.

## What to build

### 1. `withRedis<T>` in `packages/kv/src/client.ts`
Add alongside the existing `redis` export:
```ts
export async function withRedis<T>(fn: (client: Redis) => Promise<T>, fallback: T): Promise<T> {
  try {
    // per-call timeout — don't hang callers indefinitely
    const result = await Promise.race([
      fn(redis),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("redis timeout")), 500)
      ),
    ]);
    return result;
  } catch (err) {
    // log degraded state (debounced — avoid per-request noise)
    logDegraded(err);
    return fallback;
  }
}
```
Implement a simple debounced logger (`logDegraded`) that logs at most once per 10s — "Redis degraded: <error message>" on first failure, "Redis recovered" on first success after a failure.

### 2. Convenience wrappers in `packages/kv/src/client.ts`
```ts
export const safeGet = (key: string): Promise<string | null> =>
  withRedis((r) => r.get(key), null);

export const safeSet = (key: string, value: string, options?: { ex?: number }): Promise<void> =>
  withRedis((r) => options?.ex ? r.set(key, value, "EX", options.ex) : r.set(key, value), null).then(() => undefined);

export const safeDel = (key: string): Promise<void> =>
  withRedis((r) => r.del(key), null).then(() => undefined);
```

Return types: `safeGet` returns `string | null`; `safeSet` and `safeDel` return `void` (discard the underlying Redis command result), consistent with acceptance criteria.

### 3. Export from `packages/kv/src/index.ts`
Re-export `withRedis`, `safeGet`, `safeSet`, `safeDel` alongside the existing `redis` default export.

### 4. Unit tests
Look at existing test setup in `packages/kv/` (check `package.json` for test runner, look for `__tests__/` or `*.test.ts`). Use `ioredis-mock` (already in the kv package if present, or add as devDependency).

Write tests covering:
- `safeGet` normal path: mock returns value → wrapper returns value
- `safeGet` Redis-down: mock throws → wrapper returns null, no throw
- `safeSet` Redis-down: mock throws → wrapper returns undefined, no throw
- `withRedis` timeout: mock delays >500ms → wrapper returns fallback
- Recovery: mock throws then succeeds → subsequent call returns real data

## Constraints
- Do NOT change any existing consumer call sites in this PR
- Do NOT change `retryStrategy`, `maxRetriesPerRequest`, or `enableOfflineQueue` defaults
- Keep the default `redis` export untouched — consumers will migrate in later PRs
- pnpm, never npm
