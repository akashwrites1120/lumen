import { describe, expect, it } from "vitest";
import {
  buildVpatMarkdown,
  reportSigningKey,
  signReport,
} from "../src/lib/compliance.js";

describe("signReport", () => {
  it("returns an HMAC-SHA256 signature with a key id", () => {
    const sig = signReport({ project: { id: "p1" } }, "secret-key");
    expect(sig.algorithm).toBe("hmac-sha256");
    expect(sig.value).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.keyId).toMatch(/^[0-9a-f]{8}$/);
    expect(sig.signedAt).toBeDefined();
  });

  it("changes when the payload changes", () => {
    const a = signReport({ project: { id: "p1" } }, "secret-key");
    const b = signReport({ project: { id: "p2" } }, "secret-key");
    expect(a.value).not.toBe(b.value);
  });

  it("changes when the key changes", () => {
    const a = signReport({ project: { id: "p1" } }, "secret-key-a");
    const b = signReport({ project: { id: "p1" } }, "secret-key-b");
    expect(a.value).not.toBe(b.value);
    expect(a.keyId).not.toBe(b.keyId);
  });

  it("reportSigningKey reads env with a documented dev default", () => {
    expect(reportSigningKey({ REPORT_SIGNING_KEY: "custom" })).toBe("custom");
    expect(reportSigningKey({})).toBe("lumen-dev-report-key");
  });
});

describe("buildVpatMarkdown", () => {
  const base = {
    project: { name: "Fall 2026 Backlist" },
    export: {
      id: "e1",
      formats: ["epub", "json"],
      status: "completed",
      createdAt: new Date("2026-09-03T00:00:00Z"),
    },
    generatedAt: new Date("2026-09-03T01:00:00Z"),
    review: { total: 12, approved: 8, edited: 3, rejected: 1, decorative: 0 },
    standards: ["WCAG 2.1 AA"],
  };

  it("renders a full markdown document", () => {
    const md = buildVpatMarkdown({
      ...base,
      validators: [
        { validator: "internal-epub", format: "epub", passed: "passed" },
        { validator: "epubcheck", format: "epub", passed: "passed" },
      ],
    });
    expect(md).toContain("# Voluntary Product Accessibility Template (VPAT)");
    expect(md).toContain("Fall 2026 Backlist");
    expect(md).toContain("| epub |");
    expect(md).toContain("| 12 |");
    expect(md).toContain("WCAG 2.1");
    // All-passing validators → supports
    expect(md).toContain("**Supports**");
  });

  it("flags validator failures as partially supporting", () => {
    const md = buildVpatMarkdown({
      ...base,
      validators: [
        { validator: "internal-epub", format: "epub", passed: "passed" },
        { validator: "epubcheck", format: "epub", passed: "failed" },
      ],
    });
    expect(md).toContain("**Partially Supports**");
  });

  it("reports not-evaluated when no validators ran", () => {
    const md = buildVpatMarkdown({ ...base, validators: [] });
    expect(md).toContain("**Not Evaluated**");
    expect(md).toContain("_No validator outcomes recorded for this export._");
  });

  it("mentions skipped validators in the notes", () => {
    const md = buildVpatMarkdown({
      ...base,
      validators: [
        { validator: "internal-epub", format: "epub", passed: "passed" },
        { validator: "ace", format: "epub", passed: "skipped" },
      ],
    });
    expect(md).toContain("1 validator(s) were skipped");
  });
});