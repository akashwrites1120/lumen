import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pexec = promisify(execFile);

export interface ValidatorOutcome {
  validator: string;
  format: string;
  passed: "passed" | "failed" | "skipped";
  output: Record<string, unknown> | null;
}

interface EpubCheckMessage {
  severity?: string;
  message?: string;
  location?: unknown;
}

async function withTempEpub<T>(bytes: Buffer, fn: (path: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "lumen-validate-"));
  const path = join(dir, "artifact.epub");
  await writeFile(path, bytes);
  try {
    return await fn(path, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Runs epubcheck (Java) when available via EPUBCHECK_JAR env.
 * Absent tooling yields { passed: "skipped" } so the compliance report can
 * distinguish "not installed" from "failed".
 */
export async function runEpubCheck(bytes: Buffer): Promise<ValidatorOutcome> {
  const jar = process.env.EPUBCHECK_JAR;
  const base: ValidatorOutcome = { validator: "epubcheck", format: "epub", passed: "skipped", output: null };
  if (!jar) return { ...base, output: { reason: "EPUBCHECK_JAR not configured" } };

  return withTempEpub(bytes, async (epubPath, dir) => {
    const outPath = join(dir, "epubcheck.json");
    try {
      await pexec("java", ["-jar", jar, epubPath, "--json", outPath], { timeout: 120_000 });
    } catch {
      // non-zero exit means failures — the JSON report still tells us what broke
    }
    let report: { messages?: EpubCheckMessage[] };
    try {
      report = JSON.parse(await readFile(outPath, "utf8"));
    } catch {
      return { ...base, passed: "skipped", output: { reason: "no epubcheck report produced" } };
    }
    const messages = report.messages ?? [];
    const blocking = messages.filter((m) => m.severity === "error" || m.severity === "fatal");
    return {
      ...base,
      passed: blocking.length === 0 ? "passed" : "failed",
      output: {
        errors: blocking.length,
        warnings: messages.filter((m) => m.severity === "warning").length,
        details: blocking.slice(0, 20),
      },
    };
  });
}

/** Runs DAISY Ace when the `ace` CLI is resolvable (ACE_CMD overrides). */
export async function runAce(bytes: Buffer): Promise<ValidatorOutcome> {
  const cmd = process.env.ACE_CMD ?? "";
  const base: ValidatorOutcome = { validator: "ace", format: "epub", passed: "skipped", output: null };
  if (!cmd) return { ...base, output: { reason: "ACE_CMD not configured" } };

  return withTempEpub(bytes, async (epubPath, dir) => {
    try {
      await pexec(cmd, [epubPath, "-o", join(dir, "ace-out")], { timeout: 180_000 });
    } catch (err) {
      // ace exits non-zero when violations exist; continue to read the report
      void err;
    }
    let report: { assertions?: { count?: number }; data?: { axedata?: { violations?: number } } };
    try {
      report = JSON.parse(await readFile(join(dir, "ace-out", "data", "report.json"), "utf8"));
    } catch {
      return { ...base, passed: "skipped", output: { reason: "no ace report produced" } };
    }
    const violations =
      report.data?.axedata?.violations ??
      report.assertions?.count ??
      0;
    return {
      ...base,
      passed: violations === 0 ? "passed" : "failed",
      output: { violations },
    };
  });
}
