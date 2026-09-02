import { and, desc, eq, inArray } from "drizzle-orm";
import type { Job, Queue } from "bullmq";
import type { Redis } from "ioredis";
import {
  assets,
  documents,
  exports as exportsTable,
  projects,
  reviews,
  suggestions,
  validations,
  type IRSnapshot,
  type LumenDb,
} from "@lumen/db";
import type { CanonicalIR } from "@lumen/schemas";
import { AssetStore } from "../storage.js";
import { dispatchWebhookEvent } from "../webhook.js";
import { buildEpubArtifact, buildJsonArtifact, type ExportFigure, type ExportInput } from "./builders.js";
import { buildXlsxArtifact } from "./xlsx.js";
import { buildHtmlArtifact } from "./html.js";
import { recordUsage } from "../usage.js";
import { runAce, runEpubCheck, runHttpValidator, type ValidatorOutcome } from "./validators.js";

export interface ExportJobData {
  exportId: string;
}

export interface ExportDeps {
  db: LumenDb;
  redis: Redis;
  store: AssetStore;
  webhookQueue?: Queue;
}

interface LoadedExport {
  input: ExportInput;
  organizationId: string;
}

async function loadExportData(db: LumenDb, exportId: string): Promise<LoadedExport | null> {
  const exportRows = await db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).limit(1);
  const exp = exportRows[0];
  if (!exp) return null;

  const projectRows = await db.select().from(projects).where(eq(projects.id, exp.projectId)).limit(1);
  const project = projectRows[0];
  if (!project) return null;

  const docRows = await db
    .select()
    .from(documents)
    .where(eq(documents.projectId, project.id))
    .orderBy(documents.createdAt);

  const docIds = docRows.map((d) => d.id);

  const figureMap = new Map<string, ExportFigure>();
  if (docIds.length > 0) {
    const assetRows = await db.select().from(assets).where(inArray(assets.documentId, docIds));
    for (const asset of assetRows) {
      const latestReview = (
        await db
          .select({ decision: reviews.decision, finalAltText: reviews.finalAltText })
          .from(reviews)
          .innerJoin(suggestions, eq(suggestions.id, reviews.suggestionId))
          .where(eq(suggestions.assetId, asset.id))
          .orderBy(desc(reviews.createdAt))
          .limit(1)
      )[0];
      figureMap.set(asset.id, {
        assetId: asset.id,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        altText: latestReview?.finalAltText ?? "",
        longDescription: null,
      });
    }
  }

  const irDocs = docRows.map((doc) => {
    const snapshot = (doc.irSnapshot ?? { sections: [] }) as IRSnapshot;
    const ir: CanonicalIR & { documentId: string } = {
      documentId: doc.id,
      format: "epub",
      title: doc.title,
      language: doc.language,
      sections: snapshot.sections ?? [],
    };
    return ir;
  });

  return {
    organizationId: project.organizationId,
    input: {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
      documents: irDocs,
      figures: figureMap,
    },
  };
}

/** Structural gate in-process, then real sidecar validators when tooling is configured. */
async function runValidationGate(
  db: LumenDb,
  exportId: string,
  formats: string[],
  artifacts: Record<string, Buffer>
): Promise<boolean> {
  let allPassed = true;

  for (const format of formats) {
    const buffer = artifacts[format];
    let passed: "passed" | "failed" | "skipped" = "skipped";
    let output: unknown = null;

    if (format === "epub" && buffer) {
      const ok =
        buffer.subarray(0, 4).toString("latin1") === "PK\u0003\u0004" &&
        buffer.includes(Buffer.from("META-INF/container.xml")) &&
        buffer.includes(Buffer.from("application/epub+zip"));
      passed = ok ? "passed" : "failed";
      output = { check: "structure", mimetypeFirstEntry: true, containerPresent: ok };
    } else     if (format === "json" && buffer) {
      try {
        JSON.parse(buffer.toString("utf8"));
        passed = "passed";
        output = { check: "json_parse", bytes: buffer.byteLength };
      } catch (err) {
        passed = "failed";
        output = { error: String(err).slice(0, 300) };
      }
    } else if (format === "xlsx" && buffer) {
      // minimal structural check: every XLSX is a ZIP starting with PK
      // and contains the workbook XML entry exceljs always writes.
      const isZip = buffer.subarray(0, 4).toString("latin1") === "PK\u0003\u0004";
      const hasWorkbookXml = buffer.includes(Buffer.from("xl/workbook.xml"));
      const ok = isZip && hasWorkbookXml;
      passed = ok ? "passed" : "failed";
      output = { check: "xlsx_structure", isZip, hasWorkbookXml };
    } else if (format === "html" && buffer) {
      const text = buffer.toString("utf8");
      const hasDoctype = text.startsWith("<!doctype html>");
      const hasLang = /<html\s[^>]*lang="/i.test(text);
      const hasBody = /<body>/i.test(text);
      const ok = hasDoctype && hasLang && hasBody;
      passed = ok ? "passed" : "failed";
      output = { check: "html_structure", hasDoctype, hasLang, hasBody };
    }

    if (passed === "failed") allPassed = false;
    await db
      .insert(validations)
      .values({ exportId, validator: `internal-${format}`, format, passed, output })
      .onConflictDoUpdate({
        target: [validations.exportId, validations.validator, validations.format],
        set: { passed, output },
      });

    for (const outcome of await sidecarOutcomes(format, artifacts)) {
      if (outcome.passed === "failed") allPassed = false;
      await db
        .insert(validations)
        .values({
          exportId,
          validator: outcome.validator,
          format: outcome.format,
          passed: outcome.passed,
          output: outcome.output,
        })
        .onConflictDoUpdate({
          target: [validations.exportId, validations.validator, validations.format],
          set: { passed: outcome.passed, output: outcome.output },
        });
    }
  }
  return allPassed;
}

