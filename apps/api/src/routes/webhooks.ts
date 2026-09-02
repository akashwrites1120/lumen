import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, webhookEndpoints } from "@lumen/db";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";
import { RATE_LIMIT_PRESETS } from "../http/rate-limit.js";

const CreateWebhookInput = z.object({
  url: z.string().url().startsWith("https://").or(z.string().url().startsWith("http://localhost")),
  events: z.array(z.string()).min(1).default(["*"]),
});

export const WEBHOOK_EVENT_TYPES = [
  "*",
  "document.ingested",
  "export.completed",
] as const;

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const requireUser = app.requireUser;

  // shared guard: ensures an authenticated user then charges the per-org
  // rate limit. Returns the user on success; null on rate-limit (already
  // replied with 429).
  async function authedAndLimited(
    req: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
    cfg: typeof RATE_LIMIT_PRESETS.webhookCud,
  ) {
    const user = await requireUser(req);
    if (user.role !== "owner" && user.role !== "admin") {
      reply.code(403).send({ error: "forbidden" });
      return null;
    }
    const rl = await ctx.redisRateLimit.hit(`webhook:${user.organizationId}`, cfg);
    reply.header("X-RateLimit-Remaining", String(rl.remaining));
    reply.header("X-RateLimit-Reset", String(rl.resetSec));
    if (!rl.allowed) {
      reply.header("Retry-After", String(rl.resetSec));
      reply.code(429).send({ error: "rate_limited", retryAfterSec: rl.resetSec });
      return null;
    }
    return user;
  }

  app.get("/v1/webhooks", async (req, reply) => {
    const user = await authedAndLimited(req, reply, RATE_LIMIT_PRESETS.webhookCud);
    if (!user) return;
    const rows = await db
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        events: webhookEndpoints.events,
        active: webhookEndpoints.active,
        createdAt: webhookEndpoints.createdAt,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.organizationId, user.organizationId))
      .orderBy(desc(webhookEndpoints.createdAt));
    return { webhooks: rows };
  });

  app.post("/v1/webhooks", async (req, reply) => {
    const user = await authedAndLimited(req, reply, RATE_LIMIT_PRESETS.webhookCud);
    if (!user) return;
    const input = CreateWebhookInput.parse(req.body);

    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const [webhook] = await db
      .insert(webhookEndpoints)
      .values({
        organizationId: user.organizationId,
        url: input.url,
        secret,
        events: input.events,
      })
      .returning();
    if (!webhook) throw new Error("failed_to_create_webhook");

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "webhook.created",
      subjectType: "webhook",
      subjectId: webhook.id,
      detail: { url: webhook.url, events: webhook.events },
    });

    return reply.code(201).send({ webhook: { ...webhook, secret }, eventTypes: WEBHOOK_EVENT_TYPES });
  });

  app.post("/v1/webhooks/:id/test", async (req, reply) => {
    const user = await authedAndLimited(req, reply, RATE_LIMIT_PRESETS.webhookTest);
    if (!user) return;
    const { id } = req.params as { id: string };
    const owned = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    await ctx.webhookQueue.add(
      "webhook-delivery",
      {
        endpointId: id,
        event: "ping",
        payload: { message: "Lumen webhook test delivery" },
      },
      { attempts: 1 }
    );
    return reply.code(202).send({ queued: true });
  });

  app.delete("/v1/webhooks/:id", async (req, reply) => {
    const user = await authedAndLimited(req, reply, RATE_LIMIT_PRESETS.webhookCud);
    if (!user) return;
    const { id } = req.params as { id: string };
    const deleted = await db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, user.organizationId)))
      .returning({ id: webhookEndpoints.id });
    if (deleted.length === 0) return reply.code(404).send({ error: "not_found" });
    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "webhook.deleted",
      subjectType: "webhook",
      subjectId: id,
      detail: null,
    });
    return reply.code(204).send();
  });
}
