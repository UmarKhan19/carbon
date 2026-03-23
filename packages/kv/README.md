# @carbon/kv

Redis client and rate limiting utilities for Carbon applications using ioredis.

## Installation

This package is part of the Carbon monorepo and is available as `@carbon/kv`.

## Environment Variables

```bash
REDIS_URL="redis://user:password@host:port"
```

## Usage

### Redis Client

```typescript
import { redis } from "@carbon/kv";

// Basic operations
await redis.set("key", "value");
await redis.set("key", "value", "EX", 300); // With 5 min expiration
const value = await redis.get("key");
await redis.del("key");
```

### Rate Limiting

The `Ratelimit` class provides a drop-in replacement for `@upstash/ratelimit` using ioredis.

```typescript
import { Ratelimit, redis } from "@carbon/kv";

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 h"), // 10 requests per hour
  analytics: true, // Compatibility option (no-op)
});

// Check rate limit
const { success, limit, remaining, reset } = await ratelimit.limit(identifier);

if (!success) {
  // Rate limited - return 429
}
```

## Algorithms

### Sliding Window

Combines two fixed windows with weighted scoring for smooth rate limiting. Prevents boundary burst issues.

```typescript
Ratelimit.slidingWindow(tokens, window);

// Examples
Ratelimit.slidingWindow(10, "1 h");   // 10 requests per hour
Ratelimit.slidingWindow(100, "1 m");  // 100 requests per minute
Ratelimit.slidingWindow(5, "10 s");   // 5 requests per 10 seconds
```

### Fixed Window

Simple counter that resets at fixed intervals. Low memory usage but can allow bursts at boundaries.

```typescript
Ratelimit.fixedWindow(tokens, window);

// Examples
Ratelimit.fixedWindow(100, "1 m");  // 100 requests per minute
Ratelimit.fixedWindow(1000, "1 h"); // 1000 requests per hour
```

### Token Bucket

Refillable bucket that allows controlled bursts while maintaining average rate.

```typescript
Ratelimit.tokenBucket(refillRate, interval, maxTokens?);

// Examples
Ratelimit.tokenBucket(1, "1 s", 10);  // 1 token/sec, burst up to 10
Ratelimit.tokenBucket(10, "1 m", 50); // 10 tokens/min, burst up to 50
```

## Configuration Options

```typescript
interface RatelimitConfig {
  redis: Redis;                              // ioredis client instance
  limiter: () => Algorithm;                  // Algorithm factory
  prefix?: string;                           // Key prefix (default: "@upstash/ratelimit")
  ephemeralCache?: boolean | Map<string, number>; // In-memory cache for blocked IDs
  timeout?: number;                          // Redis timeout in ms (default: 5000)
  analytics?: boolean;                       // Compatibility option (no-op)
}
```

## Response Object

```typescript
interface RatelimitResponse {
  success: boolean;      // Whether request is allowed
  limit: number;         // Maximum requests in window
  remaining: number;     // Remaining requests in window
  reset: number;         // Unix timestamp (ms) when limit resets
  pending: Promise<unknown>; // Resolves when operations complete
}
```

## Additional Methods

```typescript
// Get remaining without consuming
const { remaining, reset, limit } = await ratelimit.getRemaining(identifier);

// Reset rate limit for identifier
await ratelimit.resetUsedTokens(identifier);

// Block until allowed or timeout
const result = await ratelimit.blockUntilReady(identifier, timeoutMs);
```

## Duration Format

Durations can be specified with or without spaces:

- `ms` - milliseconds: `"100ms"`, `"100 ms"`
- `s` - seconds: `"10s"`, `"10 s"`
- `m` - minutes: `"5m"`, `"5 m"`
- `h` - hours: `"1h"`, `"1 h"`
- `d` - days: `"7d"`, `"7 d"`

## Migration from @upstash/ratelimit

1. Update imports:
```typescript
// Before
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@carbon/kv";

// After
import { Ratelimit, redis } from "@carbon/kv";
```

2. Update environment variables:
```bash
# Before
UPSTASH_REDIS_REST_URL="https://..."
UPSTASH_REDIS_REST_TOKEN="..."

# After
REDIS_URL="redis://..."
```

3. Update `redis.set()` calls with expiration:
```typescript
// Before (Upstash syntax)
await redis.set(key, value, { ex: 300 });

// After (ioredis syntax)
await redis.set(key, value, "EX", 300);
```

## Testing

```bash
npm test                 # Run tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage
```
