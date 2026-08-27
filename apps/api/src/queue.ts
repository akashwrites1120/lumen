import { Queue } from "bullmq";

export const INGEST_QUEUE = "ingest.q";
export const DRAFT_QUEUE = "draft.q";
export const EXPORT_QUEUE = "export.q";
export const WEBHOOK_QUEUE = "webhook.q";

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: 200,
  removeOnFail: 500,
} as const;

export function createIngestQueue(redisUrl: string) {
  return new Queue(INGEST_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS },
  });
}

export function createDraftQueue(redisUrl: string) {
  return new Queue(DRAFT_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      backoff: { type: "exponential", delay: 2000 },
    },
  });
}

export function createExportQueue(redisUrl: string) {
  return new Queue(EXPORT_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 2 },
  });
}

export function createWebhookQueue(redisUrl: string) {
  return new Queue(WEBHOOK_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 1000,
    },
  });
}
