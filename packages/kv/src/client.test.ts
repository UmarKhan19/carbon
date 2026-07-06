import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// client.ts throws at import if REDIS_URL is unset, and builds the singleton
// from `new Redis(REDIS_URL)`. Provide a URL and back the client with the
// in-memory ioredis-mock so the real resilient-proxy code paths run against a
// controllable Redis.
vi.mock("@carbon/env", () => ({ REDIS_URL: "redis://localhost:6379" }));
vi.mock("ioredis", async () => {
  const RedisMock = (await import("ioredis-mock")).default;
  return { default: RedisMock };
});

// Loose alias for ioredis-mock instances / partial pipeline stubs in tests.
type AnyRedis = any;

// Imported after the mocks are registered. `redis` is the safe proxy; `rawRedis`
// is the underlying ioredis-mock it wraps, so spying on rawRedis' methods
// simulates Redis being unreachable or slow while still exercising the proxy.
import RedisMock from "ioredis-mock";
import redis, {
  __resetResilienceState,
  createSafeRedis,
  rawRedis,
  withRedis
} from "./client";

describe("@carbon/kv transparent resilient client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetResilienceState();
    // Silence + observe the degraded/recovered logging.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rawRedis.flushall();
  });

  describe("reads on the healthy path", () => {
    it("redis.get returns the stored value", async () => {
      await rawRedis.set("greeting", "hello");
      await expect(redis.get("greeting")).resolves.toBe("hello");
    });

    it("redis.hgetall returns the stored hash", async () => {
      await rawRedis.hset("h", "a", "1", "b", "2");
      await expect(redis.hgetall("h")).resolves.toEqual({ a: "1", b: "2" });
    });

    it("redis.lrange returns the stored list", async () => {
      await rawRedis.rpush("l", "x", "y");
      await expect(redis.lrange("l", 0, -1)).resolves.toEqual(["x", "y"]);
    });
  });

  describe("writes on the healthy path", () => {
    it("redis.set writes the value", async () => {
      await redis.set("count", "1");
      await expect(rawRedis.get("count")).resolves.toBe("1");
    });

    it("redis.set honors the EX option", async () => {
      await redis.set("ttl-key", "v", "EX", 60);
      // ioredis-mock supports TTL; a positive TTL proves EX was applied.
      expect(await rawRedis.ttl("ttl-key")).toBeGreaterThan(0);
    });

    it("redis.del removes the key", async () => {
      await rawRedis.set("gone", "1");
      await expect(redis.del("gone")).resolves.toBe(1);
      await expect(rawRedis.get("gone")).resolves.toBeNull();
    });
  });

  describe("degrades safely when Redis is down", () => {
    it("redis.get returns null without throwing", async () => {
      vi.spyOn(rawRedis, "get").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 127.0.0.1:6379")
      );
      await expect(redis.get("greeting")).resolves.toBeNull();
    });

    it("redis.set returns the OK fallback without throwing", async () => {
      vi.spyOn(rawRedis, "set").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 127.0.0.1:6379")
      );
      await expect(redis.set("count", "1")).resolves.toBe("OK");
    });

    it("redis.del returns 0 without throwing", async () => {
      vi.spyOn(rawRedis, "del").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 127.0.0.1:6379")
      );
      await expect(redis.del("count")).resolves.toBe(0);
    });

    it("redis.hgetall returns an empty object without throwing", async () => {
      vi.spyOn(rawRedis, "hgetall").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED")
      );
      await expect(redis.hgetall("h")).resolves.toEqual({});
    });

    it("redis.lrange returns an empty array without throwing", async () => {
      vi.spyOn(rawRedis, "lrange").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED")
      );
      await expect(redis.lrange("l", 0, -1)).resolves.toEqual([]);
    });

    it("redis.smembers returns an empty array without throwing", async () => {
      vi.spyOn(rawRedis, "smembers").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED")
      );
      await expect(redis.smembers("s")).resolves.toEqual([]);
    });
  });

  describe("per-call timeout", () => {
    it("returns the fallback when a command exceeds 500ms", async () => {
      vi.useFakeTimers();
      vi.spyOn(rawRedis, "get").mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve("too-late"), 2000)
          ) as never
      );

      const pending = redis.get("slow");
      // Advance past the 500ms per-call timeout; the command would only resolve
      // at 2000ms, so the timeout wins the race.
      await vi.advanceTimersByTimeAsync(600);

      await expect(pending).resolves.toBeNull();
    });
  });

  describe("recovery and debounced logging", () => {
    it("logs degraded once, then recovers on the next success", async () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const info = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      const getSpy = vi
        .spyOn(rawRedis, "get")
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
        .mockResolvedValueOnce("recovered-value");

      // First call fails -> null fallback (no throw), one degraded log.
      await expect(redis.get("k")).resolves.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);

      // Redis restored -> next call returns the real value and logs recovery.
      await expect(redis.get("k")).resolves.toBe("recovered-value");
      expect(info).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("pipeline", () => {
    it("executes normally on the healthy path", async () => {
      const results = await redis.pipeline().set("a", "1").get("a").exec();
      expect(results).toEqual([
        [null, "OK"],
        [null, "1"]
      ]);
    });

    it("returns an empty result set when exec fails", async () => {
      const fakePipeline: AnyRedis = {
        set() {
          return this;
        },
        get() {
          return this;
        },
        exec: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"))
      };
      vi.spyOn(rawRedis, "pipeline").mockReturnValue(fakePipeline);

      const results = await redis.pipeline().set("a", "1").get("a").exec();
      expect(results).toEqual([]);
    });
  });

  describe("withRedis escape hatch", () => {
    it("returns the operation result on the healthy path", async () => {
      await rawRedis.set("wr", "value");
      const result = await withRedis((client) => client.get("wr"), "fallback");
      expect(result).toBe("value");
    });

    it("returns the fallback when the operation throws", async () => {
      vi.spyOn(rawRedis, "get").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED")
      );
      const result = await withRedis((client) => client.get("wr"), "fallback");
      expect(result).toBe("fallback");
    });
  });

  describe("createSafeRedis factory", () => {
    it("wraps an arbitrary client: writes pass through, failures fall back", async () => {
      const raw = new RedisMock() as AnyRedis;
      const safe = createSafeRedis(raw);

      await safe.set("x", "y");
      await expect(raw.get("x")).resolves.toBe("y");

      vi.spyOn(raw, "get").mockRejectedValueOnce(new Error("down"));
      await expect(safe.get("x")).resolves.toBeNull();
    });
  });
});
