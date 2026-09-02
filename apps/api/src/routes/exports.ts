import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assets, auditEvents, documents, exports as exportsTable, projects, reviews, suggestions, validations } from "@lumen/db";
import { CreateExportInput } from "@lumen/schemas";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../types.js";
import {
  buildVpatMarkdown,
  reportSigningKey,
  signReport,
} from "../lib/compliance.js";

async function ownedProject(ctx: AppContext, id: string, organizationId: string) {
  const rows = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

const ARTIFACT_MIME: Record<string, string> = {
  json: "application/json",
  epub: "application/epub+zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  html: "text/html; charset=utf-8",
  azw3: "application/x-mobipocket-ebook",
  pdf: "application/pdf",
};

/**
 * Loads everything the compliance report (and VPAT summary) needs for an
 * export: the export, its project, the validator outcomes, and the review
 * decision histogram for every asset.
 */
async function loadReportData(ctx: AppContext, exportId: string) {
  const rows = await ctx.db
    .select({ exp: exportsTable, project: projects })
    .from(exportsTable)
    .innerJoin(projects, eq(projects.id, exportsTable.projectId))
    .where(eq(exportsTable.id, exportId))
    .limit(1);
  const found = rows[0];
  if (!found) return null;
  const { exp, project } = found;

  const validationRows = await ctx.db
    .select()
    .from(validations)
    .where(eq(validations.exportId, exportId));

  const docIds = (
    await ctx.db.select({ id: documents.id }).from(documents).where(eq(documents.projectId, project.id))
  ).map((d) => d.id);

  const decisionRows = docIds.length
    ? await ctx.db
        .select({ decision: reviews.decision })
        .from(reviews)
        .innerJoin(suggestions, eq(suggestions.id, reviews.suggestionId))
        .innerJoin(assets, eq(assets.id, suggestions.assetId))
        .where(inArray(assets.documentId, docIds))
    : [];

  const byType: Record<string, number> = {};
  for (const r of decisionRows) byType[r.decision] = (byType[r.decision] ?? 0) + 1;

  return {
    exp,
    project,
    validationRows,
    byType,
    totalDecisions: decisionRows.length,
  };
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

    // D-1: Kindle output ships as AZW3, labelled "Kindle-ready", behind the
    // AZW3_ENABLED feature flag until Kindle validation matures.
    if (input.formats.includes("azw3") && process.env.AZW3_ENABLED !== "true") {
      return reply.code(409).send({
        error: "azw3_disabled",
        detail:
          "Kindle export is behind a feature flag. Set AZW3_ENABLED=true and configure AZW3_CONVERT_URL (sidecar) or CALIBRE_CMD to enable it.",
      });
    }

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
    const mime = ARTIFACT_MIME[format] ?? "application/octet-stream";

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

    const owned = await db
      .select({ organizationId: projects.organizationId })
      .from(exportsTable)
      .innerJoin(projects, eq(projects.id, exportsTable.projectId))
      .where(and(eq(exportsTable.id, exportId), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    const data = await loadReportData(ctx, exportId);
    if (!data) return reply.code(404).send({ error: "not_found" });
    const { exp, project, validationRows, byType, totalDecisions } = data;

    // Phase 3: PDF/UA coverage joined the gate — reflect it in the standards list.
    const standards = ["WCAG 2.1 AA", "EPUB Accessibility 1.1", "PDF/UA (ISO 14289-1)"];

    const report = {
      generator: "lumen",
      version: 2,
      generatedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name },
      export: {
        id: exp.id,
        formats: exp.formats,
        status: exp.status,
        createdAt: exp.createdAt,
      },
      reviewSummary: { totalDecisions, byType },
      validators: validationRows.map((v) => ({
        validator: v.validator,
        format: v.format,
        passed: v.passed,
        output: v.output,
        at: v.createdAt,
      })),
      standards,
    };

    // Signed compliance report (Phase 3): the HMAC is computed over the
    // stable JSON so downstream consumers can verify both authenticity and
    // integrity using REPORT_SIGNING_KEY.
    const signature = signReport(report as unknown as Record<string, unknown>, reportSigningKey());
    const signedReport = { ...report, signature };

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "export.report_downloaded",
      subjectType: "export",
      subjectId: exportId,
      detail: { signed: true, keyId: signature.keyId },
    });

    return reply
      .header("content-type", "application/json")
      .header("x-lumen-report-signature", signature.value)
      .header(
        "content-disposition",
        `attachment; filename="compliance-report-${exportId.slice(0, 8)}.json"`
      )
      .send(signedReport);
  });

  app.get("/v1/exports/:exportId/vpat", async (req, reply) => {
    const user = await requireUser(req);
    const { exportId } = req.params as { exportId: string };

    const owned = await db
      .select({ organizationId: projects.organizationId })
      .from(exportsTable)
      .innerJoin(projects, eq(projects.id, exportsTable.projectId))
      .where(and(eq(exportsTable.id, exportId), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });

    const data = await loadReportData(ctx, exportId);
    if (!data) return reply.code(404).send({ error: "not_found" });
    const { exp, project, validationRows, byType } = data;

    const markdown = buildVpatMarkdown({
      project: { name: project.name },
      export: {
        id: exp.id,
        formats: exp.formats,
        status: exp.status,
        createdAt: exp.createdAt,
      },
      generatedAt: new Date(),
      review: {
        total: Object.values(byType).reduce((a, b) => a + b, 0),
        approved: byType["approved"] ?? 0,
        edited: byType["edited"] ?? 0,
        rejected: byType["rejected"] ?? 0,
        decorative: byType["decorative"] ?? 0,
      },
      validators: validationRows.map((v) => ({
        validator: v.validator,
        format: v.format,
        passed: v.passed as "passed" | "failed" | "skipped",
      })),
      standards: ["WCAG 2.1 AA", "EPUB Accessibility 1.1", "PDF/UA (ISO 14289-1)"],
    });

    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "export.vpat_downloaded",
      subjectType: "export",
      subjectId: exportId,
      detail: null,
    });

    return reply
      .header("content-type", "text/markdown; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="vpat-${exportId.slice(0, 8)}.md"`
      )
      .send(markdown);
  });
}
