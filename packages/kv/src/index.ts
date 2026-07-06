import redis, { withRedis } from "./client";

export { redis, withRedis };
export type {
  Duration,
  RatelimitConfig,
  RatelimitResponse
} from "./ratelimit";
export { Ratelimit } from "./ratelimit";
