"use client";

import { motion } from "framer-motion";
import { Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <motion.span
      whileHover={{ rotate: 12 }}
      transition={{ type: "spring", stiffness: 300, damping: 15 }}
      className={cn(
        "animate-pulse-ring relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm",
        className
      )}
    >
      <Sun className="h-5 w-5" strokeWidth={2.2} />
    </motion.span>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">
        Lumen
        <span className="ml-1.5 hidden rounded-md bg-accent px-1.5 py-0.5 align-middle font-mono text-[10px] font-medium uppercase tracking-wider text-accent-foreground sm:inline-block">
          a11y
        </span>
      </span>
    </a>
  );
}
