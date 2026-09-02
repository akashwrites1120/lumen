import type { Block, CanonicalIR } from "@lumen/schemas";
import type { ExportInput } from "./builders.js";

/**
 * Build a single-file HTML accessibility export.
 *
 * All images are inlined as data URIs so the resulting file is portable
 * (one file, no companion assets) and the approved alt text travels
 * with the image it describes. Layout follows the document's section
 * order; figures are nested where they appear in the source IR.
 */
export async function buildHtmlArtifact(
  input: ExportInput,
  readAsset: (storageKey: string) => Promise<Buffer>
): Promise<Buffer> {
  const out: string[] = [];
  out.push(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(input.project.name)} — accessibility export</title>
<style>
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1rem; color: #1f1f1f; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.2; }
  figure { margin: 1.5rem 0; }
  figcaption { font-size: 0.95em; color: #444; }
  table { border-collapse: collapse; margin: 1rem 0; }
  td, th { border: 1px solid #ccc; padding: 0.25rem 0.5rem; }
  nav.toc { background: #f6f6f6; padding: 1rem 1.25rem; border-radius: 6px; }
  nav.toc ol { padding-left: 1.25rem; }
  .longdesc { font-size: 0.9em; color: #333; }
</style>
</head>
<body>
<header>
  <h1>${esc(input.project.name)}</h1>
  ${input.project.description ? `<p>${esc(input.project.description)}</p>` : ""}
</header>
`);

  out.push(buildToc(input));

  for (const doc of input.documents) {
    out.push(`<section aria-label="${esc(doc.title ?? "Document")}">`);
    if (doc.title) out.push(`<h2>${esc(doc.title)}</h2>`);

    for (const section of doc.sections) {
      out.push(`<article aria-labelledby="sec-${escAttr(section.id)}">`);
      if (section.title) out.push(`<h3 id="sec-${escAttr(section.id)}">${esc(section.title)}</h3>`);
      for (const block of section.blocks) {
        out.push(await renderBlock(block, input, readAsset));
      }
      out.push(`</article>`);
    }
    out.push(`</section>`);
  }

  out.push(`</body></html>`);
  return Buffer.from(out.join("\n"), "utf8");
}

function buildToc(input: ExportInput): string {
  const items: string[] = [];
  for (const doc of input.documents) {
    for (const section of doc.sections) {
      items.push(`<li><a href="#sec-${escAttr(section.id)}">${esc(section.title || "(untitled section)")}</a></li>`);
    }
  }
  if (items.length === 0) return "";
  return `<nav class="toc" aria-label="Table of contents"><h2>Contents</h2><ol>${items.join("")}</ol></nav>`;
}

async function renderBlock(
  block: Block,
  input: ExportInput,
  readAsset: (storageKey: string) => Promise<Buffer>
): Promise<string> {
  switch (block.kind) {
    case "heading":
      return `<h${block.level}>${esc(block.text)}</h${block.level}>`;
    case "paragraph":
      return `<p>${esc(block.text)}</p>`;
    case "list_item":
      return `<p>• ${esc(block.text)}</p>`;
    case "table": {
      const rows = block.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`
        )
        .join("");
      return `<table>${rows}</table>`;
    }
    case "figure": {
      const fig = input.figures.get(block.assetId);
      if (!fig) return `<!-- figure ${block.assetId} missing from approved set -->`;
      const buf = await readAsset(fig.storageKey);
      const dataUri = `data:${fig.mimeType};base64,${buf.toString("base64")}`;
      const alt = fig.altText || block.alt || "";
      const long = fig.longDescription
        ? `<p class="longdesc">${esc(fig.longDescription)}</p>`
        : "";
      return `<figure id="fig-${escAttr(block.assetId)}">
  <img src="${dataUri}" alt="${escAttr(alt)}"/>
  <figcaption>${esc(alt)}</figcaption>
  ${long}
</figure>`;
    }
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return esc(s);
}
