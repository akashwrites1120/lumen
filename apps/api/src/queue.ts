import { Queue } from "bullmq";

export const INGEST_QUEUE = "ingest.q";
export const DRAFT_QUEUE = "draft.q";

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
