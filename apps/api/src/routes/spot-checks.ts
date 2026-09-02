import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assets,
  auditEvents,
  documents,
  projects,
  spotChecks,
  suggestions,
} from "@lumen/db";
import { notify } from "@lumen/notify";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";
import { sampleForSpotCheck, spotCheckRateFromEnv } from "../lib/spot-check.js";

const SpotCheckDecisionInput = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(2000).optional(),
});

/**
 * Senior spot-check workflow (Phase 3).
 *
 * Once a project is ready-to-export, an owner/admin can open a spot-check
 * batch: a deterministic sample of approved assets is flagged for a senior
 * second look. The export gate stays open regardless (spot-checks are a QA
 * aid, not a hard approval gate — the original review already approved the
 * asset), but the queue + decisions feed the compliance report trail.
 */
export function registerSpotCheckRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const requireUser = app.requireUser;

  app.post("/v1/projects/:id/spot-checks", async (req, reply) => {
    const user = await requireUser(req);
    if (user.role !== "owner" && user.role !== "admin") {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = req.params as { id: string };

    const owned = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    const approvedRows = await db
      .select({ id: assets.id })
      .from(assets)
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .where(and(eq(documents.projectId, id), eq(assets.state, "approved")));
    const approvedIds = approvedRows.map((a) => a.id);

    const rate = spotCheckRateFromEnv();
    const sampled = sampleForSpotCheck(id, approvedIds, rate);

    // Only create rows that aren't already open for the same asset.
    let created = 0;
    for (const assetId of sampled) {
      const done = await db
        .insert(spotChecks)
        .values({
          organizationId: user.organizationId,
          projectId: id,
          assetId,
          reviewerId: user.id,
        })
        .onConflictDoNothing({
          target: spotChecks.assetId,
          where: sql`status = 'open'`,
        })
        .returning({ id: spotChecks.id });
      if (done.length > 0) created += 1;
    }

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "spot_check.batch_created",
      subjectType: "project",
      subjectId: id,
      detail: { rate, eligible: approvedIds.length, sampled: sampled.length, created },
    });

    if (created > 0) {
      await notify(
        db,
        {
          organizationId: user.organizationId,
          kind: "spot_check.assigned",
          title: "Senior spot-check opened",
          body: `${created} approved asset(s) were sampled for a senior second review in project ${id.slice(0, 8)}.`,
          subjectType: "project",
          subjectId: id,
        },
        ctx.emailTransport
      );
    }

    return reply.code(201).send({
      rate,
      eligible: approvedIds.length,
      sampled: sampled.length,
      created,
    });
  });

  app.get("/v1/spot-checks", async (req, reply) => {
    const user = await requireUser(req);
    const { scope } = req.query as { scope?: string };
    const openOnly = scope !== "all";

    const rows = await db
      .select({
        check: spotChecks,
        asset: assets,
        documentId: documents.id,
        documentTitle: documents.title,
        suggestion: suggestions,
      })
      .from(spotChecks)
      .innerJoin(assets, eq(assets.id, spotChecks.assetId))
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .leftJoin(suggestions, eq(suggestions.assetId, assets.id))
      .where(
        and(
          eq(spotChecks.organizationId, user.organizationId),
          openOnly ? eq(spotChecks.status, "open") : undefined,
          or(eq(suggestions.revision, 1), isNull(suggestions.revision))
        )
      )
      .orderBy(desc(spotChecks.createdAt))
      .limit(200);

    return {
      rate: spotCheckRateFromEnv(),
      checks: rows.map((r) => ({
        id: r.check.id,
        assetId: r.asset.id,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        imageClass: r.asset.imageClass,
        suggestion: r.suggestion
          ? {
              id: r.suggestion.id,
              altText: r.suggestion.altText,
              longDescription: r.suggestion.longDescription,
              confidence: r.suggestion.confidence,
            }
          : null,
        status: r.check.status,
        decision: r.check.decision,
        comment: r.check.comment,
        createdAt: r.check.createdAt,
        resolvedAt: r.check.resolvedAt,
      })),
    };
  });

  app.post("/v1/spot-checks/:id/decision", async (req, reply) => {
    const user = await requireUser(req);
    if (user.role !== "owner" && user.role !== "admin") {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = req.params as { id: string };
    const input = SpotCheckDecisionInput.parse(req.body);

    const rows = await db
      .select({ check: spotChecks, projectId: projects.id })
      .from(spotChecks)
      .innerJoin(projects, eq(projects.id, spotChecks.projectId))
      .where(and(eq(spotChecks.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    const found = rows[0];
    if (!found) return reply.code(404).send({ error: "not_found" });
    if (found.check.status !== "open") {
      return reply.code(409).send({ error: "spot_check_already_resolved" });
    }

    const [updated] = await db
      .update(spotChecks)
      .set({
        status: "resolved",
        decision: input.decision,
        comment: input.comment ?? null,
        reviewerId: user.id,
        resolvedAt: new Date(),
      })
      .where(eq(spotChecks.id, id))
      .returning();
    if (!updated) throw new Error("failed_to_resolve_spot_check");

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: `spot_check.${input.decision}`,
      subjectType: "asset",
      subjectId: updated.assetId,
      detail: { comment: input.comment ?? null },
    });

    return reply.code(201).send({ check: updated });
  });
}