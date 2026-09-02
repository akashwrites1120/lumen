import { describe, it, expect } from "vitest";
import type { CanonicalIR } from "@lumen/schemas";
import { buildHtmlArtifact, type ExportFigure, type ExportInput } from "../src/export/html.js";

const docId = "11111111-1111-4111-8111-111111111111";
const fig1 = "22222222-2222-4222-8222-222222222222";
const fig2 = "33333333-3333-4333-8333-333333333333";

const ir: CanonicalIR & { documentId: string } = {
  documentId: docId,
  format: "epub",
  title: "Demo",
  language: "en",
  sections: [
    {
      id: "sec-1",
      title: "Intro",
      sourceHref: "OEBPS/ch1.xhtml",
      blocks: [
        { kind: "heading", level: 1, text: "Intro" },
        { kind: "paragraph", text: "First paragraph." },
        { kind: "figure", assetId: fig1, alt: null },
        { kind: "table", rows: [["A", "B"], ["1", "2"]] },
      ],
    },
    {
      id: "sec-2",
      title: "More",
      sourceHref: "OEBPS/ch2.xhtml",
      blocks: [
        { kind: "heading", level: 1, text: "More" },
        { kind: "figure", assetId: fig2, alt: "diagram" },
      ],
    },
  ],
};

const figures = new Map<string, ExportFigure>([
  [fig1, { assetId: fig1, storageKey: "k1", mimeType: "image/png", altText: "Sunset photo", longDescription: null }],
  [fig2, { assetId: fig2, storageKey: "k2", mimeType: "image/jpeg", altText: "Bar chart", longDescription: "Quarterly values." }],
]);

function makeReadAsset(): (key: string) => Promise<Buffer> {
  return async (key: string) => {
    if (key === "k1") return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (key === "k2") return Buffer.from([0xff, 0xd8, 0xff]);
    throw new Error(`unknown asset: ${key}`);
  };
}

const input: ExportInput = {
  project: { id: "p1", name: "Demo Project", description: "For QA" },
  documents: [ir],
  figures,
};

describe("html export", () => {
  it("inlines images as data URIs and uses approved alt text", async () => {
    const buf = await buildHtmlArtifact(input, makeReadAsset());
    const text = buf.toString("utf8");

    expect(text).toMatch(/^<!doctype html>/i);
    expect(text).toContain('<html lang="en">');
    expect(text).toContain("Demo Project");

    expect(text).toContain("data:image/png;base64,");
    expect(text).toContain("data:image/jpeg;base64,");
    expect(text).toContain('alt="Sunset photo"');
    expect(text).toContain('alt="Bar chart"');
    expect(text).toContain("Quarterly values.");
  });

  it("emits a TOC with one anchor per section", async () => {
    const buf = await buildHtmlArtifact(input, makeReadAsset());
    const text = buf.toString("utf8");
    expect(text).toContain('aria-label="Table of contents"');
    expect(text).toContain('href="#sec-sec-1"');
    expect(text).toContain('href="#sec-sec-2"');
  });

  it("falls back to block.alt when no figure record is present", async () => {
    const fallbackInput: ExportInput = {
      project: { id: "p1", name: "Demo", description: null },
      documents: [{
        documentId: docId,
        format: "epub",
        title: null,
        language: "en",
        sections: [{
          id: "s-only",
          title: "Only",
          sourceHref: "x",
          blocks: [{ kind: "figure", assetId: fig1, alt: "draft alt from IR" }],
        }],
      }],
      figures: new Map(), // no approved figure record
    };
    const buf = await buildHtmlArtifact(fallbackInput, makeReadAsset());
    const text = buf.toString("utf8");
    expect(text).toContain("figure 22222222-2222-4222-8222-222222222222 missing from approved set");
  });
});
