import { createRequire } from "node:module";
import { extractSection, type ParsedDocument, type ParsedImageRef } from "./epub-parser.js";

// subpath import skips pdf-parse's debug entrypoint (fires when module.parent is unset)
const requireCjs = createRequire(import.meta.url);
interface PdfPageData {
  getTextContent: (opts?: {
    normalizeWhitespace?: boolean;
    disableCombineTextItems?: boolean;
  }) => Promise<{ items: { str: string }[] }>;
}
const pdfParse = requireCjs("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
  options?: { pagerender?: (pageData: PdfPageData) => Promise<string> }
) => Promise<{ numpages: number; text: string }>;

/**
 * PDF → canonical document shape. One section per page, paragraphs split on
 * blank lines. Scanned/image-only pages yield empty sections — OCR and image
 * extraction for PDFs land with the Phase 3 tagged-PDF work.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pageTexts: string[] = [];

  const data = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      const text = content.items
        .map((item) => item.str)
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      pageTexts.push(text);
      return text;
    },
  });

  const sections = pageTexts.map((text, index) => {
    const paragraphs = text
      .split(/\n?\s*\n\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 1);
    const html =
      paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n") ||
      "<p></p>";
    return extractSection(html, `pdf/page-${index + 1}.xhtml`, index);
  });

  return {
    title: firstHeading(sections[0]),
    language: "en",
    spineHrefs: sections.map((s) => s.sourceHref),
    images: new Map<string, ParsedImageRef>(),
    sections,
    readBinary: async () => null,
  };
}

function firstHeading(section: { blocks: { kind: string; text?: string }[] } | undefined): string | null {
  if (!section) return null;
  const heading = section.blocks.find((b) => b.kind === "heading");
  return heading?.text ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
