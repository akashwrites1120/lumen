"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, FileStack } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProjectSummary } from "@/lib/types";

const STAGE_LABEL: Record<string, { text: string; variant: "default" | "success" | "muted" | "danger" }> = {
  idle: { text: "Idle", variant: "muted" },
  ingesting: { text: "Ingesting", variant: "default" },
  drafting: { text: "AI drafting", variant: "default" },
  reviewing: { text: "In review", variant: "default" },
  ready_to_export: { text: "Ready to export", variant: "success" },
  exporting: { text: "Exporting", variant: "default" },
  delivered: { text: "Delivered", variant: "success" },
};

export function ProjectCard({ project, index }: { project: ProjectSummary; index: number }) {
  const stage = STAGE_LABEL[project.stage] ?? STAGE_LABEL.idle!;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.45, ease: [0.21, 0.47, 0.32, 0.98] }}
      whileHover={{ y: -4 }}
      className="h-full"
    >
      <Link
        href={`/projects/${project.id}`}
        className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-colors hover:border-primary/40"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-secondary-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
            <FileStack className="h-5 w-5" />
          </span>
          <Badge variant={stage.variant}>{stage.text}</Badge>
        </div>
        <h2 className="mt-4 font-semibold tracking-tight">{project.name}</h2>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
          {project.description || "No description"}
        </p>
        <div className="mt-auto flex items-center justify-between pt-5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{project.documentCount} document{project.documentCount === 1 ? "" : "s"}</span>
            <span aria-hidden>·</span>
            <span>{project.assetCount} figure{project.assetCount === 1 ? "" : "s"}</span>
          </div>
          <ArrowRight className="h-4 w-4 -translate-x-1 text-primary opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
      </Link>
    </motion.div>
  );
}
