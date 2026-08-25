import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };
