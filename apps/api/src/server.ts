import "dotenv/config";
import { Queue } from "bullmq";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { Redis } from "ioredis";
import { createDb } from "@lumen/db";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerDocumentRoutes, requireSessionUser } from "./routes/documents.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { createIngestQueue, createDraftQueue, createExportQueue, createWebhookQueue, INGEST_QUEUE } from "./queue.js";
import { LocalDiskStorage } from "./storage/local.js";
import { S3Storage, s3ClientFromEnv } from "./storage/s3.js";
import { RedisRateLimiter } from "./ratelimit.js";
import type { SessionUser } from "./auth/session.js";
import type { AppContext } from "./types.js";

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
    requireUser(req: FastifyRequest): Promise<SessionUser>;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const port = Number(process.env.PORT ?? 4000);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
  });

  await app.register(cors, { origin: [webOrigin], credentials: true });
  await app.register(multipart);
  await app.register(sensible);

  const { db, client: pgClient } = createDb(databaseUrl);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const ingestQueue = createIngestQueue(redisUrl);
  const draftQueue = createDraftQueue(redisUrl);
  const exportQueue = createExportQueue(redisUrl);
  const webhookQueue = createWebhookQueue(redisUrl);

  const storage =
    process.env.STORAGE_DRIVER === "s3" && process.env.S3_BUCKET
      ? new S3Storage(process.env.S3_BUCKET, s3ClientFromEnv())
      : new LocalDiskStorage(process.env.STORAGE_LOCAL_ROOT ?? ".data/storage");
  app.log.info(
    { driver: storage instanceof S3Storage ? "s3" : "local-disk" },
    "storage driver selected"
  );

  const ctx: AppContext = {
    db,
    storage,
    redis,
    redisRateLimit: new RedisRateLimiter(redis),
    ingestQueue,
    draftQueue,
    exportQueue,
    webhookQueue,
  };
  app.decorate("ctx", ctx);
  app.decorate("requireUser", (req: FastifyRequest) => requireSessionUser(app, ctx, req));

  registerAuthRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerDocumentRoutes(app, ctx);
  registerEventRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerExportRoutes(app, ctx);
  registerMetricsRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);

  app.get("/v1/queue/health", async () => {
    const [ingest, draft] = await Promise.all([
      ingestQueue.getJobCounts(),
      draftQueue.getJobCounts(),
    ]);
    return { ingest: { queue: INGEST_QUEUE, counts: ingest }, draft: { counts: draft } };
  });

  app.addHook("onClose", async () => {
    await Promise.allSettled([
      ingestQueue.close(),
      draftQueue.close(),
      exportQueue.close(),
      webhookQueue.close(),
    ]);
    redis.disconnect();
    await pgClient.end();
  });

  app.log.info({ port }, "lumen api configured");
  return app;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("server.ts")) {
  buildApp()
    .then((app) => app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
