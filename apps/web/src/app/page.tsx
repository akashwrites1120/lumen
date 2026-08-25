"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  FileJson2,
  FileSpreadsheet,
  FileText,
  Eye,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Counter } from "@/components/counter";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

const pipeline = [
  { icon: BookOpen, label: "Upload", detail: "EPUB · PDF · DOCX" },
  { icon: ScanSearch, label: "Extract", detail: "Images & structure" },
  { icon: Sparkles, label: "AI drafts", detail: "Alt text & tables" },
  { icon: UserCheck, label: "Human review", detail: "Approve or fix" },
  { icon: BadgeCheck, label: "Compliant export", detail: "Validated outputs" },
];

const features = [
  {
    icon: Sparkles,
    title: "AI alt-text generation",
    body: "Context-aware descriptions with confidence scores. Decorative images are detected and marked correctly — automatically.",
  },
  {
    icon: ScanSearch,
    title: "Image extraction",
    body: "Every figure pulled out of your books with page position, checksums and deduplication built in.",
  },
  {
    icon: FileSpreadsheet,
    title: "Tables to data",
    body: "Chart scans and table images become structured rows you can export to accessible Excel workbooks.",
  },
  {
    icon: UserCheck,
    title: "Human-in-the-loop",
    body: "Nothing ships without a person approving it. Every AI suggestion is reviewed, edited or rejected — with a full audit trail.",
  },
  {
    icon: ShieldCheck,
    title: "Standards by default",
    body: "epubcheck, DAISY Ace and axe run as a hard gate before any artifact reaches your hands.",
  },
  {
    icon: FileJson2,
    title: "Multi-format output",
    body: "Accessible EPUB 3, Excel, JSON, HTML — with Kindle-ready conversion on the roadmap.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#pipeline" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#standards" className="transition-colors hover:text-foreground">
              Standards
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="grain relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
            style={{ background: "var(--glow)" }}
          />
          <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-24 text-center md:pt-32">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Building in the open · Phase 0 live
            </motion.div>

            <h1 className="mx-auto max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
              {["Make every book", "accessible to everyone."].map((line, li) => (
                <span key={line} className="block overflow-hidden pb-1">
                  <motion.span
                    className="block"
                    initial={{ y: "110%" }}
                    animate={{ y: 0 }}
                    transition={{
                      duration: 0.7,
                      delay: 0.15 + li * 0.12,
                      ease: [0.21, 0.47, 0.32, 0.98],
                    }}
                  >
                    {li === 1 ? (
                      <>
                        accessible to{" "}
                        <span className="text-primary">everyone.</span>
                      </>
                    ) : (
                      line
                    )}
                  </motion.span>
                </span>
              ))}
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground"
            >
              Lumen generates alt text, extracts images and converts your content into
              EPUB, Excel, JSON and more — every output checked by humans and validated
              against WCAG, ADA, EPUB Accessibility and PDF/UA.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.58, duration: 0.6 }}
              className="mt-9 flex flex-wrap items-center justify-center gap-3"
            >
              <Button asChild size="lg" className="group">
                <Link href="/register">
                  Start a project
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#pipeline">See how it works</a>
              </Button>
            </motion.div>

            <div id="pipeline" className="mt-24 scroll-mt-24">
              <PipelineDiagram />
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-secondary/40">
          <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-border px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              { value: 285, suffix: "M+", label: "people worldwide live with blindness or low vision" },
              { value: 100, suffix: "%", label: "of exports pass human review before delivery" },
              { value: 4, suffix: "", label: "compliance standards enforced on every artifact" },
            ].map((s) => (
              <Reveal key={s.label} className="px-6 py-10 text-center">
                <div className="text-4xl font-semibold tracking-tight text-primary">
                  <Counter to={s.value} suffix={s.suffix} />
                </div>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {s.label}
                </p>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
          <Reveal className="mb-14 max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-widest text-primary">
              Why Lumen
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              Automation where it shines. Humans where it matters.
            </h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Fully automated accessibility tools hallucinate; manual remediation doesn&rsquo;t
              scale. Lumen pairs the two so publishers get both speed and certainty.
            </p>
          </Reveal>

          <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <StaggerItem key={title}>
                <motion.div
                  whileHover={{ y: -4 }}
                  transition={{ type: "spring", stiffness: 300, damping: 22 }}
                  className="group h-full rounded-2xl border border-border bg-card p-6 shadow-sm hover:border-primary/40 hover:shadow-md"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-foreground transition-transform duration-300 group-hover:scale-110">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-semibold tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <section id="standards" className="scroll-mt-24 border-t border-border bg-secondary/40">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <Reveal>
                <p className="text-sm font-medium uppercase tracking-widest text-primary">
                  Compliance
                </p>
                <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
                  Standards aren&rsquo;t a feature. They&rsquo;re the gate.
                </h2>
                <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
                  Exports are blocked until automated validators and human reviewers agree.
                  Each delivery ships with a signed compliance report showing exactly what was
                  checked and who signed off.
                </p>
                <ul className="mt-8 space-y-4">
                  {[
                    ["WCAG 2.1 AA", "Alt coverage, semantics and contrast verified on every export"],
                    ["EPUB Accessibility 1.1", "AccessMode & accessibilityFeature metadata, Ace-checked"],
                    ["ADA / Section 508", "Remediation evidence for procurement and legal"],
                    ["PDF/UA", "Tagged structure trees validated with veraPDF (Phase 3)"],
                  ].map(([name, desc]) => (
                    <li key={name} className="flex gap-4">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <div>
                        <span className="font-medium">{name}</span>
                        <span className="block text-sm text-muted-foreground">{desc}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal delay={0.15}>
                <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <div className="mb-5 flex items-center justify-between">
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      compliance-report.json
                    </span>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <pre className="overflow-x-auto rounded-xl bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">
{`{
  `}<span className="text-primary">&quot;artifact&quot;</span>{`: `}<span>&quot;fall-backlist-ch3.epub&quot;</span>{`,
  `}<span className="text-success">&quot;wcag_2_1_aa&quot;</span>{`: { `}&quot;passed&quot;{`: true },
  `}<span className="text-success">&quot;epub_a11y_1_1&quot;</span>{`: { `}&quot;passed&quot;{`: true },
  `}<span className="text-success">&quot;ace_checks&quot;</span>{`: { `}&quot;passed&quot;{`: true },
  `}<span className="text-primary">&quot;figures_reviewed&quot;</span>{`: 128,
  `}<span className="text-primary">&quot;human_signoff&quot;</span>{`: {
    `}&quot;reviewer&quot;{`: `}&quot;m.arceneaux&quot;{`,
    `}&quot;at&quot;{`: `}&quot;2026-08-25T09:14Z&quot;{`
  }
}`}</pre>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-24">
          <Reveal className="relative overflow-hidden rounded-3xl border border-border bg-card px-8 py-16 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-96 rounded-full blur-3xl"
              style={{ background: "var(--glow)" }}
            />
            <Eye className="mx-auto h-8 w-8 text-primary" />
            <h2 className="mx-auto mt-5 max-w-xl text-balance text-3xl font-semibold tracking-tight">
              Ready to make your catalog accessible?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              Create an organization, upload your first EPUB and watch the pipeline run.
            </p>
            <Button asChild size="lg" className="group mt-8">
              <Link href="/register">
                Get started free
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <Logo />
          <p>Human-validated accessibility · Built for WCAG, ADA & EPUB standards</p>
        </div>
      </footer>
    </div>
  );
}

function PipelineDiagram() {
  return (
    <div className="relative">
      <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" gap={0.12}>
        {pipeline.map(({ icon: Icon, label, detail }, i) => (
          <StaggerItem key={label} className="relative">
            <motion.div
              whileHover={{ y: -3 }}
              className="relative h-full rounded-2xl border border-border bg-card p-5 text-left shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  0{i + 1}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{detail}</p>
              {i === 3 && (
                <span className="absolute -right-2 -top-2 rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                  required
                </span>
              )}
            </motion.div>
          </StaggerItem>
        ))}
      </Stagger>
      <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 hidden lg:block">
        <div className="relative h-px overflow-visible bg-gradient-to-r from-transparent via-primary/30 to-transparent">
          <span className="animate-flow absolute top-1/2 block h-1.5 w-16 -translate-y-1/2 rounded-full bg-primary/50 blur-[1px]" />
        </div>
      </div>
    </div>
  );
}
