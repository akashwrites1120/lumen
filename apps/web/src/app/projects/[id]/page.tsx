"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, FileText, Layers } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { UploadDropzone } from "@/components/upload-dropzone";
import { DocumentList } from "@/components/document-list";
import { EventFeed } from "@/components/event-feed";
import { ExportPanel } from "@/components/export-panel";
import { MetricsCard } from "@/components/metrics-card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { DocumentRow, ProjectDetail } from "@/lib/types";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;

  const [data, setData] = React.useState<{
    project: ProjectDetail;
    documents: DocumentRow[];
  } | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.getProject(projectId);
      setData(res);
    } catch {
      setNotFound(true);
    }
  }, [projectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!projectId) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [projectId, load]);

  if (notFound) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h1 className="text-xl font-semibold">Project not found</h1>
          <Link href="/dashboard" className="mt-3 inline-block text-sm text-primary hover:underline">
            Back to dashboard
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All projects
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {data?.project.name ?? "…"}
            </h1>
            {data && (
              <Badge variant="muted">
                <Layers className="mr-1 h-3 w-3" />
                {data.documents.length} document{data.documents.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          {data?.project.description && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {data.project.description}
            </p>
          )}
        </motion.div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {projectId && (
              <motion.section
                aria-label="Upload documents"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08, duration: 0.45 }}
              >
                <SectionTitle icon={<FileText className="h-4 w-4" />}>Add a book</SectionTitle>
                <UploadDropzone
                  projectId={projectId}
                  onUploaded={() => setTimeout(() => void load(), 400)}
                />
              </motion.section>
            )}

            <motion.section
              aria-label="Documents"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.45 }}
            >
              <SectionTitle icon={<FileText className="h-4 w-4" />}>
                Documents & extracted figures
              </SectionTitle>
              {data ? (
                <DocumentList documents={data.documents} />
              ) : (
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
                  ))}
                </div>
              )}
            </motion.section>
          </div>

          <motion.aside
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22, duration: 0.45 }}
            className="space-y-6"
          >
            <MetricsCard projectId={projectId} />
            <ExportPanel projectId={projectId} />
            {projectId && <EventFeed projectId={projectId} />}
          </motion.aside>
        </div>
      </main>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {children}
    </h2>
  );
}
