import { and, eq } from "drizzle-orm";
import { projects } from "@lumen/db";
import { progressChannel } from "@lumen/schemas";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { requireSessionUser } from "./documents.js";
import type { AppContext } from "../types.js";

export function registerEventRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/v1/projects/:id/events", async (req, reply) => {
    const user = await requireSessionUser(app, ctx, req);
    const { id } = req.params as { id: string };

    const owned = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`event: ready\ndata: {"projectId":"${id}"}\n\n`);

    const sub: Redis = ctx.redis.duplicate();
    const channel = progressChannel(id);
    await sub.subscribe(channel);

    const onMessage = (ch: string, payload: string) => {
      if (ch !== channel) return;
      reply.raw.write(`event: progress\ndata: ${payload}\n\n`);
    };
    sub.on("message", onMessage);

    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      void sub.unsubscribe(channel).finally(() => sub.disconnect());
    });
  });
}
