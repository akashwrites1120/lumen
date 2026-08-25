"use client";

import * as React from "react";

type Mode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: Mode;
  resolved: "light" | "dark";
  setMode: (mode: Mode) => void;
}

const ThemeContext = React.createContext<ThemeContextValue>({
  mode: "system",
  resolved: "light",
  setMode: () => {},
});

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(mode: Mode): "light" | "dark" {
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  return dark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<Mode>("system");
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const stored = (localStorage.getItem("lumen-theme") as Mode | null) ?? "system";
    setModeState(stored);
    setResolved(apply(stored));

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem("lumen-theme") as Mode | null) ?? "system") {
        setResolved(apply(((localStorage.getItem("lumen-theme") as Mode | null) ?? "system")));
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setMode = React.useCallback((next: Mode) => {
    localStorage.setItem("lumen-theme", next);
    setModeState(next);
    setResolved(apply(next));
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => React.useContext(ThemeContext);

export const themeScript = `(function(){try{var m=localStorage.getItem("lumen-theme")||"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var c=document.documentElement.classList;d?c.add("dark"):c.remove("dark");document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
