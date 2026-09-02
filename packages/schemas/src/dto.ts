import { z } from "zod";

export const OrgRole = z.enum(["owner", "admin", "reviewer", "viewer"]);
export type OrgRole = z.infer<typeof OrgRole>;

export const RegisterInput = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  name: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(160),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const PublicUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: OrgRole,
  organizationId: z.string().uuid(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

export const ALLOWED_UPLOAD_MIME = z.enum([
  "application/epub+zip",
]);

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const AssetDTO = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  state: z.string(),
  imageClass: z.string().nullable(),
  storageKey: z.string(),
  checksumSha256: z.string(),
  widthPx: z.number().int().nullable(),
  heightPx: z.number().int().nullable(),
  sourceHref: z.string().nullable(),
  createdAt: z.string(),
});
export type AssetDTO = z.infer<typeof AssetDTO>;

export const ReviewDecision = z.enum(["approved", "edited", "rejected", "decorative"]);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const ReviewDecisionInput = z
  .object({
    decision: ReviewDecision,
    finalAltText: z.string().max(2000).optional(),
    feedback: z.string().max(2000).optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .refine(
    (v) =>
      v.decision === "approved" ||
      v.decision === "rejected" ||
      v.decision === "decorative" ||
      typeof v.finalAltText === "string",
    { message: "finalAltText is required for edited decisions" }
  );
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionInput>;

export const ExportFormat = z.enum(["json", "epub", "xlsx", "html", "azw3", "pdf"]);
export type ExportFormat = z.infer<typeof ExportFormat>;

/** Alt-text output languages supported at launch (PRD Phase 3). */
export const SUPPORTED_LANGUAGES = ["en", "es", "fr", "de", "hi"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LanguageInput = z.enum(SUPPORTED_LANGUAGES);
export type LanguageInput = z.infer<typeof LanguageInput>;

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
};

/** Human-readable name for a language code; unknown codes pass through. */
export function languageName(code: string): string {
  return LANGUAGE_NAMES[code as SupportedLanguage] ?? code;
}

export const CreateExportInput = z.object({
  formats: z.array(ExportFormat).min(1).max(5),
});
export type CreateExportInput = z.infer<typeof CreateExportInput>;
