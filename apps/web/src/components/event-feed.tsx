"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import type { ProgressEvent } from "@lumen/schemas";
import { subscribeProjectEvents } from "@/lib/api";

const STAGE_META: Record<
  string,
  { icon: React.ElementType; className: string }
> = {
  received: { icon: Loader2, className: "text-muted-foreground" },
  parsing: { icon: Loader2, className: "text-primary" },
  extracting_images: { icon: Loader2, className: "text-primary" },
  building_ir: { icon: Loader2, className: "text-primary" },
  completed: { icon: CheckCircle2, className: "text-success" },
  failed: { icon: CircleAlert, className: "text-danger" },
};

export function EventFeed({ projectId }: { projectId: string }) {
  const [events, setEvents] = React.useState<ProgressEvent[]>([]);
  const [connected, setConnected] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const unsubscribe = subscribeProjectEvents(projectId, {
      onProgress: (ev) => {
        setConnected(true);
        setEvents((prev) =>
          [ev, ...prev.filter((p) => p.documentId !== ev.documentId || p.stage !== ev.stage)].slice(0, 30)
        );
      },
      onError: () => setConnected(false),
    });
    return unsubscribe;
  }, [projectId]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [events.length]);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-primary" />
          Live pipeline
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "animate-pulse bg-success" : "bg-muted-foreground/40"}`}
          />
          {connected ? "streaming" : "waiting for events"}
        </span>
      </div>
      <div ref={scrollRef} className="max-h-72 space-y-1 overflow-y-auto p-3">
        {events.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Upload a document to see live progress.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {events.map((ev) => {
              const meta = STAGE_META[ev.stage] ?? STAGE_META.received!;
              const Icon = meta.icon;
              const spinning = Icon === Loader2;
              return (
                <motion.div
                  key={`${ev.documentId}-${ev.stage}-${ev.at}`}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/50"
                >
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}${spinning ? " animate-spin" : ""}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{ev.message ?? humanize(ev.stage)}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {ev.stage.replace(/_/g, " ")}
                      {ev.figuresFound > 0 && ` · ${ev.figuresFound} figure${ev.figuresFound === 1 ? "" : "s"}`}
                      {" · "}
                      {new Date(ev.at).toLocaleTimeString()}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function humanize(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1).replace(/_/g, " ");
}
