export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  stage: string;
  createdAt: string;
  documentCount: number;
  assetCount: number;
}

export interface ProjectDetail {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  stage: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRow {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  state: "uploaded" | "parsing" | "ingested" | "failed";
  storageKey: string;
  title: string | null;
  language: string;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetRow {
  id: string;
  documentId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  sourceHref: string | null;
  spineIndex: number | null;
  widthPx: number | null;
  heightPx: number | null;
  imageClass: string | null;
  state: string;
  createdAt: string;
}

export interface SuggestionRow {
  id: string;
  assetId: string;
  revision: number;
  provider: string | null;
  altText: string;
  longDescription: string | null;
  confidence: number | null;
}

export interface ReviewCounts {
  total: number;
  drafted: number;
  approved: number;
}

export interface ReviewItem extends AssetRow {
  suggestion: SuggestionRow | null;
}

export interface ReviewFeed {
  documentId: string;
  counts: ReviewCounts;
  items: ReviewItem[];
}

export interface ValidationRow {
  exportId: string;
  validator: string;
  format: string;
  passed: "passed" | "failed" | "skipped";
  output: unknown;
  createdAt: string;
}

export interface ExportRow {
  id: string;
  projectId: string;
  formats: string[];
  status: "pending" | "running" | "completed" | "failed" | "validation_failed";
  artifactKeys: Record<string, string> | null;
  createdAt: string;
  validations?: ValidationRow[];
}
