"use client";

import * as React from "react";
import { Gauge, Timer, TrendingUp, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ProjectMetrics } from "@/lib/types";

export function MetricsCard({ projectId }: { projectId: string }) {
  const [metrics, setMetrics] = React.useState<ProjectMetrics | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .metrics(projectId)
        .then((res) => {
          if (!cancelled) setMetrics(res.metrics);
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projectId]);

  const stats: {
    label: string;
    value: string;
    Icon: React.ElementType;
  }[] = metrics
    ? [
        {
          label: "AI acceptance",
          value:
            metrics.aiAcceptanceRatePct === null ? "—" : `${metrics.aiAcceptanceRatePct}%`,
          Icon: Wand2,
        },
        {
          label: "Avg edit distance",
          value:
            metrics.avgEditDistanceChars === null
              ? "—"
              : `${metrics.avgEditDistanceChars} chars`,
          Icon: TrendingUp,
        },
        {
          label: "Throughput p50",
          value:
            metrics.throughputP50Sec === null ? "—" : `${metrics.throughputP50Sec}s`,
          Icon: Timer,
        },
        {
          label: "Decisions",
          value: String(metrics.totalDecisions),
          Icon: Gauge,
        },
      ]
    : [];

  if (!metrics || metrics.totalDecisions === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3.5 text-sm font-medium">
        Review quality
      </div>
      <dl className="grid grid-cols-2 gap-3 px-5 py-4">
        {stats.map(({ label, value, Icon }) => (
          <div key={label} className="rounded-xl bg-secondary/40 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Icon className="h-3 w-3" /> {label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
