// Minimal HTTP wrapper around Calibre ebook-convert for sidecar deployment.
// POST /  (body: raw EPUB bytes) -> 200 raw AZW3 bytes | 4xx/5xx {"error":"..."}
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const pexec = promisify(execFile);
const EBOOK_CONVERT = process.env.EBOOK_CONVERT ?? "ebook-convert";
const PORT = Number(process.env.PORT ?? 4012);

async function convert(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "azw3-"));
  const inPath = join(dir, "in.epub");
  const outPath = join(dir, "out.azw3");
  try {
    await writeFile(inPath, bytes);
    await pexec(EBOOK_CONVERT, [inPath, outPath, "--output-profile", "kindle_pw3"], {
      timeout: 300_000,
    });
    return await readFile(outPath);
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
      res.end(JSON.stringify({ error: "empty body" }));
      return;
    }
    convert(bytes)
      .then((azw3) => {
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": azw3.byteLength,
        });
        res.end(azw3);
      })
      .catch((err) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err).slice(0, 300) }));
      });
  });
}).listen(PORT, () => console.log(`[export-azw3] listening on :${PORT}`));
