"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState({
    name: "",
    organizationName: "",
    email: "",
    password: "",
  });

  const isRegister = mode === "register";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = isRegister
        ? await api.register({
            name: fields.name,
            organizationName: fields.organizationName,
            email: fields.email,
            password: fields.password,
          })
        : await api.login({ email: fields.email, password: fields.password });
      setAuth(res.token, res.user);
      toast.success(isRegister ? "Welcome to Lumen" : "Welcome back");
      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 409
            ? "That email is already registered."
            : err.status === 401
              ? "Invalid email or password."
              : err.message
          : "Something went wrong. Is the API running?";
      toast.error(message);
      setPending(false);
    }
  }

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="grain relative flex min-h-screen flex-col">
      <div className="flex items-center justify-between px-6 py-5">
        <Logo />
        <ThemeToggle />
      </div>

      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.21, 0.47, 0.32, 0.98] }}
          className="w-full max-w-md"
        >
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">
              {isRegister ? "Create your organization" : "Sign in to Lumen"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isRegister
                ? "Start making your catalog accessible today."
                : "Pick up where you left off."}
            </p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              {isRegister && (
                <>
                  <Field label="Your name">
                    <Input required value={fields.name} onChange={set("name")} placeholder="Priya Sharma" />
                  </Field>
                  <Field label="Organization">
                    <Input
                      required
                      value={fields.organizationName}
                      onChange={set("organizationName")}
                      placeholder="Northwind Press"
                    />
                  </Field>
                </>
              )}
              <Field label="Email">
                <Input
                  required
                  type="email"
                  autoComplete="email"
                  value={fields.email}
                  onChange={set("email")}
                  placeholder="you@publisher.com"
                />
              </Field>
              <Field label="Password" hint={isRegister ? "At least 10 characters" : undefined}>
                <Input
                  required
                  type="password"
                  minLength={isRegister ? 10 : undefined}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  value={fields.password}
                  onChange={set("password")}
                  placeholder="••••••••••"
                />
              </Field>
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Working…
                  </span>
                ) : isRegister ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </div>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {isRegister ? (
              <>
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-primary hover:underline">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New to Lumen?{" "}
                <Link href="/register" className="font-medium text-primary hover:underline">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </motion.div>
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
