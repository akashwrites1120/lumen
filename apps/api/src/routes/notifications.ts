import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";
import { listNotifications, markRead } from "../notifications.js";

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext) {
  const requireUser = app.requireUser;

  app.get("/v1/notifications", async (req) => {
    const user = await requireUser(req);
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 25)));
    const items = await listNotifications(ctx.db, user.id, limit);
    return { notifications: items };
  });

  app.post("/v1/notifications/:id/read", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const parsed = z.object({ id: z.string().uuid() }).safeParse({ id });
    if (!parsed.success) return reply.code(400).send({ error: "bad_id" });
    const ok = await markRead(ctx.db, user.id, id);
    if (!ok) return reply.code(404).send({ error: "not_found_or_already_read" });
    return reply.code(204).send();
  });
}
