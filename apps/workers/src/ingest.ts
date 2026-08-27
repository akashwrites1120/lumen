import { and, eq } from "drizzle-orm";
import type { Job, Queue } from "bullmq";
import type { Redis } from "ioredis";
import { imageSize as sizeOf } from "image-size";
import { documents, projects, assets, auditEvents, type LumenDb } from "@lumen/db";
import {
  ProgressEvent,
  type Block,
  type CanonicalIR,
  type IngestStage,
} from "@lumen/schemas";
import { parseEpub, type ParsedDocument, type ParsedSection, type SectionBlock } from "./epub-parser.js";
import { parseDocx } from "./docx-parser.js";
import { parsePdf } from "./pdf-parser.js";
import type { AssetStore } from "./storage.js";

export interface IngestJobData {
  documentId: string;
}

export interface IngestDeps {
  db: LumenDb;
  redis: Redis;
  store: AssetStore;
  draftQueue?: Queue;
}

const IMAGE_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function processIngest(
  job: Job<IngestJobData>,
  deps: IngestDeps
): Promise<{ figuresFound: number }> {
  const { db, redis, store } = deps;
  const { documentId } = job.data;

  const docRows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw new Error(`document not found: ${documentId}`);

  const projectRows = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, doc.projectId))
    .limit(1);
  const orgId = projectRows[0]?.organizationId;
  if (!orgId) throw new Error(`project not found for document: ${doc.projectId}`);

  let figuresFound = 0;
  const emit = (stage: IngestStage, message?: string) => {
    publish(redis, {
      type: "document.progress",
      documentId,
      projectId: doc.projectId,
      stage,
      figuresFound,
      message,
      at: new Date().toISOString(),
    });
  };

  try {
    await setDocState(db, documentId, "parsing");
    emit("received", `Starting ingest of ${doc.filename}`);

    emit("parsing", "Reading source document");
    const source = await store.read(doc.storageKey);
    const parsed: ParsedDocument = await (doc.mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ? parseDocx(source)
      : doc.mimeType === "application/pdf"
        ? parsePdf(source)
        : parseEpub(source));
    const format = doc.mimeType === "application/epub+zip" ? "epub" as const
      : doc.mimeType === "application/pdf" ? "pdf" as const
      : "docx" as const;

    if (parsed.title) {
      await db.update(documents).set({ title: parsed.title }).where(eq(documents.id, documentId));
    }

    emit("extracting_images", `${parsed.images.size} image(s) in manifest`);
    const hrefToAssetId = new Map<string, string>();
    const checksumToAssetId = new Map<string, string>();

    for (const [href, ref] of parsed.images) {
      const buffer = await parsed.readBinary(href);
      if (!buffer || buffer.byteLength === 0) {
        job.log(`skipping unreadable image: ${href}`);
        continue;
      }

      const ext = extOf(href);
      const mime = ref.mediaType || IMAGE_EXT_MIME[ext] || "application/octet-stream";

      try {
        const stored = await store.write(`${orgId}/${doc.projectId}/assets`, basename(href), buffer);
        const dims = imageSize(buffer);

        const inserted = await db
          .insert(assets)
          .values({
            documentId,
            storageKey: stored.storageKey,
            mimeType: mime,
            byteSize: stored.byteSize,
            checksumSha256: stored.checksumSha256,
            sourceHref: href,
            spineIndex: spineIndexFor(parsed.sections, href),
            widthPx: dims?.width ?? null,
            heightPx: dims?.height ?? null,
            state: "extracted",
          })
          .onConflictDoNothing({
            target: [assets.documentId, assets.checksumSha256],
          })
          .returning();

        let assetId: string | undefined = inserted[0]?.id;
        if (!assetId) {
          const existing = await db
            .select({ id: assets.id })
            .from(assets)
            .where(and(eq(assets.documentId, documentId), eq(assets.checksumSha256, stored.checksumSha256)))
            .limit(1);
          assetId = existing[0]?.id;
        }
        if (assetId) {
          hrefToAssetId.set(href, assetId);
          checksumToAssetId.set(stored.checksumSha256, assetId);
          figuresFound += 1;
        }
        emit("extracting_images", `Extracted ${basename(href)}`);
      } catch (err) {
        job.log(`failed to store asset ${href}: ${String(err)}`);
      }
    }

    emit("building_ir", "Building canonical IR");
    const ir = buildIR(documentId, format, parsed.title, parsed.language, parsed.sections, hrefToAssetId);
    figuresFound = countIRFigures(ir);

    await db
      .update(documents)
      .set({
        state: "ingested",
        language: parsed.language,
        irSnapshot: { sections: ir.sections },
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await db.insert(auditEvents).values({
      organizationId: orgId,
      action: "document.ingested",
      subjectType: "document",
      subjectId: documentId,
      detail: { figuresFound, sections: ir.sections.length },
    });

    if (deps.draftQueue && figuresFound > 0) {
      await db
        .update(projects)
        .set({ stage: "drafting", updatedAt: new Date() })
        .where(eq(projects.id, doc.projectId));
      const assetRows = await db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.documentId, documentId));
      await Promise.all(
        assetRows.map((a) =>
          deps.draftQueue!.add("draft-asset", { assetId: a.id }, { jobId: `draft-${a.id}` })
        )
      );
      emit("building_ir", `Queued ${assetRows.length} image(s) for AI drafting`);
    }

    emit("completed", `Ingested ${ir.sections.length} sections, ${figuresFound} figure(s)`);
    return { figuresFound };
  } catch (err) {
    await setDocState(db, documentId, "failed", String(err instanceof Error ? err.message : err));
    emit("failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

function buildIR(
  documentId: string,
  format: CanonicalIR["format"],
  title: string | null,
  language: string,
  parsedSections: ParsedSection[],
  hrefToAssetId: Map<string, string>
): CanonicalIR {
  const sections = parsedSections.map((s) => ({
    id: s.id,
    title: s.title,
    sourceHref: s.sourceHref,
    blocks: s.blocks.map((b) => mapBlock(b, hrefToAssetId)).filter((b): b is Block => b !== null),
  }));
  return { documentId, format, title, language, sections };
}

function mapBlock(b: SectionBlock, hrefToAssetId: Map<string, string>): Block | null {
  switch (b.kind) {
    case "heading":
      return b.text ? { kind: "heading", level: b.level, text: b.text } : null;
    case "paragraph":
      return b.text ? { kind: "paragraph", text: b.text } : null;
    case "list_item":
      return b.text ? { kind: "list_item", ordered: b.ordered, text: b.text } : null;
    case "figure": {
      const assetId = hrefToAssetId.get(b.assetHref);
      if (!assetId) return null;
      return { kind: "figure", assetId, alt: b.alt };
    }
  }
}

function countIRFigures(ir: CanonicalIR): number {
  return ir.sections.reduce(
    (acc, s) => acc + s.blocks.filter((b) => b.kind === "figure").length,
    0
  );
}

function spineIndexFor(sections: ParsedSection[], href: string): number {
  const idx = sections.findIndex((s) => s.sourceHref === href);
  return idx === -1 ? 0 : idx;
}

async function setDocState(
  db: LumenDb,
  id: string,
  state: "uploaded" | "parsing" | "ingested" | "failed",
  errorDetail?: string
) {
  await db
    .update(documents)
    .set({ state, errorDetail: errorDetail ?? null, updatedAt: new Date() })
    .where(eq(documents.id, id));
}

function publish(redis: Redis, event: ProgressEvent) {
  void redis.publish(`project:${event.projectId}:events`, JSON.stringify(event));
}

function extOf(href: string): string {
  const i = href.lastIndexOf(".");
  return i === -1 ? "" : href.slice(i).toLowerCase();
}

function basename(href: string): string {
  const i = href.lastIndexOf("/");
  return i === -1 ? href : href.slice(i + 1);
}

function resolveHref(href: string): string {
  return decodeURIComponent(href);
}

function imageSize(buffer: Buffer): { width: number; height: number } | null {
  try {
    const result = sizeOf(new Uint8Array(buffer));
    if (result && typeof result === "object" && "width" in result && "height" in result) {
      return { width: result.width, height: result.height };
    }
    return null;
  } catch {
    return null;
  }
}
