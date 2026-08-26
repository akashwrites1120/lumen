import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assets, auditEvents, documents, projects, reviews, suggestions } from "@lumen/db";
import { ReviewDecisionInput } from "@lumen/schemas";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";

async function ownedAsset(
  ctx: AppContext,
  assetId: string,
  organizationId: string
) {
  const rows = await ctx.db
    .select({ asset: assets, doc: documents })
    .from(assets)
    .innerJoin(documents, eq(documents.id, assets.documentId))
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(and(eq(assets.id, assetId), eq(projects.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Advances the project stage based on asset states: reviewing → ready_to_export. */
async function recomputeProjectStage(ctx: AppContext, projectId: string): Promise<void> {
  const totalRow = (
    await ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(assets)
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .where(eq(documents.projectId, projectId))
  )[0];
  const total = totalRow?.total ?? 0;
  if (total === 0) return;

  const approved = (
    await ctx.db
      .select({ approved: sql<number>`count(*)::int` })
      .from(assets)
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .where(and(eq(documents.projectId, projectId), eq(assets.state, "approved")))
  )[0]?.approved ?? 0;

  const nextStage = approved >= total ? "ready_to_export" : "reviewing";  await ctx.db
    .update(projects)
    .set({ stage: nextStage, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export function registerReviewRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const requireUser = app.requireUser;

  app.get("/v1/documents/:id/review", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };

    const owned = await db
      .select({ projectId: documents.projectId })
      .from(documents)
      .innerJoin(projects, eq(projects.id, documents.projectId))
      .where(and(eq(documents.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    const rows = await db
      .select({
        asset: assets,
        suggestion: suggestions,
      })
      .from(assets)
      .leftJoin(suggestions, eq(suggestions.assetId, assets.id))
      .where(eq(assets.documentId, id))
      .orderBy(assets.spineIndex, suggestions.revision);

    // keep only the latest suggestion per asset
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      latest.set(row.asset.id, row);
    }

    const items = [...latest.values()].map((r) => ({
      ...r.asset,
      suggestion: r.suggestion,
    }));

    const counts = {
      total: items.length,
      drafted: items.filter((i) => i.suggestion !== null).length,
      approved: items.filter((i) => i.state === "approved").length,
    };

    return { documentId: id, counts, items };
  });

  app.post("/v1/assets/:assetId/decision", async (req, reply) => {
    const user = await requireUser(req);
    const { assetId } = req.params as { assetId: string };
    if (user.role === "viewer") return reply.code(403).send({ error: "forbidden" });

    const input = ReviewDecisionInput.parse(req.body);
    const found = await ownedAsset(ctx, assetId, user.organizationId);
    if (!found) return reply.code(404).send({ error: "not_found" });
    const { asset, doc } = found;

    const latestSuggestion = (
      await db
        .select()
        .from(suggestions)
        .where(eq(suggestions.assetId, asset.id))
        .orderBy(desc(suggestions.revision))
        .limit(1)
    )[0];

    if (!latestSuggestion && input.decision !== "decorative") {
      return reply.code(409).send({ error: "no_suggestion_available" });
    }

    const finalAltText =
      input.decision === "decorative"
        ? ""
        : (input.finalAltText ?? latestSuggestion!.altText);

    const [review] = await db
      .insert(reviews)
      .values({
        suggestionId: latestSuggestion?.id ?? asset.id,
        reviewerId: user.id,
        decision: input.decision,
        finalAltText,
        feedback: input.feedback ?? null,
        durationMs: input.durationMs ?? null,
      })
      .returning();

    const nextState =
      input.decision === "rejected"
        ? ("in_review" as const)
        : ("approved" as const);

    await db
      .update(assets)
      .set({ state: nextState })
      .where(eq(assets.id, asset.id));

    await recomputeProjectStage(ctx, doc.projectId);

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: `review.${input.decision}`,
      subjectType: "asset",
      subjectId: asset.id,
      detail: {
        suggestionId: latestSuggestion?.id ?? null,
        revision: latestSuggestion?.revision ?? null,
        editedByHuman:
          input.decision === "edited" &&
          finalAltText !== (latestSuggestion?.altText ?? ""),
        durationMs: input.durationMs ?? null,
      },
    });

    return reply.code(201).send({ review });
  });

  app.post("/v1/assets/:assetId/regenerate", async (req, reply) => {
    const user = await requireUser(req);
    const { assetId } = req.params as { assetId: string };
    if (user.role === "viewer") return reply.code(403).send({ error: "forbidden" });

    const found = await ownedAsset(ctx, assetId, user.organizationId);
    if (!found) return reply.code(404).send({ error: "not_found" });
    const { asset, doc } = found;

    await db
      .update(assets)
      .set({ state: "in_review" })
      .where(eq(assets.id, asset.id));
    await db
      .update(projects)
      .set({ stage: "reviewing", updatedAt: new Date() })
      .where(eq(projects.id, doc.projectId));

    await ctx.draftQueue.add(
      "draft-asset",
      { assetId: asset.id },
      { jobId: `draft-${asset.id}-${Date.now()}` }
    );

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "suggestion.regenerate",
      subjectType: "asset",
      subjectId: asset.id,
      detail: null,
    });

    return reply.code(202).send({ queued: true });
  });

  app.get("/v1/projects/:id/review-summary", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };

    const owned = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    const docRows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.projectId, id));
    const docIds = docRows.map((d) => d.id);

    if (docIds.length === 0) {
      return { summary: { total: 0, extracted: 0, ai_drafted: 0, in_review: 0, approved: 0 }, stage: null };
    }

    const grouped = await db
      .select({
        state: assets.state,
        count: sql<number>`count(*)::int`,
      })
      .from(assets)
      .where(inArray(assets.documentId, docIds))
      .groupBy(assets.state);

    const summary = Object.fromEntries(grouped.map((g) => [g.state, g.count]));
    for (const s of ["extracted", "ai_drafted", "in_review", "approved"] as const) {
      summary[s] ??= 0;
    }

    const projectRow = await db
      .select({ stage: projects.stage })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    return { summary, stage: projectRow[0]?.stage ?? null };
  });
}
