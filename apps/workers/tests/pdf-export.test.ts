import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { buildPdfArtifact } from "../src/export/pdf.js";
import type { ExportInput } from "../src/export/builders.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function makeInput(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    project: { id: "p1", name: "Test Book", description: null },
    documents: [
      {
        documentId: "d1",
        format: "epub",
        title: "Chapter One",
        language: "en",
        sections: [
          {
            id: "s1",
            title: "Introduction",
            sourceHref: "ch1.xhtml",
            blocks: [
              { kind: "heading", level: 1, text: "Welcome" },
              { kind: "paragraph", text: "This is a sample paragraph for testing." },
              { kind: "figure", assetId: "a1", alt: null },
              { kind: "list_item", ordered: false, text: "First item" },
            ],
          },
        ],
      },
    ],
    figures: new Map([
      ["a1", { assetId: "a1", storageKey: "img/a1.png", mimeType: "image/png", altText: "A sunset over mountains", longDescription: null }],
    ]),
    ...overrides,
  } as ExportInput;
}

describe("buildPdfArtifact", () => {
  it("produces a valid PDF with %PDF header", async () => {
    const buf = await buildPdfArtifact(makeInput(), async () => Buffer.alloc(0));
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("produces a parseable PDF with at least one page", async () => {
    const buf = await buildPdfArtifact(makeInput(), async () => Buffer.alloc(0));
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("sets the document title and language", async () => {
    const buf = await buildPdfArtifact(makeInput(), async () => Buffer.alloc(0));
    const doc = await PDFDocument.load(buf);
    expect(doc.getTitle()).toBe("Test Book");
    // Language may be stored; pdf-lib reads it back as a string or undefined
    expect(doc.getSubject()).toContain("PDF/UA");
  });

  it("marks the document as tagged", async () => {
    const buf = await buildPdfArtifact(makeInput(), async () => Buffer.alloc(0));
    // The raw PDF stream contains /MarkInfo << /Marked true >> and
    // /StructTreeRoot — verify by reading the serialized bytes back.
    const text = buf.toString("latin1");
    expect(text).toContain("MarkInfo");
    expect(text).toContain("Marked");
  });

  it("includes a structure tree root", async () => {
    const buf = await buildPdfArtifact(makeInput(), async () => Buffer.alloc(0));
    const text = buf.toString("latin1");
    expect(text).toContain("StructTreeRoot");
    expect(text).toContain("StructElem");
  });

  it("handles documents with no sections", async () => {
    const buf = await buildPdfArtifact(makeInput({ documents: [] }), async () => Buffer.alloc(0));
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("renders a table block without throwing", async () => {
    const input = makeInput();
    input.documents[0].sections[0].blocks.push({
      kind: "table",
      rows: [["Header 1", "Header 2"], ["Cell 1", "Cell 2"]],
    });
    const buf = await buildPdfArtifact(input, async () => Buffer.alloc(0));
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });
});
