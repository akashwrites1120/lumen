import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { AltTextDraft } from "@lumen/providers";

const KEY_PREFIX = "vision:v1:";

export interface CachedVisionResult {
  draft: AltTextDraft;
  provider: string;
  model: string | null;
  cachedAt: string;
}

/**
 * TTL for the vision result cache, in seconds. Default: 7 days.
 * 0 (or invalid) disables the cache entirely.
 */
export function visionCacheTtlFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.VISION_CACHE_TTL_SEC ?? 604_800);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/** Deterministic JSON with sorted object keys so insertion order can't split the cache. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Cache key for a vision describe call: exact image identity (content
 * checksum — the same value used for ingest dedupe) hashed with every
 * describe parameter that can change the output (context, language,
 * style guide, mime type). The deterministic equivalent of the planned
 * pHash+context key: exact-match today, context-aware from day one.
 */
export function visionCacheKey(input: {
  checksumSha256: string;
  mimeType: string;
  context: unknown;
  styleGuide: unknown;
}): string {
  const paramHash = createHash("sha256")
    .update(
      stableStringify({
        mimeType: input.mimeType,
        context: input.context,
        styleGuide: input.styleGuide,
      })
    )
    .digest("hex");
  return `${KEY_PREFIX}${input.checksumSha256}:${paramHash}`;
}

/** Cache reads never throw — a broken cache must not fail a draft job. */
export async function readVisionCache(
  redis: Redis,
  key: string
): Promise<CachedVisionResult | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedVisionResult;
    if (!parsed?.draft || typeof parsed.draft.altText !== "string") return null;
    return parsed;
  } catch (err) {
    console.warn("[vision-cache] read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Cache writes never throw and are skipped entirely when ttl <= 0. */
export async function writeVisionCache(
  redis: Redis,
  key: string,
  result: CachedVisionResult,
  ttlSec: number
): Promise<void> {
  if (ttlSec <= 0) return;
  try {
    await redis.setex(key, ttlSec, JSON.stringify(result));
  } catch (err) {
    console.warn("[vision-cache] write failed:", err instanceof Error ? err.message : err);
  }
}
