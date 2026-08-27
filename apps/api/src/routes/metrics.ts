import { and, desc, eq } from "drizzle-orm";
import { documents, projects, reviews, suggestions, assets } from "@lumen/db";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";

/** Levenshtein distance capped for long texts — measures human edit effort. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length > 2000 || b.length > 2000) return Math.abs(a.length - b.length);
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

export function registerMetricsRoutes(app: FastifyInstance, ctx: AppContext) {
  const requireUser = app.requireUser;

  app.get("/v1/projects/:id/metrics", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };

    const owned = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    const rows = await ctx.db
      .select({
        decision: reviews.decision,
        finalAltText: reviews.finalAltText,
        durationMs: reviews.durationMs,
        createdAt: reviews.createdAt,
        suggestedAltText: suggestions.altText,
        confidence: suggestions.confidence,
      })
      .from(reviews)
      .innerJoin(suggestions, eq(suggestions.id, reviews.suggestionId))
      .innerJoin(assets, eq(assets.id, suggestions.assetId))
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .where(eq(documents.projectId, id))
      .orderBy(desc(reviews.createdAt));

    const decisions = rows;

    const byType: Record<string, number> = {};
    let approvals = 0;
    let uneditedApprovals = 0;
    let editedCount = 0;
    let editDistanceTotal = 0;
    const durations: number[] = [];

    for (const d of decisions) {
      byType[d.decision] = (byType[d.decision] ?? 0) + 1;
      if (d.decision === "approved" || d.decision === "edited" || d.decision === "decorative") {
        approvals += 1;
        const changed = d.finalAltText !== d.suggestedAltText;
        if (!changed && d.decision === "approved") uneditedApprovals += 1;
        if (changed) {
          editedCount += 1;
          editDistanceTotal += editDistance(d.suggestedAltText, d.finalAltText);
        }
      }
      if (typeof d.durationMs === "number") durations.push(d.durationMs);
    }

    const avg = (xs: number[]) =>
      xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    const p = (xs: number[], q: number) =>
      xs.length === 0 ? null : xs.slice().sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))]!;

    const acceptanceRate =
      approvals === 0 ? null : Math.round((uneditedApprovals / approvals) * 100);

    return {
      metrics: {
        totalDecisions: decisions.length,
        byType,
        aiAcceptanceRatePct: acceptanceRate,
        editedDecisions: editedCount,
        avgEditDistanceChars: editedCount > 0 ? Math.round(editDistanceTotal / editedCount) : null,
        reviewThroughputSec: (() => {
          const v = avg(durations.map((d) => Math.round(d / 1000)));
          return v ?? null;
        })(),
        throughputP50Sec: p(durations.map((d) => Math.round(d / 1000)), 0.5),
        throughputP95Sec: p(durations.map((d) => Math.round(d / 1000)), 0.95),
        avgSuggestionConfidence: (() => {
          const confs = decisions
            .map((d) => d.confidence)
            .filter((c): c is number => typeof c === "number");
          return avg(confs);
        })(),
      },
    };
  });
}
