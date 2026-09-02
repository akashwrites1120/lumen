import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pexec = promisify(execFile);

export type Azw3ConversionResult =
  | { ok: true; bytes: Buffer; tool: string }
  | { ok: false; reason: string };

/**
 * A plausible AZW3 (KF8) container: the PalmDB header carries the
 * "BOOKMOBI" type marker at offset 60. This is the internal structural
 * gate run on every converted artifact before it is stored.
 */
export function isPlausibleAzw3(bytes: Buffer): boolean {
  return bytes.byteLength >= 78 && bytes.subarray(60, 68).toString("latin1") === "BOOKMOBI";
}

/** True when any Kindle conversion tool is configured for the workers. */
export function isKindleConversionConfigured(): boolean {
  return Boolean(process.env.AZW3_CONVERT_URL || process.env.CALIBRE_CMD);
}

/**
 * Kindle (AZW3) conversion, mirroring the validator precedence:
 * HTTP sidecar (AZW3_CONVERT_URL) → local Calibre CLI (CALIBRE_CMD, e.g.
 * `ebook-convert`) → honest `{ ok: false }` so reports can tell
 * "not configured" from "conversion failed".
 */
export async function runAzw3Conversion(epub: Buffer): Promise<Azw3ConversionResult> {
  const url = process.env.AZW3_CONVERT_URL;
  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/epub+zip" },
        body: new Uint8Array(epub),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) {
        return { ok: false, reason: `azw3 sidecar http ${res.status}` };
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!isPlausibleAzw3(bytes)) {
        return { ok: false, reason: "azw3 sidecar produced bytes without BOOKMOBI magic" };
      }
      return { ok: true, bytes, tool: `sidecar ${url}` };
    } catch (err) {
      return { ok: false, reason: `azw3 sidecar unreachable: ${String(err).slice(0, 160)}` };
    }
  }

  const cmd = process.env.CALIBRE_CMD ?? "";
  if (!cmd) {
    return { ok: false, reason: "AZW3_CONVERT_URL/CALIBRE_CMD not configured" };
  }

  return withTempEpub(epub, async (epubPath, dir) => {
    const outPath = join(dir, "artifact.azw3");
    try {
      await pexec(cmd, [epubPath, outPath, "--output-profile", "kindle_pw3"], { timeout: 300_000 });
    } catch (err) {
      return { ok: false, reason: `calibre failed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` };
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(outPath);
    } catch {
      return { ok: false, reason: "calibre produced no output file" };
    }
    if (!isPlausibleAzw3(bytes)) {
      return { ok: false, reason: "calibre produced bytes without BOOKMOBI magic" };
    }
    return { ok: true, bytes, tool: `calibre ${cmd}` };
  });
}

async function withTempEpub<T>(bytes: Buffer, fn: (path: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "lumen-azw3-"));
  const path = join(dir, "artifact.epub");
  await writeFile(path, bytes);
  try {
    return await fn(path, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
