import mammoth from "mammoth";
import { parse as parseHtml } from "node-html-parser";
import { extractSection, type ParsedDocument, type ParsedImageRef } from "./epub-parser.js";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
};

/**
 * DOCX → canonical document shape. Mammoth converts to semantic HTML while
 * embedded media is intercepted and re-keyed under `media/…`, sharing the
 * figure key-space the ingest pipeline already resolves.
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const images = new Map<string, ParsedImageRef>();
  const bytesByName = new Map<string, Buffer>();
  let imageIndex = 0;

  const { value: html } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf: Buffer = await image.readAsBuffer();
        imageIndex += 1;
        const ext = EXT_BY_MIME[image.contentType] ?? ".bin";
        const name = `media/image-${imageIndex}${ext}`;
        images.set(name, { href: name, mediaType: image.contentType });
        bytesByName.set(name, buf);
        return { src: name };
      }),
    }
  );

  const title =
    parseHtml(html).querySelector("h1")?.textContent.trim() ?? null;

  return {
    title,
    language: "en",
    spineHrefs: ["docx.xhtml"],
    images,
    sections: [extractSection(html || "<body></body>", "docx.xhtml", 0)],
    readBinary: async (href) => bytesByName.get(href) ?? null,
  };
}
