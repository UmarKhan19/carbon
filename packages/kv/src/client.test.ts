import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// client.ts throws at import if REDIS_URL is unset, and builds the singleton
// from `new Redis(REDIS_URL)`. Provide a URL and back the client with the
// in-memory ioredis-mock so the real withRedis/safeGet/safeSet/safeDel code
// paths run against a controllable Redis.
vi.mock("@carbon/env", () => ({ REDIS_URL: "redis://localhost:6379" }));
vi.mock("ioredis", async () => {
  const RedisMock = (await import("ioredis-mock")).default;
  return { default: RedisMock };
});

// Imported after the mocks are registered; `redis` is the ioredis-mock instance
// that withRedis operates on, so spying on its methods simulates Redis being
// unreachable or slow.
import redis, { safeDel, safeGet, safeSet, withRedis } from "./client";

describe("@carbon/kv resilience layer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Silence the degraded/recovered logging noise during assertions.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await redis.flushall();
  });

  describe("safeGet", () => {
    it("returns the stored value on the normal path", async () => {
      await redis.set("greeting", "hello");
      await expect(safeGet("greeting")).resolves.toBe("hello");
    });

    it("returns null (fallback) when Redis is down, without throwing", async () => {
      vi.spyOn(redis, "get").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 127.0.0.1:6379")
      );
      await expect(safeGet("greeting")).resolves.toBeNull();
    });
  });

  describe("safeSet", () => {
    it("writes the value on the normal path", async () => {
      await safeSet("count", "1");
      await expect(redis.get("count")).resolves.toBe("1");
    });

    it("honors the ex option", async () => {
      await safeSet("ttl-key", "v", { ex: 60 });
      // ioredis-mock supports TTL; a positive TTL proves EX was applied.
      expect(await redis.ttl("ttl-key")).toBeGreaterThan(0);
    });

    it("returns undefined (fallback) when Redis is down, without throwing", async () => {
      vi.spyOn(redis, "set").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 127.0.0.1:6379")
      );
      await expect(safeSet("count", "1")).resolves.toBeUndefined();
    });
  });

  describe("safeDel", () => {
    it("returns undefined (fallback) when Redis is down, without throwing", async () => {
      vi.spyOn(redis, "del").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 127.0.0.1:6379")
      );
      await expect(safeDel("count")).resolves.toBeUndefined();
    });
  });

  describe("withRedis", () => {
    it("returns the fallback when the operation exceeds the 500ms timeout", async () => {
      vi.useFakeTimers();
      vi.spyOn(redis, "get").mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve("too-late"), 2000)
          ) as never
      );

      const pending = withRedis((r) => r.get("slow"), "fallback");
      // Advance past the 500ms per-call timeout; the operation would only
      // resolve at 2000ms, so the timeout wins the race.
      await vi.advanceTimersByTimeAsync(600);

      await expect(pending).resolves.toBe("fallback");
    });

    it("recovers: returns real data on the call after a failure", async () => {
      const getSpy = vi
        .spyOn(redis, "get")
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
        .mockResolvedValueOnce("recovered-value");

      // First call fails -> fallback (no throw).
      await expect(safeGet("k")).resolves.toBeNull();
      // Redis restored -> the next call returns the real value.
      await expect(safeGet("k")).resolves.toBe("recovered-value");
      expect(getSpy).toHaveBeenCalledTimes(2);
    });
  });
});
