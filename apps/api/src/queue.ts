import { Queue } from "bullmq";

export const INGEST_QUEUE = "ingest.q";

export function createIngestQueue(redisUrl: string) {
  return new Queue(INGEST_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
}
