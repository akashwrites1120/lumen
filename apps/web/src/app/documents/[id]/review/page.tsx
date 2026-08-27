"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CircleSlash,
  Eye,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ReviewFeed, ReviewItem } from "@/lib/types";

const HOTKEYS = [
  { keys: ["J", "↓"], action: "Next image" },
  { keys: ["K", "↑"], action: "Previous image" },
  { keys: "A", action: "Approve AI suggestion" },
  { keys: "E", action: "Edit & save" },
  { keys: "R", action: "Reject" },
  { keys: "D", action: "Mark decorative" },
];

export default function ReviewWorkbenchPage() {
  const params = useParams<{ id: string }>();
  const documentId = params?.id;
  const router = useRouter();

  const [feed, setFeed] = React.useState<ReviewFeed | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const [editValue, setEditValue] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const shownAtRef = React.useRef<number>(Date.now());
  const editRef = React.useRef<HTMLTextAreaElement>(null);

  const load = React.useCallback(async () => {
    if (!documentId) return;
    try {
      const res = await api.listReview(documentId);
      setFeed(res);
    } catch {
      setNotFound(true);
    }
  }, [documentId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!documentId) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [documentId, load]);

  const items = feed?.items ?? [];
  const pending = items.filter((i) => i.state !== "approved");
  const current: ReviewItem | undefined = pending[cursor] ?? pending[pending.length - 1];
  const done = feed ? feed.counts.approved : 0;
  const total = feed ? feed.counts.total : 0;

  React.useEffect(() => {
    shownAtRef.current = Date.now();
    setEditValue(null);
  }, [current?.id]);

  const decide = React.useCallback(
    async (
      item: ReviewItem,
      decision: "approved" | "edited" | "rejected" | "decorative",
      finalAltText?: string
    ) => {
      if (busy) return;
      setBusy(true);
      try {
        await api.submitDecision(item.id, {
          decision,
          ...(finalAltText !== undefined ? { finalAltText } : {}),
          durationMs: Date.now() - shownAtRef.current,
        });
        setEditValue(null);
        setAnnouncement(
          `${decision}. ${Math.max(0, pending.length - 1)} image(s) remaining.`
        );
        await load();
        setCursor((c) => Math.max(0, Math.min(c, pending.length - 2)));
        if (decision === "rejected") return;
      } finally {
        setBusy(false);
      }
    },
    [busy, load, pending.length]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;

      if (typing) {
        if (e.key === "Escape") setEditValue(null);
        return;
      }

      switch (e.key.toLowerCase()) {
        case "j":
        case "arrowdown":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, Math.max(0, pending.length - 1)));
          break;
        case "k":
        case "arrowup":
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case "a":
          void decide(current, "approved");
          break;
        case "e":
          e.preventDefault();
          setEditValue(current.suggestion?.altText ?? "");
          setTimeout(() => editRef.current?.focus(), 30);
          break;
        case "r":
          void decide(current, "rejected");
          break;
        case "d":
          void decide(current, "decorative");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, pending.length, decide]);

  if (notFound) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h1 className="text-xl font-semibold">Document not found</h1>
          <Link href="/dashboard" className="mt-3 inline-block text-sm text-primary hover:underline">
            Back to dashboard
          </Link>
        </main>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen">
        <a
          href="#workbench-main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to review area
        </a>
        <AppHeader />
        <main id="workbench-main" className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="sr-only">Review workbench</h1>
          <div aria-live="polite" role="status" className="sr-only">
            {announcement}
          </div>
          <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to project
          </button>
          <Badge variant={done >= total && total > 0 ? "success" : "default"}>
            <Eye className="mr-1 h-3 w-3" />
            {done}/{total} approved
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {HOTKEYS.map((h) => `${h.keys} ${h.action}`).join(" · ")}
          </span>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full bg-success"
            animate={{ width: total > 0 ? `${(done / total) * 100}%` : "0%" }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {!feed || items.length === 0 ? (
          <p className="mt-16 rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No images extracted yet — upload an EPUB and wait for ingest to finish.
          </p>
        ) : !current ? (
          <div className="mt-16 rounded-xl border border-border bg-card px-6 py-12 text-center">
            <Check className="mx-auto h-10 w-10 text-success" />
            <p className="mt-3 text-sm font-medium">Every image has been reviewed.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Head back to the project to run a gated export.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section aria-label="Image under review" className="space-y-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card p-6"
                >
                  <AuthedImageLarge assetId={current.id} mimeType={current.mimeType} />
                </motion.div>
              </AnimatePresence>

              <div aria-label="Queue strip" className="flex gap-2 overflow-x-auto pb-2">
                {pending.map((item, i) => (
                  <button
                    key={item.id}
                    onClick={() => setCursor(i)}
                    aria-current={item.id === current.id}
                    className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border transition-all ${
                      item.id === current.id
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border opacity-70 hover:opacity-100"
                    }`}
                  >
                    <ThumbImage assetId={item.id} mimeType={item.mimeType} />
                  </button>
                ))}
              </div>
            </section>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    AI draft
                  </span>
                  {current.suggestion && (
                    <Badge variant={laneVariant(laneOf(current))}>
                      <Sparkles className="mr-1 h-3 w-3" />
                      {laneOf(current)} · {current.suggestion.confidence ?? "?"}%
                    </Badge>
                  )}
                </div>

                {current.suggestion ? (
                  <>
                    <p className="mt-3 rounded-lg bg-secondary/60 p-3 text-sm leading-relaxed">
                      {current.suggestion.altText}
                    </p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      rev {current.suggestion.revision} · {current.suggestion.provider ?? "unknown"}
                      {current.imageClass ? ` · ${current.imageClass.replace(/_/g, " ")}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No draft yet — still drafting or failed. Try regenerating.
                  </p>
                )}

                {editValue !== null && (
                  <textarea
                    ref={editRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        void decide(current, "edited", editValue);
                      }
                    }}
                    rows={3}
                    maxLength={2000}
                    aria-label="Final alt text"
                    placeholder="Write the final alt text…"
                    className="mt-3 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  />
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    disabled={!current.suggestion || busy}
                    onClick={() => void decide(current, "approved")}
                  >
                    <Check className="mr-1.5 h-4 w-4" /> Approve <Kbd>A</Kbd>
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!current.suggestion || busy}
                    onClick={() => {
                      setEditValue(current.suggestion!.altText);
                      setTimeout(() => editRef.current?.focus(), 30);
                    }}
                  >
                    <Pencil className="mr-1.5 h-4 w-4" /> Edit <Kbd>E</Kbd>
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      editValue !== null
                        ? void decide(current, "edited", editValue)
                        : void decide(current, "rejected")
                    }
                  >
                    {editValue !== null ? "Save edit" : "Reject"}{" "}
                    <Kbd>{editValue !== null ? "⌃↵" : "R"}</Kbd>
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void decide(current, "decorative")}>
                    <CircleSlash className="mr-1.5 h-4 w-4" /> Decorative <Kbd>D</Kbd>
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3.5 text-sm">
                <span className="text-muted-foreground">
                  Image {cursor + 1} of {pending.length} pending
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    await api.regenerate(current.id);
                    await load();
                  }}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Regenerate draft
                </Button>
              </div>
            </aside>
          </div>
        )}
        </main>
      </div>
    </MotionConfig>
  );
}

function laneOf(item: ReviewItem): "high" | "medium" | "low" | "decorative" {
  const conf = item.suggestion?.confidence ?? 0;
  if (item.imageClass === "decorative") return "decorative";
  if (conf >= 85) return "high";
  if (conf >= 60) return "medium";
  return "low";
}

function laneVariant(lane: string): "success" | "default" | "danger" | "muted" {
  if (lane === "high") return "success";
  if (lane === "medium") return "default";
  if (lane === "low") return "danger";
  return "muted";
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1 rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
      {children}
    </kbd>
  );
}

function AuthedImageLarge({ assetId, mimeType }: { assetId: string; mimeType: string }) {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    setUrl(null);
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

  if (!url) return <div className="h-72 w-full max-w-xl animate-pulse rounded-xl bg-muted" />;
  if (mimeType === "image/svg+xml") {
    return <iframe title={`asset-${assetId}`} src={url} className="max-h-[480px] w-full border-0" sandbox="" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className="max-h-[480px] max-w-full rounded-xl object-contain shadow-sm"
    />
  );
}

function ThumbImage({ assetId, mimeType }: { assetId: string; mimeType: string }) {
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

  if (!url) return <div className="h-full w-full animate-pulse bg-muted" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-full w-full object-cover" />;
}
