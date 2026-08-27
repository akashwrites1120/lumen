// DAISY Ace HTTP wrapper for sidecar deployment.
// POST /  (body: raw EPUB bytes) -> {"passed":"passed|failed|skipped","output":{...}}
// Expects the Ace CLI bundle mounted or baked at /opt/ace with an `ace` entrypoint.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const pexec = promisify(execFile);
const ACE_CMD = process.env.ACE_CMD ?? "/opt/ace/ace";
const PORT = Number(process.env.PORT ?? 4011);

async function validate(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "ace-"));
  const epubPath = join(dir, "artifact.epub");
  const outDir = join(dir, "ace-out");
  try {
    await writeFile(epubPath, bytes);
    try {
      await pexec(ACE_CMD, ["--verbose", epubPath, "-o", outDir], { timeout: 240_000 });
    } catch {
      // ace exits non-zero on violations; the report still tells us the count
    }
    let report;
    try {
      report = JSON.parse(await readFile(join(outDir, "data", "report.json"), "utf8"));
    } catch {
      return { passed: "skipped", output: { reason: "no ace report produced" } };
    }
    const violations =
      report.data?.axedata?.violations ?? report.assertions?.count ?? 0;
    return {
      passed: violations === 0 ? "passed" : "failed",
      output: { violations },
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
}).listen(PORT, () => console.log(`[validator-ace] listening on :${PORT}`));
