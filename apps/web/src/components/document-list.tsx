"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { AssetRow, DocumentRow } from "@/lib/types";

const DOC_STATE: Record<DocumentRow["state"], { text: string; variant: "default" | "success" | "muted" | "danger" }> = {
  uploaded: { text: "Uploaded", variant: "muted" },
  parsing: { text: "Parsing", variant: "default" },
  ingested: { text: "Ingested", variant: "success" },
  failed: { text: "Failed", variant: "danger" },
};

export function DocumentList({ documents }: { documents: DocumentRow[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  if (documents.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-input px-5 py-8 text-center text-sm text-muted-foreground">
        No documents yet — upload an EPUB to get started.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {documents.map((doc) => (
        <DocumentRowItem
          key={doc.id}
          doc={doc}
          open={openId === doc.id}
          onToggle={() => setOpenId((cur) => (cur === doc.id ? null : doc.id))}
        />
      ))}
    </ul>
  );
}

function DocumentRowItem({
  doc,
  open,
  onToggle,
}: {
  doc: DocumentRow;
  open: boolean;
  onToggle: () => void;
}) {
  const state = DOC_STATE[doc.state] ?? DOC_STATE.uploaded;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{doc.filename}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {doc.title ? `${doc.title} · ` : ""}
            {formatBytes(doc.sizeBytes)} · sha256 {doc.checksumSha256.slice(0, 10)}…
            {doc.errorDetail && (
              <span className="ml-2 text-danger">{doc.errorDetail}</span>
            )}
          </p>
        </div>
        <Badge variant={state.variant}>
          {state.text === "Parsing" && (
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          )}
          {state.text}
        </Badge>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="assets"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="overflow-hidden"
          >
            <AssetGallery documentId={doc.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function AssetGallery({ documentId }: { documentId: string }) {
  const [assets, setAssets] = React.useState<AssetRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void api
      .listAssets(documentId)
      .then((res) => {
        if (!cancelled) setAssets(res.assets);
      })
      .catch(() => setAssets([]));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (assets === null) {
    return (
      <div className="border-t border-border px-5 py-4">
        <div className="flex gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 w-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-5 py-4 text-sm text-muted-foreground">
        <ImageOff className="h-4 w-4" /> No figures found in this EPUB.
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-secondary/30 px-5 py-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {assets.length} extracted figure{assets.length === 1 ? "" : "s"} · deduplicated by checksum
      </p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {assets.map((asset, i) => (
          <motion.div
            key={asset.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-background"
            title={`${asset.sourceHref ?? "image"} · ${formatBytes(asset.byteSize)}${
              asset.widthPx ? ` · ${asset.widthPx}×${asset.heightPx}` : ""
            }`}
          >
            <AuthedImage assetId={asset.id} mimeType={asset.mimeType} />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              {asset.sourceHref?.split("/").pop()}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function AuthedImage({ assetId, mimeType }: { assetId: string; mimeType: string }) {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    void api
      .fetchAssetBlobUrl(assetId)
      .then((u) => {
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  if (!url) {
    return <div className="h-full w-full animate-pulse bg-muted" />;
  }
  if (mimeType === "image/svg+xml") {
    return <iframe title={`asset-${assetId}`} src={url} className="h-full w-full border-0" sandbox="" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
