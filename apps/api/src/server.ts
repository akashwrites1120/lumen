import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Queue } from "bullmq";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { Redis } from "ioredis";
import { createDb } from "@lumen/db";
import { createEmailTransportFromEnv } from "@lumen/notify";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerDocumentRoutes, requireSessionUser } from "./routes/documents.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerUsageRoutes } from "./routes/usage.js";
import { registerReviewerRoutes } from "./routes/reviewer-assignments.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
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

  const emailTransport = createEmailTransportFromEnv();
  app.log.info(
    { transport: emailTransport ? "smtp" : "none (in-app only)" },
    "email transport selected"
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
    emailTransport,
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
  registerUsageRoutes(app, ctx);
  registerReviewerRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);

  app.get("/v1/queue/health", async () => {
    const [ingest, draft] = await Promise.all([
      ingestQueue.getJobCounts(),
      draftQueue.getJobCounts(),
    ]);
    return { ingest: { queue: INGEST_QUEUE, counts: ingest }, draft: { counts: draft } };
  });

  // OpenAPI spec served from disk so the YAML is the single source of truth.
  // Path is resolved relative to the compiled file so it works under both
  // `tsx watch` (src/) and `node dist/`.
  const here = dirname(fileURLToPath(import.meta.url));
  const openapiPath = resolve(here, "..", "openapi.yaml");
  app.get("/openapi.yaml", async (_req, reply) => {
    const body = await readFile(openapiPath, "utf8");
    reply.type("application/yaml").send(body);
  });

  app.get("/docs", async (_req, reply) => {
    reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Lumen API (Beta)</title></head>
<body style="font-family:system-ui;max-width:720px;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>Lumen API <small style="color:#b45309">beta</small></h1>
<p>This API is in public beta. Endpoints and shapes may change before GA.</p>
<ul>
  <li><a href="/openapi.yaml">Download OpenAPI 3.1 spec</a></li>
  <li>Paste the spec into <a href="https://editor.swagger.io">editor.swagger.io</a> or Redoc to browse.</li>
</ul>
<h2>Stable integration surface</h2>
<ul>
  <li><code>Idempotency-Key</code> on <code>POST /v1/documents</code> — same key + same body within 24h returns the original document.</li>
  <li><code>POST /v1/webhooks</code> — receives HMAC-SHA256 signed deliveries (<code>X-Lumen-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>).</li>
  <li>Per-org rate limits: <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code>, <code>Retry-After</code> on 429.</li>
</ul>
</body></html>`);
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
