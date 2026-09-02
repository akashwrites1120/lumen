import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assets,
  auditEvents,
  documents,
  projects,
  reviewAssignments,
  suggestions,
  users,
} from "@lumen/db";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";

const AssignInput = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(500),
  reviewerId: z.string().uuid(),
});

/**
 * Reviewer-assignment routes.
 *
 * Two paths to put a reviewer on an asset:
 *   - admin/owner calls POST /v1/review/assign with explicit reviewerId
 *   - any reviewer calls POST /v1/review/claim with a list of asset ids
 *     to self-assign (or POST /v1/review/claim/next to claim the next
 *     unassigned asset in a project)
 *
 * Releases: POST /v1/review/release { assetId } marks the assignment
 * completed (so the partial-unique index allows a fresh assign).
 */
export function registerReviewerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const requireUser = app.requireUser;

  async function assertOrgOwnsAssets(
    organizationId: string,
    assetIds: string[]
  ): Promise<Map<string, { asset: typeof assets.$inferSelect; projectId: string }>> {
    if (assetIds.length === 0) return new Map();
    const rows = await db
      .select({ asset: assets, projectId: documents.projectId })
      .from(assets)
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .innerJoin(projects, eq(projects.id, documents.projectId))
      .where(and(inArray(assets.id, assetIds), eq(projects.organizationId, organizationId)));
    return new Map(rows.map((r) => [r.asset.id, { asset: r.asset, projectId: r.projectId }]));
  }

  app.post("/v1/review/assign", async (req, reply) => {
    const user = await requireUser(req);
    if (user.role !== "owner" && user.role !== "admin") {
      return reply.code(403).send({ error: "forbidden" });
    }
    const input = AssignInput.parse(req.body);
    if (input.reviewerId === user.id) {
      // self-assign is fine, but flag if not owner to keep audit clean
    }

    // confirm reviewer belongs to the same org
    const reviewerRow = (
      await db.select().from(users).where(eq(users.id, input.reviewerId)).limit(1)
    )[0];
    if (!reviewerRow || reviewerRow.organizationId !== user.organizationId) {
      return reply.code(400).send({ error: "reviewer_not_in_org" });
    }

    const owned = await assertOrgOwnsAssets(user.organizationId, input.assetIds);
    const missing = input.assetIds.filter((id) => !owned.has(id));
    if (missing.length > 0) {
      return reply.code(404).send({ error: "not_found", missing });
    }

    let assigned = 0;
    for (const assetId of input.assetIds) {
      const inserted = await db
        .insert(reviewAssignments)
        .values({ assetId, reviewerId: input.reviewerId, assignedBy: user.id })
        .onConflictDoNothing({ target: reviewAssignments.assetId, where: sql`status = 'assigned'` })
        .returning();
      if (inserted.length > 0) assigned += 1;
    }

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "review.bulk_assign",
      subjectType: "user",
      subjectId: input.reviewerId,
      detail: { requested: input.assetIds.length, assigned, skipped: input.assetIds.length - assigned },
    });

    return reply.code(201).send({ assigned, skipped: input.assetIds.length - assigned });
  });

  app.post("/v1/review/claim", async (req, reply) => {
    const user = await requireUser(req);
    if (user.role === "viewer") return reply.code(403).send({ error: "forbidden" });
    const input = AssignInput.parse({ ...(req.body as object), reviewerId: user.id });

    const owned = await assertOrgOwnsAssets(user.organizationId, input.assetIds);
    const missing = input.assetIds.filter((id) => !owned.has(id));
    if (missing.length > 0) return reply.code(404).send({ error: "not_found", missing });

    let claimed = 0;
    for (const assetId of input.assetIds) {
      const inserted = await db
        .insert(reviewAssignments)
        .values({ assetId, reviewerId: user.id, assignedBy: user.id })
        .onConflictDoNothing({ target: reviewAssignments.assetId, where: sql`status = 'assigned'` })
        .returning();
      if (inserted.length > 0) claimed += 1;
    }

    return reply.code(201).send({ claimed, skipped: input.assetIds.length - claimed });
  });

  app.post("/v1/review/release", async (req, reply) => {
    const user = await requireUser(req);
    if (user.role === "viewer") return reply.code(403).send({ error: "forbidden" });
    const { assetId } = z.object({ assetId: z.string().uuid() }).parse(req.body);

    const owned = await assertOrgOwnsAssets(user.organizationId, [assetId]);
    if (!owned.has(assetId)) return reply.code(404).send({ error: "not_found" });

    // only the current assignee or an admin can release
    const current = (
      await db
        .select()
        .from(reviewAssignments)
        .where(and(eq(reviewAssignments.assetId, assetId), eq(reviewAssignments.status, "assigned")))
        .limit(1)
    )[0];
    if (!current) return reply.code(409).send({ error: "not_assigned" });
    if (current.reviewerId !== user.id && user.role !== "owner" && user.role !== "admin") {
      return reply.code(403).send({ error: "forbidden" });
    }

    await db
      .update(reviewAssignments)
      .set({ status: "released", completedAt: new Date() })
      .where(eq(reviewAssignments.id, current.id));

    return reply.code(204).send();
  });

  // "My queue" — the next batch of assets assigned to this reviewer that
  // still need a decision. Returns the latest suggestion per asset.
  app.get("/v1/review/queue", async (req, reply) => {
    const user = await requireUser(req);
    const limit = Math.min(50, Math.max(1, Number((req.query as { limit?: string }).limit ?? 20)));

    const rows = await db
      .select({
        assignment: reviewAssignments,
        asset: assets,
        documentId: documents.id,
        documentTitle: documents.title,
      })
      .from(reviewAssignments)
      .innerJoin(assets, eq(assets.id, reviewAssignments.assetId))
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .innerJoin(projects, eq(projects.id, documents.projectId))
      .where(
        and(
          eq(reviewAssignments.reviewerId, user.id),
          eq(reviewAssignments.status, "assigned"),
          eq(projects.organizationId, user.organizationId)
        )
      )
      .orderBy(desc(reviewAssignments.assignedAt))
      .limit(limit);

    const assetIds = rows.map((r) => r.asset.id);
    const latestByAsset = new Map<string, (typeof suggestions.$inferSelect)>();
    if (assetIds.length > 0) {
      const sRows = await db
        .select()
        .from(suggestions)
        .where(inArray(suggestions.assetId, assetIds))
        .orderBy(desc(suggestions.revision));
      for (const s of sRows) {
        if (!latestByAsset.has(s.assetId)) latestByAsset.set(s.assetId, s);
      }
    }

    return {
      reviewerId: user.id,
      queue: rows.map((r) => ({
        assignmentId: r.assignment.id,
        assetId: r.asset.id,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        assignedAt: r.assignment.assignedAt,
        suggestion: latestByAsset.get(r.asset.id) ?? null,
      })),
    };
  });
}