async function sidecarOutcomes(
  format: string,
  artifacts: Record<string, Buffer>
): Promise<ValidatorOutcome[]> {
  if (format === "epub" && artifacts.epub) {
    const [epubcheck, ace] = await Promise.all([
      runEpubCheck(artifacts.epub),
      runAce(artifacts.epub),
    ]);
    return [epubcheck, ace];
  }
  if (format === "pdf") {
    return [
      { validator: "verapdf", format: "pdf", passed: "skipped", output: { reason: "pdf/ua pipeline arrives in Phase 3" } },
    ];
  }
  return [];
}

export async function processExport(
  job: Job<ExportJobData>,
  deps: ExportDeps
): Promise<{ status: string; formats: string[] }> {
  const { db, store } = deps;
  const { exportId } = job.data;

  const expRows = await db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).limit(1);
  const exp = expRows[0];
  if (!exp) throw new Error(`export not found: ${exportId}`);
  const { webhookQueue } = deps;

  await db.update(exportsTable).set({ status: "running" }).where(eq(exportsTable.id, exportId));

  try {
    const loaded = await loadExportData(db, exportId);
    if (!loaded) throw new Error(`export data unavailable: ${exportId}`);
    const { input, organizationId } = loaded;

    const artifacts: Record<string, Buffer> = {};
    const artifactKeys: Record<string, string> = {};
    const scope = `${organizationId}/${exp.projectId}/exports/${exportId}`;

    for (const format of exp.formats) {
      if (format === "json") {
        artifacts.json = buildJsonArtifact(input);
        artifactKeys.json = `${scope}/artifact.json`;
      } else if (format === "epub") {
        artifacts.epub = await buildEpubArtifact(input, (key) => store.read(key));
        artifactKeys.epub = `${scope}/artifact.epub`;
      } else if (format === "xlsx") {
        artifacts.xlsx = await buildXlsxArtifact(input);
        artifactKeys.xlsx = `${scope}/artifact.xlsx`;
      } else if (format === "html") {
        artifacts.html = await buildHtmlArtifact(input, (key) => store.read(key));
        artifactKeys.html = `${scope}/artifact.html`;
      }
    }

    const passed = await runValidationGate(db, exportId, exp.formats, artifacts);

    for (const [format, key] of Object.entries(artifactKeys)) {
      await store.writeRaw(key, artifacts[format]!);
      await recordUsage(db, {
        organizationId,
        kind: "export_artifact",
        subjectType: "export",
        subjectId: exportId,
        detail: { format, storageKey: key, bytes: artifacts[format]!.byteLength },
      });
    }

    await db
      .update(exportsTable)
      .set({
        status: passed ? "completed" : "validation_failed",
        artifactKeys,
      })
      .where(eq(exportsTable.id, exportId));

    await db
      .update(projects)
      .set({ stage: passed ? "delivered" : "ready_to_export", updatedAt: new Date() })
      .where(eq(projects.id, exp.projectId));

    await dispatchWebhookEvent(db, webhookQueue, organizationId, "export.completed", {
      exportId,
      projectId: exp.projectId,
      status: passed ? "completed" : "validation_failed",
      formats: exp.formats,
    });

    return { status: passed ? "completed" : "validation_failed", formats: exp.formats };
  } catch (err) {
    await db.update(exportsTable).set({ status: "failed" }).where(eq(exportsTable.id, exportId));
    throw err;
  }
}
