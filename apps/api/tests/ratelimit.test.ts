import { describe, it, expect, beforeEach } from "vitest";
import { RedisRateLimiter } from "../src/ratelimit.js";

class FakeRedis {
  private store = new Map<string, { value: number; expiresAt: number | null }>();
  private now: number;

  constructor(now = 1_700_000_000) {
    this.now = now;
  }

  private gc(key: string) {
    const entry = this.store.get(key);
    if (entry?.expiresAt && entry.expiresAt <= this.now) this.store.delete(key);
  }

  async incr(key: string): Promise<number> {
    this.gc(key);
    const entry = this.store.get(key);
    if (!entry) {
      this.store.set(key, { value: 1, expiresAt: null });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }

  async expire(key: string, sec: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = this.now + sec;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    return Math.max(0, entry.expiresAt - this.now);
  }

  // minimal surface used by tests
  advance(sec: number) {
    this.now += sec;
  }
}

describe("RedisRateLimiter", () => {
  let fake: FakeRedis;
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    fake = new FakeRedis();
    limiter = new RedisRateLimiter(fake as unknown as never);
  });

  it("allows requests under the limit", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await limiter.hit("k", { limit: 3, windowSec: 60 });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(3 - (i + 1));
    }
  });

  it("blocks requests over the limit with a reset window", async () => {
    for (let i = 0; i < 3; i++) await limiter.hit("k", { limit: 3, windowSec: 60 });
    const blocked = await limiter.hit("k", { limit: 3, windowSec: 60 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetSec).toBeGreaterThan(0);
    expect(blocked.resetSec).toBeLessThanOrEqual(60);
  });

  it("isolates buckets by key", async () => {
    for (let i = 0; i < 3; i++) await limiter.hit("a", { limit: 3, windowSec: 60 });
    const other = await limiter.hit("b", { limit: 3, windowSec: 60 });
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it("isolates buckets by window", async () => {
    for (let i = 0; i < 3; i++) await limiter.hit("k", { limit: 3, windowSec: 60 });
    const blocked = await limiter.hit("k", { limit: 3, windowSec: 60 });
    expect(blocked.allowed).toBe(false);

    // advance past the window — counter rolls into a new bucket
    fake.advance(61);
    const fresh = await limiter.hit("k", { limit: 3, windowSec: 60 });
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(2);
  });
});
