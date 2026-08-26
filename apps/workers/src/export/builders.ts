import type { Block, CanonicalIR } from "@lumen/schemas";

export interface ExportFigure {
  assetId: string;
  storageKey: string;
  mimeType: string;
  altText: string;
  longDescription: string | null;
}

export interface ExportInput {
  project: { id: string; name: string; description: string | null };
  documents: (CanonicalIR & { documentId: string })[];
  figures: Map<string, ExportFigure>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildJsonArtifact(input: ExportInput): Buffer {
  const out = {
    generator: "lumen",
    version: 1,
    project: {
      id: input.project.id,
      name: input.project.name,
      description: input.project.description,
    },
    documents: input.documents.map((doc) => ({
      documentId: doc.documentId,
      title: doc.title,
      language: doc.language,
      sections: doc.sections.map((section) => ({
        id: section.id,
        title: section.title,
        sourceHref: section.sourceHref,
        blocks: section.blocks.map((b: Block) =>
          b.kind === "figure"
            ? {
                kind: "figure",
                assetId: b.assetId,
                alt:
                  input.figures.get(b.assetId)?.altText ??
                  b.alt ??
                  "",
                longDescription: input.figures.get(b.assetId)?.longDescription ?? null,
              }
            : b
        ),
      })),
    })),
  };
  return Buffer.from(JSON.stringify(out, null, 2), "utf8");
}

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

export function imageExtFor(mimeType: string): string {
  return MIME_EXT[mimeType] ?? ".bin";
}

/**
 * Packs a minimal but structurally valid EPUB 3 document with approved alt text.
 * Full nav landmarks + validator sidecars arrive with the Phase 1 exit gate.
 */
export async function buildEpubArtifact(
  input: ExportInput,
  readAsset: (storageKey: string) => Promise<Buffer>
): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const usedNames = new Map<string, string>();
  for (const figure of input.figures.values()) {
    const name = `${figure.assetId}${imageExtFor(figure.mimeType)}`;
    usedNames.set(figure.assetId, name);
    zip.file(`OEBPS/images/${name}`, await readAsset(figure.storageKey));
  }

  let navList = "";
  let spine = "";
  let manifest = "";

  const docs = input.documents.length > 0 ? input.documents : [{ documentId: "", title: null, language: "en", sections: [], format: "epub" }] as unknown as CanonicalIR[];

  docs.forEach((doc, docIdx) => {
    doc.sections.forEach((section, sIdx) => {
      const fileName = `section-${docIdx + 1}-${sIdx + 1}.xhtml`;
      manifest += `    <item id="s-${docIdx}-${sIdx}" href="${fileName}" media-type="application/xhtml+xml"/>\n`;
      spine += `    <itemref idref="s-${docIdx}-${sIdx}"/>\n`;
      navList += `      <li><a href="${fileName}">${esc(section.title || `Section ${sIdx + 1}`)}</a></li>\n`;

      const body: string[] = [];
      if (section.title) body.push(`    <h1>${esc(section.title)}</h1>`);
      for (const block of section.blocks) {
        switch (block.kind) {
          case "heading":
            body.push(`    <h${block.level}>${esc(block.text)}</h${block.level}>`);
            break;
          case "paragraph":
            body.push(`    <p>${esc(block.text)}</p>`);
            break;
          case "list_item":
            body.push(`    <p>• ${esc(block.text)}</p>`);
            break;
          case "table": {
            const rowsHtml = block.rows
              .map(
                (row) =>
                  `        <tr>${row
                    .map((cell) => `<td>${esc(cell)}</td>`)
                    .join("")}</tr>`
              )
              .join("\n");
            body.push(`    <table>\n${rowsHtml}\n    </table>`);
            break;
          }
          case "figure": {
            const fig = input.figures.get(block.assetId);
            const imgName = usedNames.get(block.assetId);
            if (!fig || !imgName) break;
            const imgTag = `<img src="images/${imgName}" alt="${esc(fig.altText)}"/>`;
            body.push(
              fig.longDescription
                ? `    <figure id="fig-${block.assetId}">\n      ${imgTag}\n      <figcaption>${esc(
                    fig.altText
                  )}</figcaption>\n      <p class="longdesc">${esc(fig.longDescription)}</p>\n    </figure>`
                : `    <figure id="fig-${block.assetId}">\n      ${imgTag}\n      <figcaption>${esc(
                    fig.altText
                  )}</figcaption>\n    </figure>`
            );
            break;
          }
        }
      }

      zip.file(
        `OEBPS/${fileName}`,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${doc.language}" lang="${doc.language}">
  <head>
    <title>${esc(section.title || `Section ${sIdx + 1}`)}</title>
    <meta charset="utf-8"/>
  </head>
  <body>
${body.join("\n")}
  </body>
</html>`
      );
    });

    if (docIdx === 0) {
      manifest += `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n`;
    }
  });

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
  <head><title>Table of Contents</title><meta charset="utf-8"/></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
${navList}      </ol>
    </nav>
  </body>
</html>`
  );

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:lumen:${input.project.id}</dc:identifier>
    <dc:title>${esc(input.project.name)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
${manifest}  </manifest>
  <spine>
    <itemref idref="nav" linear="no"/>
${spine}  </spine>
</package>`
  );

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
