import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import type { AltTextDraft } from "@lumen/providers";
import {
  readVisionCache,
  stableStringify,
  visionCacheKey,
  visionCacheTtlFromEnv,
  writeVisionCache,
  type CachedVisionResult,
} from "../src/vision-cache.js";

function fakeRedis() {
  const store = new Map<string, string>();
  const setex = vi.fn(async (key: string, _ttl: number, value: string) => {
    store.set(key, value);
  });
  const redis = {
    get: async (key: string) => store.get(key) ?? null,
    setex,
  } as unknown as Redis;
  return { redis, store, setex };
}

const draft: AltTextDraft = {
  altText: "A tabby cat asleep on a keyboard",
  longDescription: null,
  confidence: 92,
  imageClass: "photo",
  provider: "mock",
  model: "mock-1",
};

describe("stableStringify", () => {
  it("is order-independent for object keys", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("hashes nested structures deterministically and keeps array order", () => {
    const a = stableStringify({ context: { title: "T", tags: ["x", "y"] }, n: 1 });
    const b = stableStringify({ n: 1, context: { tags: ["x", "y"], title: "T" } });
    expect(a).toBe(b);
    expect(stableStringify(["x", "y"])).not.toBe(stableStringify(["y", "x"]));
  });

  it("drops undefined values so optional fields can't split the cache", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe("visionCacheKey", () => {
  const base = {
    checksumSha256: "abc123",
    mimeType: "image/png",
    context: { documentTitle: "Book", sectionTitle: "Ch 1", surroundingText: null, language: "en" },
    styleGuide: { maxAltChars: 125 },
  };

  it("is stable for identical inputs regardless of key order", () => {
    const k1 = visionCacheKey(base);
    const k2 = visionCacheKey({
      styleGuide: { maxAltChars: 125 },
      context: { language: "en", surroundingText: null, sectionTitle: "Ch 1", documentTitle: "Book" },
      mimeType: "image/png",
      checksumSha256: "abc123",
    });
    expect(k1).toBe(k2);
    expect(k1.startsWith("vision:v1:abc123:")).toBe(true);
  });

  it("differs when the image content or any describe input changes", () => {
    const k1 = visionCacheKey(base);
    expect(visionCacheKey({ ...base, checksumSha256: "different" })).not.toBe(k1);
    expect(visionCacheKey({ ...base, context: { ...base.context, language: "de" } })).not.toBe(k1);
    expect(visionCacheKey({ ...base, styleGuide: { maxAltChars: 250 } })).not.toBe(k1);
  });
});

describe("read/write roundtrip", () => {
  it("stores and returns the cached draft", async () => {
    const { redis } = fakeRedis();
    const key = visionCacheKey({
      checksumSha256: "abc",
      mimeType: "image/png",
      context: {},
      styleGuide: {},
    });
    const value: CachedVisionResult = {
      draft,
      provider: "mock",
      model: "mock-1",
      cachedAt: new Date().toISOString(),
    };
    await writeVisionCache(redis, key, value, 600);
    await expect(readVisionCache(redis, key)).resolves.toEqual(value);
  });

  it("returns null for misses and corrupt payloads instead of throwing", async () => {
    const { redis, store } = fakeRedis();
    store.set("vision:v1:x:y", "{not json");
    await expect(readVisionCache(redis, "vision:v1:missing")).resolves.toBeNull();
    await expect(readVisionCache(redis, "vision:v1:x:y")).resolves.toBeNull();
  });

  it("skips writes entirely when ttl is 0", async () => {
    const { redis, store, setex } = fakeRedis();
    await writeVisionCache(redis, "k", { draft, provider: "mock", model: null, cachedAt: "" }, 0);
    expect(setex).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});

describe("visionCacheTtlFromEnv", () => {
  it("defaults to 7 days and honours overrides", () => {
    expect(visionCacheTtlFromEnv({})).toBe(604_800);
    expect(visionCacheTtlFromEnv({ VISION_CACHE_TTL_SEC: "60" })).toBe(60);
  });

  it("disables the cache for 0, negatives, and garbage", () => {
    expect(visionCacheTtlFromEnv({ VISION_CACHE_TTL_SEC: "0" })).toBe(0);
    expect(visionCacheTtlFromEnv({ VISION_CACHE_TTL_SEC: "-5" })).toBe(0);
    expect(visionCacheTtlFromEnv({ VISION_CACHE_TTL_SEC: "nope" })).toBe(0);
  });
});
