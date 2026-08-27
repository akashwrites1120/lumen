import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

export class IdempotencyConflictError extends Error {
  constructor(public readonly key: string) {
    super(`request with Idempotency-Key ${key} already in progress`);
    this.name = "IdempotencyConflictError";
  }
}

interface CachedResponse {
  statusCode: number;
  body: unknown;
}

const TTL_SECONDS = 24 * 60 * 60;

/**
 * Redis-backed idempotency for unsafe requests (API beta contract):
 * - first call executes and caches the exact response for 24h
 * - replays return the cached response verbatim
 * - concurrent duplicate gets 409 via thrown IdempotencyConflictError
 */
export async function runIdempotent(
  redis: Redis,
  rawKey: string | string[] | undefined,
  scope: string,
  fn: () => Promise<{ statusCode: number; body: unknown }>
): Promise<{ statusCode: number; body: unknown; replayed: boolean }> {
  if (!rawKey || typeof rawKey !== "string" || rawKey.trim().length === 0) {
    const result = await fn();
    return { ...result, replayed: false };
  }
  const key = rawKey.trim().slice(0, 255);
  const digest = createHash("sha256").update(`${scope}:${key}`).digest("hex");
  const cacheKey = `lumen:idem:${digest}`;
  const lockKey = `${cacheKey}:lock`;

  const existing = await redis.get(cacheKey);
  if (existing) {
    const cached = JSON.parse(existing) as CachedResponse;
    return { ...cached, replayed: true };
  }

  const locked = await redis.set(lockKey, "1", "EX", 300, "NX");
  if (!locked) throw new IdempotencyConflictError(key);

  try {
    const result = await fn();
    await redis.setex(cacheKey, TTL_SECONDS, JSON.stringify({ statusCode: result.statusCode, body: result.body }));
    return { ...result, replayed: false };
  } finally {
    await redis.del(lockKey);
  }
}
