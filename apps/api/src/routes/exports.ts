import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assets, auditEvents, documents, exports as exportsTable, projects, reviews, suggestions, validations } from "@lumen/db";
import { CreateExportInput } from "@lumen/schemas";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";

async function ownedProject(ctx: AppContext, id: string, organizationId: string) {
  const rows = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export function registerExportRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const requireUser = app.requireUser;

  app.post("/v1/projects/:id/exports", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    if (user.role === "viewer") return reply.code(403).send({ error: "forbidden" });

    const project = await ownedProject(ctx, id, user.organizationId);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const input = CreateExportInput.parse(req.body);

    const docIds = (
      await db.select({ id: documents.id }).from(documents).where(eq(documents.projectId, id))
    ).map((d) => d.id);

    const total =
      (
        await db
          .select({ total: sql<number>`count(*)::int` })
          .from(assets)
          .where(docIds.length > 0 ? inArray(assets.documentId, docIds) : sql`false`)
      )[0]?.total ?? 0;

    const approved =
      (
        await db
          .select({ approved: sql<number>`count(*)::int` })
          .from(assets)
          .where(
            docIds.length > 0
              ? and(inArray(assets.documentId, docIds), eq(assets.state, "approved"))
              : sql`false`
          )
      )[0]?.approved ?? 0;

    if (total === 0) {
      return reply.code(409).send({ error: "no_assets", detail: "Upload a document first." });
    }
    if (approved < total) {
      return reply.code(409).send({
        error: "review_gate_open",
        detail: `${approved}/${total} assets approved. Export requires human approval of every image.`,
      });
    }

    const [exp] = await db
      .insert(exportsTable)
      .values({ projectId: id, formats: input.formats, requestedBy: user.id })
      .returning();
    if (!exp) throw new Error("failed_to_create_export");

    await ctx.exportQueue.add("build-export", { exportId: exp.id }, { jobId: `export-${exp.id}` });

    await db.update(projects).set({ stage: "exporting", updatedAt: new Date() }).where(eq(projects.id, id));

    return reply.code(202).send({ export: exp });
  });

  app.get("/v1/projects/:id/exports", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const project = await ownedProject(ctx, id, user.organizationId);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const rows = await db
      .select()
      .from(exportsTable)
      .where(eq(exportsTable.projectId, id))
      .orderBy(desc(exportsTable.createdAt));

    const validationRows = rows.length
      ? await db
          .select()
          .from(validations)
          .where(
            inArray(
              validations.exportId,
              rows.map((r) => r.id)
            )
          )
      : [];

    return {
      exports: rows.map((r) => ({
        ...r,
        validations: validationRows.filter((v) => v.exportId === r.id),
      })),
    };
  });

  app.get("/v1/exports/:exportId/artifact/:format", async (req, reply) => {
    const user = await requireUser(req);
    const { exportId, format } = req.params as { exportId: string; format: string };

    const rows = await db
      .select({ exp: exportsTable })
      .from(exportsTable)
      .innerJoin(projects, eq(projects.id, exportsTable.projectId))
      .where(and(eq(exportsTable.id, exportId), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    const exp = rows[0]?.exp;
    if (!exp || exp.status !== "completed") return reply.code(404).send({ error: "not_found" });

    const key = exp.artifactKeys?.[format];
    if (!key) return reply.code(404).send({ error: "artifact_not_found" });

    const body = await ctx.storage.get(key);
    const mime =
      format === "epub"
        ? "application/epub+zip"
        : format === "json"
          ? "application/json"
          : "application/octet-stream";

    return reply
      .header("content-type", mime)
      .header(
        "content-disposition",
        `attachment; filename="${exp.projectId.slice(0, 8)}-${exportId.slice(0, 8)}.${format}"`
      )
      .send(body);
  });

  app.get("/v1/exports/:exportId/report", async (req, reply) => {
    const user = await requireUser(req);
    const { exportId } = req.params as { exportId: string };

    const rows = await db
      .select({ exp: exportsTable, project: projects })
      .from(exportsTable)
      .innerJoin(projects, eq(projects.id, exportsTable.projectId))
      .where(and(eq(exportsTable.id, exportId), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    const found = rows[0];
    if (!found) return reply.code(404).send({ error: "not_found" });
    const { exp, project } = found;

    const validationRows = await db
      .select()
      .from(validations)
      .where(eq(validations.exportId, exportId));

    const docIds = (
      await db.select({ id: documents.id }).from(documents).where(eq(documents.projectId, project.id))
    ).map((d) => d.id);

    const decisionRows = docIds.length
      ? await db
          .select({ decision: reviews.decision })
          .from(reviews)
          .innerJoin(suggestions, eq(suggestions.id, reviews.suggestionId))
          .innerJoin(assets, eq(assets.id, suggestions.assetId))
          .where(inArray(assets.documentId, docIds))
      : [];

    const byType: Record<string, number> = {};
    for (const r of decisionRows) byType[r.decision] = (byType[r.decision] ?? 0) + 1;

    const report = {
      generator: "lumen",
      version: 1,
      generatedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name },
      export: {
        id: exp.id,
        formats: exp.formats,
        status: exp.status,
        createdAt: exp.createdAt,
      },
      reviewSummary: { totalDecisions: decisionRows.length, byType },
      validators: validationRows.map((v) => ({
        validator: v.validator,
        format: v.format,
        passed: v.passed,
        output: v.output,
        at: v.createdAt,
      })),
      standards: ["WCAG 2.1 AA", "EPUB Accessibility 1.1", "PDF/UA (pending Phase 3)"],
    };

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "export.report_downloaded",
      subjectType: "export",
      subjectId: exportId,
      detail: null,
    });

    return reply
      .header("content-type", "application/json")
      .header(
        "content-disposition",
        `attachment; filename="compliance-report-${exportId.slice(0, 8)}.json"`
      )
      .send(report);
  });
}
