import { describe, expect, it } from "vitest";
import { Block, ProgressEvent, countFigures } from "./index.js";
import type { CanonicalIR } from "./index.js";

describe("Block", () => {
  it("parses a figure block", () => {
    const parsed = Block.parse({
      kind: "figure",
      assetId: "0b8f6c1e-1c2d-4a3b-9f0e-2d3c4b5a6f7e",
      alt: null,
    });
    expect(parsed.kind).toBe("figure");
  });

  it("rejects an invalid heading level", () => {
    expect(() =>
      Block.parse({ kind: "heading", level: 9, text: "x" })
    ).toThrow();
  });
});

describe("ProgressEvent", () => {
  it("applies defaults", () => {
    const ev = ProgressEvent.parse({
      type: "document.progress",
      documentId: "0b8f6c1e-1c2d-4a3b-9f0e-2d3c4b5a6f7e",
      projectId: "0b8f6c1e-1c2d-4a3b-9f0e-2d3c4b5a6f7e",
      stage: "parsing",
      at: new Date().toISOString(),
    });
    expect(ev.figuresFound).toBe(0);
  });
});

describe("countFigures", () => {
  it("counts figure blocks across sections", () => {
    const ir = {
      documentId: "d",
      format: "epub",
      title: null,
      language: "en",
      sections: [
        {
          id: "s1",
          title: "One",
          sourceHref: "c1.xhtml",
          blocks: [
            { kind: "paragraph", text: "hi" },
            {
              kind: "figure",
              assetId: "0b8f6c1e-1c2d-4a3b-9f0e-2d3c4b5a6f7e",
              alt: null,
            },
          ],
        },
        {
          id: "s2",
          title: "Two",
          sourceHref: "c2.xhtml",
          blocks: [
            { kind: "heading", level: 2, text: "Two" },
            {
              kind: "figure",
              assetId: "0b8f6c1e-1c2d-4a3b-9f0e-2d3c4b5a6f7f",
              alt: null,
            },
            {
              kind: "figure",
              assetId: "0b8f6c1e-1c2d-4a3b-9f0e-2d3c4b5a6f70",
              alt: null,
            },
          ],
        },
      ],
    } as unknown as CanonicalIR;
    expect(countFigures(ir)).toBe(3);
  });
});
