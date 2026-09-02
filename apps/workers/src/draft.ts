import { desc, eq } from "drizzle-orm";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import {
  assets,
  auditEvents,
  documents,
  projects,
  suggestions,
  type IRSnapshot,
  type LumenDb,
} from "@lumen/db";
import { DraftEvent, type Block, type DraftStage } from "@lumen/schemas";
import {
  describeWithFailover,
  resolveVisionProviders,
  type AltTextDraft,
  type DescribeRequest,
  type VisionProvider,
} from "@lumen/providers";
import type { AssetStore } from "./storage.js";
import { recordUsage } from "./usage.js";
import { readVisionCache, visionCacheKey, visionCacheTtlFromEnv, writeVisionCache } from "./vision-cache.js";

export interface DraftJobData {
  assetId: string;
}

export interface DraftDeps {
  db: LumenDb;
  redis: Redis;
  store: AssetStore;
  providers?: VisionProvider[];
  maxAltChars?: number;
  /** Vision result cache TTL in seconds; 0 disables. Defaults from env. */
  cacheTtlSec?: number;
}

export interface DraftResult {
  altText: string;
  confidence: number;
  imageClass: string | null;
  lane: "high" | "medium" | "low" | "decorative";
  provider: string;
}

/** Confidence routing lanes per PRD: ≥85 auto-approvable, ≥60 normal review, <60 flagged. */
export function laneFor(confidence: number, imageClass: string | null): DraftResult["lane"] {
  if (imageClass === "decorative") return "decorative";
  if (confidence >= 85) return "high";
  if (confidence >= 60) return "medium";
  return "low";
}

export async function processDraft(
  job: Job<DraftJobData>,
  deps: DraftDeps
): Promise<DraftResult> {
  const { db, redis, store } = deps;
  const { assetId } = job.data;
  const providers = deps.providers ?? resolveVisionProviders(process.env);

  const rows = await db
    .select({ asset: assets, doc: documents })
    .from(assets)
    .innerJoin(documents, eq(documents.id, assets.documentId))
    .where(eq(assets.id, assetId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`asset not found: ${assetId}`);
  const { asset, doc } = row;

  const projectRows = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, doc.projectId))
    .limit(1);
  const orgId = projectRows[0]?.organizationId;
  if (!orgId) throw new Error(`project not found for document: ${doc.projectId}`);

  const emit = (stage: DraftStage, message?: string) => {
    const event = DraftEvent.parse({
      type: "asset.progress",
      assetId,
      documentId: doc.id,
      projectId: doc.projectId,
      stage,
      message,
      at: new Date().toISOString(),
    });
    void redis.publish(`project:${doc.projectId}:events`, JSON.stringify(event));
  };

  try {
    emit("queued", `Drafting ${asset.sourceHref?.split("/").pop() ?? asset.id}`);

    const bytes = await store.read(asset.storageKey);
    if (bytes.byteLength === 0) throw new Error("empty asset bytes");

    const context = buildContext(doc.irSnapshot ?? { sections: [] }, asset.id);
    emit("classifying", context.sectionTitle ? `Context: ${context.sectionTitle}` : undefined);

    const request: DescribeRequest = {
      image: { bytes, mimeType: asset.mimeType },
      context: {
        documentTitle: doc.title,
        sectionTitle: context.sectionTitle,
        surroundingText: context.surroundingText,
        language: doc.language,
      },
      styleGuide: { maxAltChars: deps.maxAltChars ?? 125 },
    };

    emit("describing", `Asking ${providers.filter((p) => p.isConfigured()).map((p) => p.name).join(" → ")}`);

    // Cost control: identical image (checksum) + identical context reuses
    // the previous draft instead of paying for another vision call.
    const cacheTtl = deps.cacheTtlSec ?? visionCacheTtlFromEnv();
    const cacheKey = visionCacheKey({
      checksumSha256: asset.checksumSha256,
      mimeType: asset.mimeType,
      context: request.context,
      styleGuide: request.styleGuide,
    });

    let result: AltTextDraft;
    let fromCache = false;
    const cached = cacheTtl > 0 ? await readVisionCache(redis, cacheKey) : null;
    if (cached) {
      result = cached.draft;
      fromCache = true;
      emit("describing", `Cache hit (${cached.provider}) — no vision call needed`);
    } else {
      const { result: fresh } = await describeWithFailover(providers, request);
      result = fresh;
      await writeVisionCache(redis, cacheKey, {
        draft: result,
        provider: result.provider,
        model: result.model,
        cachedAt: new Date().toISOString(),
      }, cacheTtl);
    }
    const lane = laneFor(result.confidence, result.imageClass);

    await recordUsage(db, {
      organizationId: orgId,
      kind: "vision_call",
      // A cache hit is not a billable vision call — record zero units so
      // the ledger keeps the event for visibility without charging it.
      units: fromCache ? 0 : 1,
      subjectType: "asset",
      subjectId: asset.id,
      detail: {
        provider: result.provider,
        model: result.model,
        confidence: result.confidence,
        cached: fromCache,
      },
    });

    emit("drafted", `${result.provider}${fromCache ? " (cache)" : ""} · ${result.confidence}% · ${lane} lane`);

    const prior = await db
      .select({ revision: suggestions.revision })
      .from(suggestions)
      .where(eq(suggestions.assetId, asset.id))
      .orderBy(desc(suggestions.revision))
      .limit(1);
    const nextRevision = (prior[0]?.revision ?? 0) + 1;

    await db.transaction(async (tx) => {
      await tx.insert(suggestions).values({
        assetId: asset.id,
        revision: nextRevision,
        provider: `${result.provider}:${result.model}`,
        altText: result.altText,
        longDescription: result.longDescription,
        confidence: result.confidence,
        payload: { lane },
      });
      await tx
        .update(assets)
        .set({ state: "ai_drafted", imageClass: result.imageClass })
        .where(eq(assets.id, asset.id));
    });

    await db.insert(auditEvents).values({
      organizationId: orgId,
      action: "suggestion.drafted",
      subjectType: "asset",
      subjectId: asset.id,
      detail: { provider: result.provider, model: result.model, confidence: result.confidence, lane, cached: fromCache },
    });

    job.log(`drafted via ${result.provider}/${result.model}${fromCache ? " (cache)" : ""}, lane=${lane}`);
    return {
      altText: result.altText,
      confidence: result.confidence,
      imageClass: result.imageClass,
      lane,
      provider: result.provider,
    };
  } catch (err) {
    emit("failed", err instanceof Error ? err.message.slice(0, 160) : String(err));
    await db.insert(auditEvents).values({
      organizationId: orgId,
      action: "suggestion.draft_failed",
      subjectType: "asset",
      subjectId: assetId,
      detail: { error: String(err instanceof Error ? err.message : err).slice(0, 500) },
    });
    throw err;
  }
}

function buildContext(ir: IRSnapshot, assetId: string): {
  sectionTitle: string | null;
  surroundingText: string | null;
} {
  for (const section of ir.sections) {
    const idx = section.blocks.findIndex(
      (b: Block) => b.kind === "figure" && b.assetId === assetId
    );
    if (idx === -1) continue;

    const before = section.blocks[idx - 1];
    const after = section.blocks[idx + 1];
    const texts = [before, after]
      .map((b) => (b && b.kind !== "figure" && "text" in b ? b.text : null))
      .filter((t): t is string => Boolean(t));

    return {
      sectionTitle: section.title || null,
      surroundingText: texts.length > 0 ? texts.join("\n\n") : null,
    };
  }
  return { sectionTitle: null, surroundingText: null };
}
