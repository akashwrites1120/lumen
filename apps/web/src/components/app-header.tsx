"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (mounted && !useAuthStore.getState().token) {
      router.replace("/login");
    }
  }, [mounted, router]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* session may already be gone */
    }
    clear();
    toast.success("Signed out");
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-6">
          <Logo href="/dashboard" />
          {children}
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
                  {mounted && user ? user.name.charAt(0).toUpperCase() : "?"}
                </span>
                <span className="hidden max-w-32 truncate sm:inline-block">
                  {mounted && user ? user.name : "…"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="truncate">
                {mounted && user ? (
                  <>
                    <span className="block truncate">{user.email}</span>
                    <span className="text-xs font-normal capitalize text-muted-foreground">
                      Role: {user.role}
                    </span>
                  </>
                ) : (
                  "Account"
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard" className="cursor-pointer">
                  <UserRound className="mr-2 h-4 w-4" /> Dashboard
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-danger focus:text-danger">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
