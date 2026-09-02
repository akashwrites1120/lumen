import { and, desc, eq, gte, sql } from "drizzle-orm";
import { usageEvents } from "@lumen/db";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";

/**
 * Per-org usage endpoint. Aggregates the append-only `usage_events`
 * ledger over a window (default: last 30 days) and returns a small
 * summary so the dashboard can show vision-call volume and
 * artifact-build counts without scanning the full table.
 */
export function registerUsageRoutes(app: FastifyInstance, ctx: AppContext) {
  const requireUser = app.requireUser;

  app.get("/v1/org/usage", async (req, reply) => {
    const user = await requireUser(req);
    if (user.role === "viewer") return reply.code(403).send({ error: "forbidden" });

    const windowDays = clampDays(Number((req.query as { days?: string }).days ?? 30));
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await ctx.db
      .select({
        kind: usageEvents.kind,
        units: sql<number>`coalesce(sum(${usageEvents.units}), 0)::int`,
        events: sql<number>`count(*)::int`,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.organizationId, user.organizationId), gte(usageEvents.at, since)))
      .groupBy(usageEvents.kind);

    const totals = { vision_calls: 0, export_artifacts: 0, webhook_deliveries: 0 };
    for (const r of rows) {
      if (r.kind === "vision_call") totals.vision_calls = r.units;
      else if (r.kind === "export_artifact") totals.export_artifacts = r.units;
      else if (r.kind === "webhook_delivery") totals.webhook_deliveries = r.units;
    }

    return {
      windowDays,
      since: since.toISOString(),
      totals,
      byKind: rows.map((r) => ({ kind: r.kind, units: r.units, events: r.events })),
    };
  });

  app.get("/v1/org/usage/recent", async (req, reply) => {
    const user = await requireUser(req);
    if (user.role === "viewer") return reply.code(403).send({ error: "forbidden" });

    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 25)));
    const rows = await ctx.db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, user.organizationId))
      .orderBy(desc(usageEvents.at))
      .limit(limit);
    return { events: rows };
  });
}

function clampDays(d: number): number {
  if (!Number.isFinite(d)) return 30;
  return Math.min(90, Math.max(1, Math.floor(d)));
}
