"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { FolderOpen, Image, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { Counter } from "@/components/counter";
import { ProjectCard } from "@/components/project-card";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { ProjectSummary } from "@/lib/types";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [projects, setProjects] = React.useState<ProjectSummary[] | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await api.listProjects();
      setProjects(res.projects);
    } catch {
      toast.error("Could not load projects. Is the API running?");
      setProjects([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const totals = React.useMemo(() => {
    if (!projects) return { docs: 0, assets: 0 };
    return {
      docs: projects.reduce((a, p) => a + p.documentCount, 0),
      assets: projects.reduce((a, p) => a + p.assetCount, 0),
    };
  }, [projects]);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-wrap items-end justify-between gap-4"
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {user ? `Good to see you, ${user.name.split(" ")[0]}` : "Dashboard"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage accessibility projects across your organization.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> New project
          </Button>
        </motion.div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Projects"
            value={projects?.length ?? 0}
            icon={<FolderOpen className="h-4 w-4" />}
            loading={projects === null}
          />
          <StatTile label="Documents" value={totals.docs} icon={<span className="text-xs font-bold">#</span>} loading={projects === null} />
          <StatTile label="Figures extracted" value={totals.assets} icon={<Image className="h-4 w-4" />} loading={projects === null} />
        </div>

        <section aria-label="Projects" className="mt-10">
          {projects === null ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-44" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p, i) => (
                <ProjectCard key={p.id} project={p} index={i} />
              ))}
            </div>
          )}
        </section>
      </main>

      <NewProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.45 }}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">
        {loading ? <Skeleton className="h-9 w-16" /> : <Counter to={value} duration={900} />}
      </div>
    </motion.div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-input bg-card/50 px-8 py-20 text-center"
    >
      <motion.span
        animate={{ rotate: [0, -6, 6, 0] }}
        transition={{ repeat: Infinity, repeatDelay: 3, duration: 1.2 }}
        className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-foreground"
      >
        <FolderOpen className="h-7 w-7" />
      </motion.span>
      <h2 className="mt-5 text-lg font-semibold">No projects yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Create your first project, upload an EPUB and watch Lumen extract figures and build
        accessible structure.
      </p>
      <Button onClick={onCreate} className="mt-6">
        <Plus /> New project
      </Button>
    </motion.div>
  );
}
