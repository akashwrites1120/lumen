import type { LumenDb } from "@lumen/db";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { EmailTransport } from "@lumen/notify";
import type { StorageDriver } from "./storage/driver.js";
import type { RedisRateLimiter } from "./ratelimit.js";

export interface AppContext {
  db: LumenDb;
  storage: StorageDriver;
  redis: Redis;
  redisRateLimit: RedisRateLimiter;
  ingestQueue: Queue;
  draftQueue: Queue;
  exportQueue: Queue;
  webhookQueue: Queue;
  /** Null when SMTP is not configured — email leg is skipped, in-app rows still written. */
  emailTransport: EmailTransport | null;
}
