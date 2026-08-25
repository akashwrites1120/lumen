import { z } from "zod";

export const ImageClass = z.enum([
  "photograph",
  "chart",
  "diagram",
  "table_scan",
  "infographic",
  "decorative",
  "unknown",
]);
export type ImageClass = z.infer<typeof ImageClass>;

export const AssetState = z.enum([
  "extracted",
  "ai_drafted",
  "in_review",
  "approved",
]);
export type AssetState = z.infer<typeof AssetState>;

export const DocumentState = z.enum([
  "uploaded",
  "parsing",
  "ingested",
  "failed",
]);
export type DocumentState = z.infer<typeof DocumentState>;

export const ProjectStage = z.enum([
  "idle",
  "ingesting",
  "drafting",
  "reviewing",
  "ready_to_export",
  "exporting",
  "delivered",
]);
export type ProjectStage = z.infer<typeof ProjectStage>;

const figureBlock = z.object({
  kind: z.literal("figure"),
  assetId: z.string().uuid(),
  alt: z.string().nullable(),
});

const headingBlock = z.object({
  kind: z.literal("heading"),
  level: z.number().int().min(1).max(6),
  text: z.string(),
});

const paragraphBlock = z.object({
  kind: z.literal("paragraph"),
  text: z.string(),
});

const listItemBlock = z.object({
  kind: z.literal("list_item"),
  ordered: z.boolean(),
  text: z.string(),
});

const tableBlock = z.object({
  kind: z.literal("table"),
  rows: z.array(z.array(z.string())),
});

export const Block = z.discriminatedUnion("kind", [
  figureBlock,
  headingBlock,
  paragraphBlock,
  listItemBlock,
  tableBlock,
]);
export type Block = z.infer<typeof Block>;

export const Section = z.object({
  id: z.string(),
  title: z.string(),
  sourceHref: z.string(),
  blocks: z.array(Block),
});
export type Section = z.infer<typeof Section>;

export interface CanonicalIR {
  documentId: string;
  format: "epub" | "pdf" | "docx";
  title: string | null;
  language: string;
  sections: Section[];
}

export function countFigures(ir: CanonicalIR): number {
  return ir.sections.reduce(
    (acc, s) => acc + s.blocks.filter((b) => b.kind === "figure").length,
    0
  );
}
