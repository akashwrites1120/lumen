"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-context";

type Mode = "light" | "dark" | "system";

export function ThemeToggle() {
  const { mode, resolved, setMode } = useTheme();

  const options: { value: Mode; icon: React.ElementType; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1"
    >
      {options.map(({ value, icon: Icon, label }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(value)}
            className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {active && value === "dark" && resolved === "light" ? null : null}
          </button>
        );
      })}
    </div>
  );
}
