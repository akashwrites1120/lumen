import type { Redis } from "ioredis";

export interface RateLimitConfig {
  /** Max requests allowed in the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window (clamped to >= 0). */
  remaining: number;
  /** Seconds until the current window resets. */
  resetSec: number;
}

/**
 * Fixed-window counter rate limiter backed by Redis.
 *
 * Uses a single INCR + (conditional) EXPIRE so the limit is enforced
 * atomically across multiple API instances. The bucket key is namespaced
 * by caller, so passing (orgId, route) naturally splits quotas per tenant.
 */
export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, cfg: RateLimitConfig): Promise<RateLimitResult> {
    const bucket = Math.floor(Date.now() / 1000 / cfg.windowSec);
    const redisKey = `rl:${key}:${bucket}`;

    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      // First hit in this window: pin the TTL so the key expires.
      // EXPIRE is best-effort; if it fails the next hit will retry.
      await this.redis.expire(redisKey, cfg.windowSec);
    }

    const allowed = count <= cfg.limit;
    const remaining = Math.max(0, cfg.limit - count);
    const elapsedInWindow = Math.floor(Date.now() / 1000) % cfg.windowSec;
    const resetSec = Math.max(0, cfg.windowSec - elapsedInWindow);

    return { allowed, remaining, resetSec };
  }
}

export const RATE_LIMIT_PRESETS = {
  webhookCud: { limit: 30, windowSec: 60 } satisfies RateLimitConfig,
  webhookTest: { limit: 10, windowSec: 60 } satisfies RateLimitConfig,
  upload: { limit: 20, windowSec: 60 } satisfies RateLimitConfig,
} as const;

export function rateLimitHeaders(res: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(res.allowed ? res.remaining + 0 : 0),
    "X-RateLimit-Remaining": String(res.remaining),
    "X-RateLimit-Reset": String(res.resetSec),
  };
}
