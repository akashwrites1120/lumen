import type { LumenDb } from "@lumen/db";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { StorageDriver } from "./storage/driver.js";

export interface AppContext {
  db: LumenDb;
  storage: StorageDriver;
  redis: Redis;
  ingestQueue: Queue;
  draftQueue: Queue;
  exportQueue: Queue;
  webhookQueue: Queue;
}
