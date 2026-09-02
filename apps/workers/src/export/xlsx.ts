import ExcelJS from "exceljs";
import type { Block, CanonicalIR } from "@lumen/schemas";
import type { ExportInput } from "./builders.js";

/**
 * Build an accessible XLSX artifact from the canonical IR.
 *
 * Layout:
 *   - "Overview" sheet: project metadata, document count, figure count
 *   - "Figures" sheet: one row per figure (asset id, document, section,
 *     approved alt text, long description, mime type)
 *   - "Sections" sheet: one row per section with its block kinds as columns
 *
 * Accessibility: each sheet sets a real `name` (not a default), the header
 * row is bold and frozen, and the workbook-level properties carry a
 * non-empty title so screen readers announce something meaningful.
 */
export async function buildXlsxArtifact(input: ExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lumen";
  wb.created = new Date();
  wb.title = `${input.project.name} — accessibility export`;
  wb.company = "Lumen";

  const totalFigures = countFigures(input);
  const totalSections = input.documents.reduce((n, d) => n + d.sections.length, 0);

  buildOverviewSheet(wb, input, { totalFigures, totalSections });
  buildFiguresSheet(wb, input);
  buildSectionsSheet(wb, input);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function buildOverviewSheet(
  wb: ExcelJS.Workbook,
  input: ExportInput,
  counts: { totalFigures: number; totalSections: number }
): void {
  const ws = wb.addWorksheet("Overview");
  ws.columns = [
    { header: "Field", key: "field", width: 24 },
    { header: "Value", key: "value", width: 60 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const rows: Array<[string, string | number]> = [
    ["Project", input.project.name],
    ["Project ID", input.project.id],
    ["Description", input.project.description ?? ""],
    ["Documents", input.documents.length],
    ["Sections", counts.totalSections],
    ["Figures (approved)", counts.totalFigures],
    ["Generated at", new Date().toISOString()],
  ];
  for (const [field, value] of rows) ws.addRow({ field, value });
}

function buildFiguresSheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const ws = wb.addWorksheet("Figures");
  ws.columns = [
    { header: "Asset ID", key: "assetId", width: 38 },
    { header: "Document", key: "documentTitle", width: 32 },
    { header: "Section", key: "sectionTitle", width: 28 },
    { header: "Alt text (approved)", key: "alt", width: 60 },
    { header: "Long description", key: "long", width: 60 },
    { header: "MIME", key: "mime", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const doc of input.documents) {
    const docTitle = doc.title ?? "(untitled)";
    for (const section of doc.sections) {
      for (const block of section.blocks) {
        if (block.kind !== "figure") continue;
        const fig = input.figures.get(block.assetId);
        ws.addRow({
          assetId: block.assetId,
          documentTitle: docTitle,
          sectionTitle: section.title,
          alt: fig?.altText ?? block.alt ?? "",
          long: fig?.longDescription ?? "",
          mime: fig?.mimeType ?? "",
        });
      }
    }
  }
}

function buildSectionsSheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const ws = wb.addWorksheet("Sections");
  ws.columns = [
    { header: "Document", key: "document", width: 28 },
    { header: "Section", key: "section", width: 28 },
    { header: "Block kind", key: "kind", width: 14 },
    { header: "Text", key: "text", width: 80 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const doc of input.documents) {
    const docTitle = doc.title ?? "(untitled)";
    for (const section of doc.sections) {
      for (const block of section.blocks) {
        ws.addRow({
          document: docTitle,
          section: section.title,
          kind: block.kind,
          text: blockText(block),
        });
      }
    }
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "list_item":
      return block.text;
    case "table":
      return block.rows.map((r) => r.join("\t")).join("\n");
    case "figure":
      return block.alt ?? "";
  }
}

function countFigures(input: ExportInput): number {
  let n = 0;
  for (const doc of input.documents) {
    for (const section of doc.sections) {
      for (const block of section.blocks) if (block.kind === "figure") n += 1;
    }
  }
  return n;
}
