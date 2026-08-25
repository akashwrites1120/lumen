import { z } from "zod";

export const IngestStage = z.enum([
  "received",
  "parsing",
  "extracting_images",
  "building_ir",
  "completed",
  "failed",
]);
export type IngestStage = z.infer<typeof IngestStage>;

export const ProgressEvent = z.object({
  type: z.literal("document.progress"),
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  stage: IngestStage,
  figuresFound: z.number().int().nonnegative().default(0),
  message: z.string().optional(),
  at: z.string(),
});
export type ProgressEvent = z.infer<typeof ProgressEvent>;

export function progressChannel(projectId: string): string {
  return `project:${projectId}:events`;
}
