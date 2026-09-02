import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { createDb } from "@lumen/db";
import { DRAFT_QUEUE, EXPORT_QUEUE, INGEST_QUEUE, WEBHOOK_QUEUE } from "./queue.js";
import { createAssetStoreFromEnv } from "./storage.js";
import { processIngest, type IngestJobData } from "./ingest.js";
import { processDraft, type DraftJobData } from "./draft.js";
import { processExport, type ExportJobData } from "./export/process.js";
import { processWebhookDelivery, type WebhookJobData } from "./webhook.js";
import { resolveVisionProviders } from "@lumen/providers";
import { visionCacheTtlFromEnv } from "./vision-cache.js";
import { spendAlertThresholdFromEnv } from "./spend-alert.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const { db, client: pgClient } = createDb(
  process.env.DATABASE_URL ?? "postgres://lumen:lumen@localhost:5432/lumen"
);

const store = createAssetStoreFromEnv();
const providers = resolveVisionProviders(process.env);
const draftQueue = new Queue(DRAFT_QUEUE, { connection });
const webhookQueue = new Queue(WEBHOOK_QUEUE, {
  connection,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 200, removeOnFail: 1000 },
});

const ingestWorker = new Worker<IngestJobData>(
  INGEST_QUEUE,
  async (job) => {
    console.log(`[ingest] processing job ${job.id} (attempt ${job.attemptsMade + 1})`);
    return processIngest(job, { db, redis: connection, store, draftQueue, webhookQueue });
  },
  { connection, concurrency: Number(process.env.INGEST_CONCURRENCY ?? 2) }
);

const draftWorker = new Worker<DraftJobData>(
  DRAFT_QUEUE,
  async (job) => {
    console.log(`[draft] asset ${job.data.assetId} (attempt ${job.attemptsMade + 1})`);
    return processDraft(job, {
      db,
      redis: connection,
      store,
      providers,
      maxAltChars: Number(process.env.VISION_MAX_ALT_CHARS ?? 125),
      cacheTtlSec: visionCacheTtlFromEnv(),
      spendAlertThreshold: spendAlertThresholdFromEnv(),
    });
  },
  { connection, concurrency: Number(process.env.DRAFT_CONCURRENCY ?? 4) }
);

const exportWorker = new Worker<ExportJobData>(
  EXPORT_QUEUE,
  async (job) => {
    console.log(`[export] export ${job.data.exportId} (attempt ${job.attemptsMade + 1})`);
    return processExport(job, { db, redis: connection, store, webhookQueue });
  },
  { connection, concurrency: 1 }
);

const webhookWorker = new Worker<WebhookJobData>(
  WEBHOOK_QUEUE,
  async (job) => {
    return processWebhookDelivery(job, { db });
  },
  { connection, concurrency: Number(process.env.WEBHOOK_CONCURRENCY ?? 4) }
);

for (const [name, worker] of [
  ["ingest", ingestWorker],
  ["draft", draftWorker],
  ["export", exportWorker],
  ["webhook", webhookWorker],
] as const) {
  worker.on("completed", (job) => {
    console.log(`[${name}] completed ${job.id}: ${JSON.stringify(job.returnvalue)}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[${name}] failed ${job?.id ?? "?"} (${err.name}): ${err.message}`);
  });
}

async function shutdown(signal: string) {
  console.log(`[workers] received ${signal}, shutting down…`);
  await Promise.allSettled([
    ingestWorker.close(),
    draftWorker.close(),
    exportWorker.close(),
    webhookWorker.close(),
    draftQueue.close(),
    webhookQueue.close(),
  ]);
  connection.disconnect();
  await pgClient.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(
  `[workers] online — providers: ${providers.map((p) => p.name).join(" → ")}; waiting for jobs`
);
