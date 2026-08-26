import { and, desc, eq, sql } from "drizzle-orm";
import {
  assets,
  auditEvents,
  documents,
  projects,
} from "@lumen/db";
import { CreateProjectInput, UpdateProjectInput } from "@lumen/schemas";
import type { FastifyInstance } from "fastify";
import { INGEST_QUEUE } from "../queue.js";
import { requireSessionUser as requireUser } from "./documents.js";
import type { AppContext } from "../types.js";

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get("/v1/projects", async (req) => {
    const user = await requireUser(app, ctx, req);
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        stage: projects.stage,
        createdAt: projects.createdAt,
        documentCount: sql<number>`(
          select count(*)::int from ${documents} where ${documents.projectId} = ${projects.id}
        )`,
        assetCount: sql<number>`(
          select count(*)::int from ${assets}
          join ${documents} as d2 on d2.id = ${assets.documentId}
          where d2.project_id = ${projects.id}
        )`,
      })
      .from(projects)
      .where(eq(projects.organizationId, user.organizationId))
      .orderBy(desc(projects.createdAt));
    return { projects: rows };
  });

  app.post("/v1/projects", async (req, reply) => {
    const user = await requireUser(app, ctx, req);
    const input = CreateProjectInput.parse(req.body);
    const [project] = await db
      .insert(projects)
      .values({
        organizationId: user.organizationId,
        name: input.name,
        description: input.description ?? null,
        createdBy: user.id,
      })
      .returning();
    if (!project) throw new Error("failed_to_create_project");
    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "project.created",
      subjectType: "project",
      subjectId: project.id,
    });
    return reply.code(201).send({ project });
  });

  app.get("/v1/projects/:id", async (req, reply) => {
    const user = await requireUser(app, ctx, req);
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    const project = rows[0];
    if (!project) return reply.code(404).send({ error: "not_found" });

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.projectId, project.id))
      .orderBy(desc(documents.createdAt));

    return { project, documents: docs };
  });

  app.patch("/v1/projects/:id", async (req, reply) => {
    const user = await requireUser(app, ctx, req);
    const { id } = req.params as { id: string };
    const input = UpdateProjectInput.parse(req.body);
    if (!user || (user.role !== "owner" && user.role !== "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const [updated] = await db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return { project: updated };
  });

  app.delete("/v1/projects/:id", async (req, reply) => {
    const user = await requireUser(app, ctx, req);
    const { id } = req.params as { id: string };
    if (user.role !== "owner" && user.role !== "admin") {
      return reply.code(403).send({ error: "forbidden" });
    }
    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .returning({ id: projects.id });
    if (deleted.length === 0) return reply.code(404).send({ error: "not_found" });
    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "project.deleted",
      subjectType: "project",
      subjectId: id,
    });
    return reply.code(204).send();
  });

  app.get("/v1/projects/:id/documents", async (req, reply) => {
    const user = await requireUser(app, ctx, req);
    const { id } = req.params as { id: string };
    const owned = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    if (owned.length === 0) return reply.code(404).send({ error: "not_found" });
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.projectId, id))
      .orderBy(desc(documents.createdAt));
    return { documents: docs };
  });

  app.get("/v1/documents/:id/assets", async (req, reply) => {
    const user = await requireUser(app, ctx, req);
    const { id } = req.params as { id: string };
    const rows = await db
      .select({ asset: assets })
      .from(assets)
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .innerJoin(projects, eq(projects.id, documents.projectId))
      .where(
        and(eq(assets.documentId, id), eq(projects.organizationId, user.organizationId))
      )
      .orderBy(assets.spineIndex, assets.createdAt);
    return { assets: rows.map((r) => r.asset) };
  });

  app.get("/v1/assets/:assetId/content", async (req, reply) => {
    const user = await requireUser(app, ctx, req);
    const { assetId } = req.params as { assetId: string };
    const rows = await db
      .select({ asset: assets })
      .from(assets)
      .innerJoin(documents, eq(documents.id, assets.documentId))
      .innerJoin(projects, eq(projects.id, documents.projectId))
      .where(and(eq(assets.id, assetId), eq(projects.organizationId, user.organizationId)))
      .limit(1);
    const asset = rows[0]?.asset;
    if (!asset) return reply.code(404).send({ error: "not_found" });
    const body = await ctx.storage.get(asset.storageKey);
    return reply.header("content-type", asset.mimeType).send(body);
  });
}
