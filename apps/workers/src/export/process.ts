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
import { notify } from "@lumen/notify";
import type { EmailTransport } from "@lumen/notify";
import { runAce, runEpubCheck, runHttpValidator, type ValidatorOutcome } from "./validators.js";
import { isPlausibleAzw3, runAzw3Conversion, type Azw3ConversionResult } from "./azw3.js";

export interface ExportJobData {
  exportId: string;
}

export interface ExportDeps {
  db: LumenDb;
  redis: Redis;
  store: AssetStore;
  webhookQueue?: Queue;
  /** Null when SMTP is unconfigured — email leg skipped, in-app rows still written. */
  emailTransport?: EmailTransport | null;
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
  artifacts: Record<string, Buffer>,
  azw3: Azw3ConversionResult | null
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
    } else if (format === "azw3") {
      // Kindle output: structural gate on the produced bytes plus a
      // provenance row recording which tool produced them.
      if (azw3?.ok && buffer && isPlausibleAzw3(buffer)) {
        passed = "passed";
        output = {
          check: "azw3_structure",
          bookmobiMagic: true,
          tool: azw3.tool,
          bytes: buffer.byteLength,
        };
      } else {
        // A requested format that couldn't be produced is a hard gate
        // failure — the export must not be marked completed.
        passed = "failed";
        output = {
          reason:
            azw3 && !azw3.ok
              ? azw3.reason
              : "produced bytes are not a valid AZW3 container",
        };
      }
    }

    if (passed === "failed") allPassed = false;
    await db
      .insert(validations)
      .values({ exportId, validator: `internal-${format}`, format, passed, output })
      .onConflictDoUpdate({
        target: [validations.exportId, validations.validator, validations.format],
        set: { passed, output },
      });

    // Record which tool produced a converted artifact (provenance for the
    // compliance report), kept separate from the structural gate row.
    if (format === "azw3" && azw3?.ok) {
      await db
        .insert(validations)
        .values({
          exportId,
          validator: "azw3-conversion",
          format: "azw3",
          passed: "passed",
          output: { tool: azw3.tool, bytes: azw3.bytes.byteLength },
        })
        .onConflictDoUpdate({
          target: [validations.exportId, validations.validator, validations.format],
          set: { passed: "passed", output: { tool: azw3.tool, bytes: azw3.bytes.byteLength } },
        });
    }

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
  let orgIdForNotify: string | null = null;

  await db.update(exportsTable).set({ status: "running" }).where(eq(exportsTable.id, exportId));

  try {
    const loaded = await loadExportData(db, exportId);
    if (!loaded) throw new Error(`export data unavailable: ${exportId}`);
    const { input, organizationId } = loaded;
    orgIdForNotify = organizationId;

    const artifacts: Record<string, Buffer> = {};
    const artifactKeys: Record<string, string> = {};
    const scope = `${organizationId}/${exp.projectId}/exports/${exportId}`;
    let azw3Result: Azw3ConversionResult | null = null;

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
      } else if (format === "azw3") {
        // Kindle output converts from the EPUB; build it on the fly when
        // the caller only asked for azw3 (it is not persisted unless the
        // caller explicitly requested the epub format too).
        if (!artifacts.epub) {
          artifacts.epub = await buildEpubArtifact(input, (key) => store.read(key));
        }
        const conversion = await runAzw3Conversion(artifacts.epub);
        azw3Result = conversion;
        if (conversion.ok) {
          artifacts.azw3 = conversion.bytes;
          artifactKeys.azw3 = `${scope}/artifact.azw3`;
        }
      }
    }

    const passed = await runValidationGate(db, exportId, exp.formats, artifacts, azw3Result);

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

    // In-app notification (source of truth) + best-effort email. The kind
    // distinguishes a clean build from a validator-gate failure.
    await notify(
      db,
      {
        organizationId,
        kind: passed ? "export.completed" : "validator.failed",
        title: passed
          ? `Export ready: ${input.project.name}`
          : `Validation failed: ${input.project.name}`,
        body: passed
          ? `${exp.formats.join(", ").toUpperCase()} passed the export gate and are ready to download.`
          : `The export gate failed for ${exp.formats.join(", ").toUpperCase()}. See the export panel for validator output.`,
        subjectType: "export",
        subjectId: exportId,
      },
      deps.emailTransport
    );

    return { status: passed ? "completed" : "validation_failed", formats: exp.formats };
  } catch (err) {
    await db.update(exportsTable).set({ status: "failed" }).where(eq(exportsTable.id, exportId));
    if (orgIdForNotify) {
      // The job itself failed (not a validator outcome) — still tell the org.
      try {
        await notify(
          db,
          {
            organizationId: orgIdForNotify,
            kind: "export.failed",
            title: "Export failed",
            body: `The export job for project ${exp.projectId} failed with an unexpected error. It can be re-requested from the dashboard.`,
            subjectType: "export",
            subjectId: exportId,
          },
          deps.emailTransport
        );
      } catch (notifyErr) {
        console.warn("[export] failure notification error:", notifyErr);
      }
    }
    throw err;
  }
}
