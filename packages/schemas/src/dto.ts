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
