import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { DescribeRequest } from "./types.js";

function req(overrides: Partial<DescribeRequest> = {}): DescribeRequest {
  return {
    image: { bytes: Buffer.from("fake-png"), mimeType: "image/png" },
    context: { language: "en" },
    styleGuide: { maxAltChars: 125, includeLongDescription: true },
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("defaults to english and 125 chars when no style/context", () => {
    const p = buildSystemPrompt({ image: req().image });
    expect(p).toContain("alt_text <= 125 chars");
    expect(p).toContain("Language: write all human-readable output");
    expect(p).toContain("(en)");
  });

  it("honours non-english languages from context", () => {
    const p = buildSystemPrompt(req({ context: { language: "es" } }));
    expect(p).toContain("Spanish (es)");
  });

  it("honours maxAltChars from the style guide", () => {
    const p = buildSystemPrompt(req({ styleGuide: { maxAltChars: 80 } }));
    expect(p).toContain("alt_text <= 80 chars");
  });

  it("forces long_description null when disabled", () => {
    const p = buildSystemPrompt(
      req({ styleGuide: { includeLongDescription: false } })
    );
    expect(p).toContain("Set long_description to null.");
  });

  it("mentions all supported launch languages", () => {
    for (const [code, name] of [
      ["en", "English"],
      ["es", "Spanish"],
      ["fr", "French"],
      ["de", "German"],
      ["hi", "Hindi"],
    ] as const) {
      const p = buildSystemPrompt(req({ context: { language: code } }));
      expect(p).toContain(`${name} (${code})`);
    }
  });
});

describe("buildUserPrompt", () => {
  it("includes document + section context when present", () => {
    const p = buildUserPrompt(
      req({
        context: {
          documentTitle: "My Book",
          sectionTitle: "Ch 2",
          surroundingText: "See Figure 1 for details.",
        },
      })
    );
    expect(p).toContain("Document title: My Book");
    expect(p).toContain("Section heading: Ch 2");
    expect(p).toContain("Surrounding text: See Figure 1 for details.");
  });

  it("truncates surrounding text to 600 chars", () => {
    const p = buildUserPrompt(
      req({ context: { surroundingText: "x".repeat(900) } })
    );
    // "Surrounding text: " prefix + up to 600 chars
    expect(p).toContain("Surrounding text: " + "x".repeat(600));
    expect(p).not.toContain("Surrounding text: " + "x".repeat(601));
  });

  it("falls back gracefully with no context", () => {
    const p = buildUserPrompt(req({ context: {} }));
    expect(p).toContain("(no textual context available)");
  });
});