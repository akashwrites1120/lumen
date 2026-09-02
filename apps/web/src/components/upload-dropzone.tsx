"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudUpload, FileCheck2, Languages } from "lucide-react";
import { toast } from "sonner";
import { SUPPORTED_LANGUAGES, languageName } from "@lumen/schemas";
import { api, ApiError } from "@/lib/api";
import type { DocumentRow } from "@/lib/types";

export function UploadDropzone({
  projectId,
  onUploaded,
}: {
  projectId: string;
  onUploaded: (doc: DocumentRow) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [language, setLanguage] = React.useState<string>("en");

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const ok = [".epub", ".docx", ".pdf"].some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
    if (!ok) {
      toast.error("Accepted formats: EPUB, DOCX, PDF");
      return;
    }
    setProgress(0);
    try {
      const res = await api.uploadDocument(projectId, file, language, setProgress);
      toast.success(
        `${file.name} queued for ingest (alt text in ${languageName(language)})`
      );
      onUploaded(res.document);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 415
            ? "Only EPUB, DOCX and PDF are supported"
            : err.message
          : "Upload failed";
      toast.error(msg);
    } finally {
      setTimeout(() => setProgress(null), 600);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload document"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className="relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-colors duration-200 focus-visible:outline-none"
      style={{
        borderColor: dragging ? "var(--primary)" : "var(--input)",
        background: dragging ? "var(--glow)" : undefined,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.docx,.pdf,application/epub+zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <label
        className="mb-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
        aria-label="Alt-text language"
      >
        <Languages className="h-3.5 w-3.5" />
        Alt text in
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="rounded-md border border-input bg-background px-1.5 py-0.5 text-xs text-foreground focus-visible:outline-none"
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {languageName(code)}
            </option>
          ))}
        </select>
      </label>

      <AnimatePresence mode="wait">
        {dragging ? (
          <motion.div
            key="drop"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="flex flex-col items-center gap-3"
          >
            <motion.span
              animate={{ y: [0, -8, 0] }}
              transition={{ repeat: Infinity, duration: 0.9, ease: "easeInOut" }}
              className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground"
            >
              <CloudUpload className="h-7 w-7" />
            </motion.span>
            <p className="font-medium">Drop your book here</p>
          </motion.div>
        ) : progress !== null ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-3"
          >
            <FileCheck2 className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium">
              {progress < 100 ? `Uploading… ${progress}%` : "Queued for ingest"}
            </p>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                animate={{ width: `${Math.max(progress, 8)}%` }}
                transition={{ ease: "easeOut", duration: 0.25 }}
              />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-2"
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
              <CloudUpload className="h-7 w-7" />
            </span>
            <p className="font-medium">Drag a book here, or click to browse</p>
            <p className="text-sm text-muted-foreground">
              Up to 100 MB · PDF & DOCX support arrives in Phase 1
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
