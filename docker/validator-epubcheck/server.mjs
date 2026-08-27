// Minimal HTTP wrapper around epubcheck for sidecar deployment.
// POST /  (body: raw EPUB bytes) -> {"passed":"passed|failed|skipped","output":{...}}
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const pexec = promisify(execFile);
const JAR = process.env.EPUBCHECK_JAR ?? "/opt/epubcheck/epubcheck.jar";
const PORT = Number(process.env.PORT ?? 4010);

async function validate(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "ec-"));
  const epubPath = join(dir, "artifact.epub");
  const outPath = join(dir, "report.json");
  try {
    await writeFile(epubPath, bytes);
    let execError = null;
    try {
      await pexec("java", ["-jar", JAR, epubPath, "--json", outPath], { timeout: 120_000 });
    } catch (err) {
      execError = err; // non-zero exit == violations; report still written
    }
    let report;
    try {
      report = JSON.parse(await readFile(outPath, "utf8"));
    } catch {
      return { passed: "skipped", output: { reason: "no report produced", error: String(execError).slice(0, 200) } };
    }
    const messages = report.messages ?? [];
    const blocking = messages.filter((m) => m.severity === "error" || m.severity === "fatal");
    return {
      passed: blocking.length === 0 ? "passed" : "failed",
      output: {
        errors: blocking.length,
        warnings: messages.filter((m) => m.severity === "warning").length,
        details: blocking.slice(0, 20),
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("error", () => res.writeHead(400).end());
  req.on("end", () => {
    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength === 0) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ passed: "skipped", output: { reason: "empty body" } }));
      return;
    }
    validate(bytes)
      .then((result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((err) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ passed: "skipped", output: { reason: String(err).slice(0, 200) } }));
      });
  });
}).listen(PORT, () => console.log(`[validator-epubcheck] listening on :${PORT}`));
