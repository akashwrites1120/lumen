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
