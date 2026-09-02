"use client";

import type { ProgressEvent, PublicUser, ReviewDecision } from "@lumen/schemas";
import { useAuthStore } from "./auth-store";
import type {
  AssetRow,
  DocumentRow,
  ExportRow,
  ProjectDetail,
  ProjectMetrics,
  ProjectSummary,
  ReviewFeed,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string
  ) {
    super(message);
  }
}

function authHeaders(): HeadersInit {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error ?? `request_failed_${res.status}`,
      typeof body.detail === "string" ? body.detail : undefined
    );
  }
  return body as T;
}

export const api = {
  register: (input: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
  }) =>
    request<{ token: string; user: PublicUser }>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  login: (input: { email: string; password: string }) =>
    request<{ token: string; user: PublicUser }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  logout: () => request<void>("/v1/auth/logout", { method: "POST" }),

  listProjects: () =>
    request<{ projects: ProjectSummary[] }>("/v1/projects"),

  createProject: (input: { name: string; description?: string }) =>
    request<{ project: ProjectDetail }>("/v1/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getProject: (id: string) =>
    request<{ project: ProjectDetail; documents: DocumentRow[] }>(
      `/v1/projects/${id}`
    ),

  deleteProject: (id: string) =>
    request<void>(`/v1/projects/${id}`, { method: "DELETE" }),

  uploadDocument: (
    projectId: string,
    file: File,
    language: string,
    onProgress?: (pct: number) => void
  ): Promise<{ document: DocumentRow }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/v1/projects/${projectId}/documents`);
      const token = useAuthStore.getState().token;
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new ApiError(xhr.status, body.error ?? "upload_failed"));
        } catch {
          reject(new ApiError(xhr.status, "upload_failed"));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "network_error"));
      const form = new FormData();
      form.append("file", file);
      form.append("language", language);
      xhr.send(form);
    });
  },

  listAssets: (documentId: string) =>
    request<{ assets: AssetRow[] }>(`/v1/documents/${documentId}/assets`),

  fetchAssetBlobUrl: async (assetId: string): Promise<string> => {
    const res = await fetch(`${API_BASE}/v1/assets/${assetId}/content`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, "asset_fetch_failed");
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  listReview: (documentId: string) =>
    request<ReviewFeed>(`/v1/documents/${documentId}/review`),

  submitDecision: (
    assetId: string,
    input: {
      decision: ReviewDecision;
      finalAltText?: string;
      feedback?: string;
      durationMs?: number;
    }
  ) =>
    request<{ review: unknown }>(`/v1/assets/${assetId}/decision`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  regenerate: (assetId: string) =>
    request<{ queued: boolean }>(`/v1/assets/${assetId}/regenerate`, {
      method: "POST",
    }),

  requestExport: (projectId: string, formats: string[]) =>
    request<{ export: ExportRow }>(`/v1/projects/${projectId}/exports`, {
      method: "POST",
      body: JSON.stringify({ formats }),
    }),

  listExports: (projectId: string) =>
    request<{ exports: ExportRow[] }>(`/v1/projects/${projectId}/exports`),

  reviewSummary: (projectId: string) =>
    request<{
      summary: Record<string, number>;
      stage: string | null;
    }>(`/v1/projects/${projectId}/review-summary`),

  metrics: (projectId: string) =>
    request<{ metrics: ProjectMetrics }>(`/v1/projects/${projectId}/metrics`),

  downloadArtifactBlobUrl: async (
    exportId: string,
    format: string
  ): Promise<{ url: string; filename: string }> => {
    const res = await fetch(
      `${API_BASE}/v1/exports/${exportId}/artifact/${format}`,
      { headers: authHeaders() }
    );
    if (!res.ok) throw new ApiError(res.status, "artifact_fetch_failed");
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return {
      url: URL.createObjectURL(blob),
      filename: match?.[1] ?? `export.${format}`,
    };
  },

  downloadReportBlobUrl: async (exportId: string): Promise<{ url: string; filename: string }> => {
    const res = await fetch(`${API_BASE}/v1/exports/${exportId}/report`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, "report_fetch_failed");
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return {
      url: URL.createObjectURL(blob),
      filename: match?.[1] ?? `compliance-report-${exportId.slice(0, 8)}.json`,
    };
  },

  downloadVpatBlobUrl: async (exportId: string): Promise<{ url: string; filename: string }> => {
    const res = await fetch(`${API_BASE}/v1/exports/${exportId}/vpat`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, "vpat_fetch_failed");
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return {
      url: URL.createObjectURL(blob),
      filename: match?.[1] ?? `vpat-${exportId.slice(0, 8)}.md`,
    };
  },
};

export function subscribeProjectEvents(
  projectId: string,
  handlers: {
    onProgress?: (ev: ProgressEvent) => void;
    onError?: () => void;
  }
): () => void {
  const controller = new AbortController();
  const token = useAuthStore.getState().token;

  void (async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/projects/${projectId}/events`, {
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`sse_status_${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let event = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          const payload = dataLines.join("\n");
          if (event === "progress") {
            try {
              handlers.onProgress?.(JSON.parse(payload) as ProgressEvent);
            } catch {
              /* ignore malformed frames */
            }
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) handlers.onError?.();
      void err;
    }
  })();

  return () => controller.abort();
}
