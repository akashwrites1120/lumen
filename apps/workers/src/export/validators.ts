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

export interface HttpValidatorConfig {
  url: string;
  timeoutMs?: number;
}

/**
 * Posts raw artifact bytes to an HTTP validator sidecar.
 * Expected response: {"passed":"passed|failed|skipped","output":{...}}
 */
export async function runHttpValidator(
  validator: string,
  format: string,
  bytes: Buffer,
  cfg: HttpValidatorConfig
): Promise<ValidatorOutcome> {
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "content-type": format === "epub" ? "application/epub+zip" : "application/octet-stream",
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 180_000),
    });
    if (!res.ok) {
      return {
        validator,
        format,
        passed: "skipped",
        output: { reason: `sidecar http ${res.status}` },
      };
    }
    const body = (await res.json()) as { passed?: string; output?: unknown };
    const passed =
      body.passed === "passed" || body.passed === "failed" ? body.passed : "skipped";
    return { validator, format, passed, output: (body.output as Record<string, unknown>) ?? null };
  } catch (err) {
    return {
      validator,
      format,
      passed: "skipped",
      output: { reason: `sidecar unreachable: ${String(err).slice(0, 160)}` },
    };
  }
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
 * epubcheck precedence: HTTP sidecar (EPUBCHECK_URL) → local jar (EPUBCHECK_JAR)
 * → explicit skipped so reports can tell "not installed" from "failed".
 */
export async function runEpubCheck(bytes: Buffer): Promise<ValidatorOutcome> {
  const httpUrl = process.env.EPUBCHECK_URL;
  if (httpUrl) {
    const outcome = await runHttpValidator("epubcheck", "epub", bytes, { url: httpUrl });
    return { ...outcome, validator: "epubcheck" };
  }

  const jar = process.env.EPUBCHECK_JAR;
  const base: ValidatorOutcome = { validator: "epubcheck", format: "epub", passed: "skipped", output: null };
  if (!jar) return { ...base, output: { reason: "EPUBCHECK_URL/EPUBCHECK_JAR not configured" } };

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

/** Ace precedence: HTTP sidecar (ACE_URL) → local CLI (ACE_CMD) → skipped. */
export async function runAce(bytes: Buffer): Promise<ValidatorOutcome> {
  const httpUrl = process.env.ACE_URL;
  if (httpUrl) {
    const outcome = await runHttpValidator("ace", "epub", bytes, { url: httpUrl });
    return { ...outcome, validator: "ace" };
  }

  const cmd = process.env.ACE_CMD ?? "";
  const base: ValidatorOutcome = { validator: "ace", format: "epub", passed: "skipped", output: null };
  if (!cmd) return { ...base, output: { reason: "ACE_URL/ACE_CMD not configured" } };

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
