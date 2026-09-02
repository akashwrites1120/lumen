"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileCode,
  FileJson,
  FileSpreadsheet,
  BookOpen,
  Lock,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { ExportRow } from "@/lib/types";

const STATUS_VARIANT: Record<
  ExportRow["status"],
  "success" | "default" | "danger" | "muted"
> = {
  completed: "success",
  running: "default",
  pending: "muted",
  failed: "danger",
  validation_failed: "danger",
};

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel({ projectId }: { projectId: string }) {
  const [formats, setFormats] = React.useState<string[]>(["epub"]);
  const [exports, setExports] = React.useState<ExportRow[] | null>(null);
  const [allApproved, setAllApproved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [expRes, sumRes] = await Promise.all([
        api.listExports(projectId),
        api.reviewSummary(projectId),
      ]);
      setExports(expRes.exports);
      setAllApproved(
        sumRes.summary.total > 0 && sumRes.summary.approved >= sumRes.summary.total
      );
    } catch {
      setExports((cur) => cur ?? []);
    }
  }, [projectId]);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = (f: string) =>
    setFormats((cur) =>
      cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]
    );

  const requestExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestExport(projectId, formats);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? err.message === "azw3_disabled"
            ? err.detail ?? "Kindle export is behind a feature flag."
            : "Review gate: approve every image first."
          : "Could not start export."
      );
    } finally {
      setBusy(false);
    }
  };

  const download = async (exp: ExportRow, format: string) => {
    const { url, filename } = await api.downloadArtifactBlobUrl(exp.id, format);
    triggerDownload(url, filename);
  };

  const downloadReport = async (exportId: string) => {
    const { url, filename } = await api.downloadReportBlobUrl(exportId);
    triggerDownload(url, filename);
  };

  const downloadVpat = async (exportId: string) => {
    try {
      const { url, filename } = await api.downloadVpatBlobUrl(exportId);
      triggerDownload(url, filename);
    } catch {
      setError("Could not generate VPAT summary.");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Download className="h-4 w-4 text-primary" /> Export
        </span>
        {allApproved ? (
          <Badge variant="success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> review gate open
          </Badge>
        ) : (
          <Badge variant="muted">
            <Lock className="mr-1 h-3 w-3" /> locked until approved
          </Badge>
        )}
      </div>

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "json", label: "JSON", Icon: FileJson },
            { id: "epub", label: "EPUB 3", Icon: FileArchive },
            { id: "xlsx", label: "XLSX", Icon: FileSpreadsheet },
            { id: "html", label: "HTML", Icon: FileCode },
            { id: "azw3", label: "Kindle (AZW3)", Icon: BookOpen },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              disabled={!allApproved}
              onClick={() => toggle(id)}
              aria-pressed={formats.includes(id)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-all disabled:opacity-40 ${
                formats.includes(id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-secondary/50"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
          <Button
            size="sm"
            className="ml-auto self-center"
            disabled={!allApproved || busy || formats.length === 0}
            onClick={() => void requestExport()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Build
          </Button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}

        {exports && exports.length > 0 && (
          <ul className="space-y-2 pt-1">
            {exports.map((exp) => (
              <motion.li
                key={exp.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm"
              >
                <Badge variant={STATUS_VARIANT[exp.status] ?? "muted"}>
                  {exp.status === "running" && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {exp.status.replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {exp.formats.join(", ").toUpperCase()}
                </span>
                <div className="ml-auto flex gap-1.5">
                  {exp.status === "completed" &&
                    exp.formats.map((f) => (
                      <Button
                        key={f}
                        size="sm"
                        variant="outline"
                        onClick={() => void download(exp, f)}
                      >
                        <Download className="h-3.5 w-3.5" /> {f}
                      </Button>
                    ))}
                  {(exp.status === "completed" || exp.status === "validation_failed") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void downloadReport(exp.id)}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Report
                    </Button>
                  )}
                  {exp.status === "completed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void downloadVpat(exp.id)}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> VPAT
                    </Button>
                  )}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
