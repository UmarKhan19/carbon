import { REDIS_URL } from "@carbon/auth";
import Redis from "ioredis";

let redis: Redis;

declare global {
  var __redis: Redis | undefined;
}

if (!REDIS_URL) {
  throw new Error("REDIS_URL is not defined");
}

// this is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to Redis with every change either.
if (process.env.VERCEL_ENV === "production") {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  });
} else {
  if (!global.__redis) {
    global.__redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });
  }
  redis = global.__redis;
}

export default redis;
