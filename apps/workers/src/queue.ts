import { Queue } from "bullmq";

export const INGEST_QUEUE = "ingest.q";
export const DRAFT_QUEUE = "draft.q";
export const EXPORT_QUEUE = "export.q";
export const WEBHOOK_QUEUE = "webhook.q";

export function createQueue(redisUrl: string, name: string): Queue {
  return new Queue(name, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
}
