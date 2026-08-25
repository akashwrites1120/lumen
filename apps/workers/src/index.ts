import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createDb } from "@lumen/db";
import { INGEST_QUEUE } from "./queue.js";
import { AssetStore } from "./storage.js";
import { processIngest, type IngestJobData } from "./ingest.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const { db, client: pgClient } = createDb(
  process.env.DATABASE_URL ?? "postgres://lumen:lumen@localhost:5432/lumen"
);

const store = new AssetStore(process.env.STORAGE_LOCAL_ROOT ?? ".data/storage");

const ingestWorker = new Worker<IngestJobData>(
  INGEST_QUEUE,
  async (job) => {
    console.log(`[ingest] processing job ${job.id} (attempt ${job.attemptsMade + 1})`);
    return processIngest(job, { db, redis: connection, store });
  },
  { connection, concurrency: Number(process.env.INGEST_CONCURRENCY ?? 2) }
);

ingestWorker.on("completed", (job) => {
  console.log(`[ingest] completed ${job.id}: ${JSON.stringify(job.returnvalue)}`);
});

ingestWorker.on("failed", (job, err) => {
  console.error(`[ingest] failed ${job?.id ?? "?"} (${err.name}): ${err.message}`);
});

async function shutdown(signal: string) {
  console.log(`[workers] received ${signal}, shutting down…`);
  await ingestWorker.close();
  connection.disconnect();
  await pgClient.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log("[workers] lumen workers online — waiting for jobs");
