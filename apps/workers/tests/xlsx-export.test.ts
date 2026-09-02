import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import type { CanonicalIR } from "@lumen/schemas";
import { buildXlsxArtifact, type ExportFigure, type ExportInput } from "../src/export/xlsx.js";

const docId = "11111111-1111-4111-8111-111111111111";
const fig1 = "22222222-2222-4222-8222-222222222222";
const fig2 = "33333333-3333-4333-8333-333333333333";

const ir: CanonicalIR & { documentId: string } = {
  documentId: docId,
  format: "epub",
  title: "Test Book",
  language: "en",
  sections: [
    {
      id: "sec-1",
      title: "Chapter One",
      sourceHref: "OEBPS/ch1.xhtml",
      blocks: [
        { kind: "heading", level: 1, text: "Chapter One" },
        { kind: "paragraph", text: "A figure appears below." },
        { kind: "figure", assetId: fig1, alt: null },
        { kind: "table", rows: [["A", "B"], ["1", "2"]] },
      ],
    },
    {
      id: "sec-2",
      title: "Chapter Two",
      sourceHref: "OEBPS/ch2.xhtml",
      blocks: [
        { kind: "heading", level: 1, text: "Chapter Two" },
        { kind: "figure", assetId: fig2, alt: "bar chart" },
      ],
    },
  ],
};

const figures = new Map<string, ExportFigure>([
  [fig1, { assetId: fig1, storageKey: "k1", mimeType: "image/png", altText: "A vivid sunset", longDescription: null }],
  [fig2, { assetId: fig2, storageKey: "k2", mimeType: "image/png", altText: "Quarterly bar chart", longDescription: "Q1 2026 values." }],
]);

const input: ExportInput = {
  project: { id: "p1", name: "Test Project", description: "Fixture" },
  documents: [ir],
  figures,
};

describe("xlsx export", () => {
  it("produces a valid xlsx zip with the expected sheets", async () => {
    const buf = await buildXlsxArtifact(input);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    expect(buf.includes(Buffer.from("xl/workbook.xml"))).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((s) => s.name);
    expect(names).toEqual(["Overview", "Figures", "Sections"]);
  });

  it("captures one row per figure with the approved alt text", async () => {
    const buf = await buildXlsxArtifact(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Figures")!;
    const headerRow = ws.getRow(1);
    expect(headerRow.getCell(1).value).toBe("Asset ID");
    expect(headerRow.getCell(4).value).toBe("Alt text (approved)");

    const r2 = ws.getRow(2);
    expect(r2.getCell(1).value).toBe(fig1);
    expect(r2.getCell(2).value).toBe("Test Book");
    expect(r2.getCell(3).value).toBe("Chapter One");
    expect(r2.getCell(4).value).toBe("A vivid sunset");

    const r3 = ws.getRow(3);
    expect(r3.getCell(1).value).toBe(fig2);
    expect(r3.getCell(4).value).toBe("Quarterly bar chart");
    expect(r3.getCell(5).value).toBe("Q1 2026 values.");
  });

  it("captures section blocks with their kinds", async () => {
    const buf = await buildXlsxArtifact(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Sections")!;
    const kinds: unknown[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      kinds.push(row.getCell(3).value);
    });
    expect(kinds).toEqual(["heading", "paragraph", "figure", "table", "heading", "figure"]);
  });
});
