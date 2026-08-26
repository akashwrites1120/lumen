import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assets, documents, exports as exportsTable, projects, validations } from "@lumen/db";
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
}
