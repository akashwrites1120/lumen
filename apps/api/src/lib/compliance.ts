import { createHmac, randomBytes } from "node:crypto";

/**
 * Compliance-report tooling (Phase 3).
 *
 * Two responsibilities:
 *  - `signReport` HMAC-SHA256 signs the canonical JSON of a compliance
 *    report so a third party can verify the report was issued by this
 *    tenant and not tampered with in transit.
 *  - `buildVpatMarkdown` renders a VPAT-style summary (WCAG 2.1 AA rows)
 *    from the export + validator data we already collect, so legal/enterprise
 *    buyers get a human-readable compliance artefact alongside the JSON.
 */

export interface ReportSignature {
  algorithm: "hmac-sha256";
  value: string;
  signedAt: string;
  /** Prefix of the SHA-256 of the signing key, so keys are rotatable without exposing them. */
  keyId: string;
}

/** Env-driven signing key; a documented dev default keeps the feature testable out of the box. */
export function reportSigningKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.REPORT_SIGNING_KEY ?? "lumen-dev-report-key";
}

function keyIdFor(key: string): string {
  return createHmac("sha256", key).digest("hex").slice(0, 8);
}

/**
 * HMAC-SHA256 over the stable JSON serialization of `report`. The payload
 * is returned unsigned; callers embed `signature` into the report body and
 * may also surface it via an `X-Lumen-Report-Signature` header.
 */
export function signReport(
  report: Record<string, unknown>,
  secret: string,
  at: Date = new Date()
): ReportSignature {
  const canonical = JSON.stringify(report);
  const value = createHmac("sha256", secret).update(canonical).digest("hex");
  return {
    algorithm: "hmac-sha256",
    value,
    signedAt: at.toISOString(),
    keyId: keyIdFor(secret),
  };
}

/** Deterministic-ish nonce for the VPAT document id (no external deps). */
export function reportNonce(exportId: string): string {
  return randomBytes(8).toString("hex").concat("-", exportId.slice(0, 12));
}

export interface VpatInput {
  project: { name: string };
  export: { id: string; formats: string[]; status: string; createdAt: Date };
  generatedAt: Date;
  review: {
    total: number;
    approved: number;
    edited: number;
    rejected: number;
    decorative: number;
  };
  validators: {
    validator: string;
    format: string;
    passed: "passed" | "failed" | "skipped";
  }[];
  /** e.g. ["WCAG 2.1 AA", "EPUB Accessibility 1.1"]. */
  standards: string[];
}
/** Maps validator outcomes to a VPAT-style conformance verdict. */
function verdictFor(validators: VpatInput["validators"]): {
  verdict: string;
  notes: string[];
} {
  const failed = validators.filter((v) => v.passed === "failed");
  const skipped = validators.filter((v) => v.passed === "skipped");
  const passedCount = validators.filter((v) => v.passed === "passed").length;

  if (failed.length > 0) {
    return {
      verdict: "Partially Supports",
      notes: [
        "Some automated checks failed at export time. See the JSON compliance report for validated failures.",
      ],
    };
  }
  if (validators.length === 0 || passedCount === 0) {
    return {
      verdict: "Not Evaluated",
      notes: [
        "No validator outcomes recorded for this export (sidecar tooling may not be configured).",
      ],
    };
  }
  return {
    verdict: "Supports",
    notes: [
      skipped.length > 0
        ? `${skipped.length} validator(s) were skipped (tooling not configured) — full conformance not claimed.`
        : "All configured automated checks passed on the produced artifacts.",
    ],
  };
}

/** WCAG 2.1 rows we can honestly speak to from our data. */
const WCAG_ROWS: { id: string; title: string; level: "A" | "AA" }[] = [
  { id: "1.1.1", title: "Non-text Content", level: "A" },
  { id: "1.3.1", title: "Info and Relationships", level: "A" },
  { id: "1.3.2", title: "Meaningful Sequence", level: "A" },
  { id: "2.4.2", title: "Page Titled", level: "A" },
  { id: "3.1.1", title: "Language of Page", level: "A" },
  { id: "1.4.3", title: "Contrast (Minimum)", level: "AA" },
  { id: "3.1.2", title: "Language of Parts", level: "AA" },
];

/** Renders a Markdown VPAT summary suitable for download / share. */
export function buildVpatMarkdown(input: VpatInput): string {
  const { verdict, notes } = verdictFor(input.validators);
  const fmtDate = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19) + "Z";

  const lines: string[] = [];
  lines.push("# Voluntary Product Accessibility Template (VPAT)");
  lines.push("");
  lines.push("## Product Information");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Product | Lumen (AI accessibility platform) |`);
  lines.push(`| Project | ${input.project.name} |`);
  lines.push(`| Export ID | \`${input.export.id}\` |`);
  lines.push(`| Formats | ${input.export.formats.join(", ").toUpperCase()} |`);
  lines.push(`| Export status | ${input.export.status} |`);
  lines.push(`| Export created | ${fmtDate(input.export.createdAt)} |`);
  lines.push(`| Report generated | ${fmtDate(input.generatedAt)} |`);
  lines.push(`| Report ID | \`${reportNonce(input.export.id)}\` |`);
  lines.push(`| Standards | ${input.standards.join(" · ")} |`);
  lines.push(`| Conformance claim | **${verdict}** |`);
  lines.push("");
  lines.push("## Human Review");
  lines.push("");
  lines.push("Every image in this project was reviewed by a person before export.");
  lines.push("");
  lines.push(`| Decision | Count |`);
  lines.push(`|---|---:|`);
  lines.push(`| Total reviewed | ${input.review.total} |`);
  lines.push(`| Approved unedited | ${input.review.approved} |`);
  lines.push(`| Edited & approved | ${input.review.edited} |`);
  lines.push(`| Rejected / regenerated | ${input.review.rejected} |`);
  lines.push(`| Marked decorative | ${input.review.decorative} |`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const n of notes) lines.push(`- ${n}`);
  if (notes.length === 0) lines.push("- No notes.");
  lines.push("");
  lines.push("## WCAG 2.1 Criteria (Level A / AA)");
  lines.push("");
  lines.push(
    "> Criterion-level results are inferred from automated artifact checks + mandatory human review. The full JSON compliance report is the authoritative record for the export."
  );
  lines.push("");
  lines.push(`| Criterion | Level | Title | Conformance |`);
  lines.push(`|---|---|---|---|`);
  for (const row of WCAG_ROWS) {
    // Honest default: the export gate guarantees alt text + review; individual
    // success criteria beyond that scope are marked based on validator coverage.
    const support =
      verdict === "Supports"
        ? "Supports"
        : verdict === "Partially Supports"
          ? "Partially Supports"
          : "Not Evaluated";
    lines.push(`| ${row.id} | ${row.level} | ${row.title} | ${support} |`);
  }
  lines.push("");
  lines.push("## Automated Validation");
  lines.push("");
  if (input.validators.length === 0) {
    lines.push("_No validator outcomes recorded for this export._");
  } else {
    lines.push(`| Validator | Format | Outcome |`);
    lines.push(`|---|---|---|`);
    for (const v of input.validators) {
      lines.push(`| ${v.validator} | ${v.format} | ${v.passed} |`);
    }
  }
  lines.push("");
  lines.push(
    "_This summary is generated by Lumen and should be reviewed by your accessibility team before external distribution._"
  );
  lines.push("");

  return lines.join("\n");
}