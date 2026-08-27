import { and, eq } from "drizzle-orm";
import { auditEvents, documents, projects } from "@lumen/db";
import { MAX_UPLOAD_BYTES, ProgressEvent } from "@lumen/schemas";
import type { FastifyInstance } from "fastify";
import { publishProgress } from "../events.js";
import { INGEST_QUEUE } from "../queue.js";
import { scanBuffer } from "../security/scan.js";
import { resolveSession, type SessionUser } from "../auth/session.js";
import type { AppContext } from "../types.js";

const ACCEPTED_TYPES = [
  { ext: ".epub", mime: "application/epub+zip" },
  {
    ext: ".docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  { ext: ".pdf", mime: "application/pdf" },
] as const;

export async function requireSessionUser(
  app: FastifyInstance,
  ctx: AppContext,
  req: { headers: Record<string, unknown> }
): Promise<SessionUser> {
  const header = req.headers.authorization;
  const token =
    typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = await resolveSession(ctx.db, token);
  if (!user) throw app.httpErrors.unauthorized();
  return user;
}

async function ownedProjectOr404(
  ctx: AppContext,
  projectId: string,
  organizationId: string
) {
  const rows = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export function registerDocumentRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/projects/:id/documents", async (req, reply) => {
    const user = await requireSessionUser(app, ctx, req);
    const { id } = req.params as { id: string };

    const project = await ownedProjectOr404(ctx, id, user.organizationId);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) return reply.code(400).send({ error: "file_required" });

    const lowerName = file.filename.toLowerCase();
    const accepted = ACCEPTED_TYPES.find(
      (t) => file.mimetype === t.mime || lowerName.endsWith(t.ext)
    );
    if (!accepted) {
      return reply.code(415).send({
        error: "unsupported_media_type",
        detail: "Accepted formats: EPUB, DOCX, PDF.",
      });
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: "payload_too_large" });
    }

    const scan = await scanBuffer(buffer);
    if (!scan.clean) {
      await ctx.db.insert(auditEvents).values({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "document.upload_rejected_threat",
        subjectType: "document",
        subjectId: file.filename,
        detail: { engine: scan.engine, verdict: scan.detail },
      });
      return reply.code(422).send({ error: "malware_detected", engine: scan.engine });
    }

    const stored = await ctx.storage.put({
      scope: `${user.organizationId}/${id}/sources`,
      filename: file.filename,
      contentType: accepted.mime,
      body: buffer,
    });

    const [doc] = await ctx.db
      .insert(documents)
      .values({
        projectId: id,
        filename: file.filename,
        mimeType: accepted.mime,
        sizeBytes: stored.byteSize,
        checksumSha256: stored.checksumSha256,
        storageKey: stored.storageKey,
        state: "uploaded",
        uploadedBy: user.id,
      })
      .returning();
    if (!doc) throw new Error("failed_to_create_document");

    await ctx.db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "document.uploaded",
      subjectType: "document",
      subjectId: doc.id,
      detail: { filename: doc.filename, sizeBytes: doc.sizeBytes },
    });

    await ctx.ingestQueue.add(
      "ingest-document",
      { documentId: doc.id },
      { jobId: `ingest-${doc.id}` }
    );
    await ctx.db
      .update(documents)
      .set({ state: "parsing", updatedAt: new Date() })
      .where(eq(documents.id, doc.id));

    publishProgress(
      ctx.redis,
      ProgressEvent.parse({
        type: "document.progress",
        documentId: doc.id,
        projectId: id,
        stage: "received",
        figuresFound: 0,
        message: `Queued ${doc.filename}`,
        at: new Date().toISOString(),
      })
    );

    return reply.code(202).send({ document: doc });
  });
}
