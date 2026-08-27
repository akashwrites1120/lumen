import JSZip from "jszip";
import { parse, HTMLElement } from "node-html-parser";

export interface ParsedImageRef {
  /** Zip-resolved path — the canonical key shared with figure blocks. */
  href: string;
  mediaType: string;
}

export interface ParsedSection {
  id: string;
  title: string;
  sourceHref: string;
  blocks: SectionBlock[];
}

export type SectionBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list_item"; ordered: boolean; text: string }
  | { kind: "figure"; assetHref: string; alt: string | null };

export interface ParsedEpub {
  title: string | null;
  language: string;
  spineHrefs: string[];
  images: Map<string, ParsedImageRef>;
  sections: ParsedSection[];
  readBinary: (zipPath: string) => Promise<Buffer | null>;
}

/** Structural shape shared by every source-format parser (epub/docx/pdf). */
export type ParsedDocument = ParsedEpub;

const XHTML_MEDIA = ["application/xhtml+xml", "text/html"];

export async function parseEpub(buffer: Buffer): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(buffer);

  const containerXml = await readEntry(zip, "META-INF/container.xml");
  const opfPath = extractOpfPath(containerXml);
  const opfDir = posixDir(opfPath);
  const opfXml = await readEntry(zip, opfPath);

  const docTitle = firstTagText(opfXml, "dc:title") ?? firstTagText(opfXml, "title");
  const language =
    firstTagText(opfXml, "dc:language") ?? firstTagText(opfXml, "language") ?? "en";

  const manifestItems = parseManifest(opfXml);
  const isNav = (item: ManifestItem) =>
    /\bproperties="[^"]*\bnav\b/.test(item.rawTag ?? "") ||
    /\bepub:type="[^"]*\btoc\b/.test(item.rawTag ?? "");
  const zipPathOf = (item: ManifestItem) => resolveZipPath(opfDir, item.href);

  const spineHrefs = parseSpine(opfXml)
    .map((idref) => manifestItems.get(idref))
    .filter(
      (item): item is ManifestItem =>
        !!item && XHTML_MEDIA.includes(item.mediaType) && !isNav(item)
    )
    .map((item) => zipPathOf(item));

  const images = new Map<string, ParsedImageRef>();
  for (const item of manifestItems.values()) {
    if (item.mediaType.startsWith("image/")) {
      const resolved = zipPathOf(item);
      images.set(resolved, { href: resolved, mediaType: item.mediaType });
    }
  }

  const sections: ParsedSection[] = [];
  for (const [index, zipPath] of spineHrefs.entries()) {
    const html = await readEntry(zip, zipPath);
    sections.push(extractSection(html, zipPath, index));
  }

  async function readBinary(href: string): Promise<Buffer | null> {
    const entry = zip.file(resolveZipPath(opfDir, href));
    if (!entry) return null;
    return entry.async("nodebuffer");
  }

  return { title: docTitle, language, spineHrefs, images, sections, readBinary };
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  rawTag?: string;
}

function extractOpfPath(containerXml: string): string {
  const match = containerXml.match(/full-path="([^"]+)"/);
  if (!match?.[1]) throw new Error("container.xml missing rootfile full-path");
  return match[1];
}

function parseManifest(opfXml: string): Map<string, ManifestItem> {
  const items = new Map<string, ManifestItem>();
  const re = /<item\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(opfXml))) {
    const tag = m[0];
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    const mediaType = attr(tag, "media-type");
    if (id && href && mediaType) {
      items.set(id, { id, href: decodeURIComponent(href), mediaType, rawTag: tag });
    }
  }
  return items;
}

function parseSpine(opfXml: string): string[] {
  const ids: string[] = [];
  const re = /<itemref\b[^>]*idref="([^"]+)"[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(opfXml))) {
    if (m[1]) ids.push(m[1]);
  }
  return ids;
}

export function extractSection(html: string, sectionZipPath: string, index: number): ParsedSection {
  const root = parse(html);
  const title =
    root.querySelector("h1")?.textContent.trim() ??
    root.querySelector("title")?.textContent.trim() ??
    `Section ${index + 1}`;

  const sectionDir = posixDir(sectionZipPath);
  const blocks: SectionBlock[] = [];
  const body = root.querySelector("body") ?? root;

  walk(body);

  function walk(node: HTMLElement): void {
    for (const child of node.childNodes) {
      if (!(child instanceof HTMLElement)) continue;
      const tag = child.rawTagName?.toLowerCase() ?? "";
      if (/^h[1-6]$/.test(tag)) {
        blocks.push({ kind: "heading", level: Number(tag[1]), text: clean(child.textContent) });
        continue;
      }
      if (tag === "p" || tag === "blockquote") {
        pushInlineBlocks(child);
        continue;
      }
      if (tag === "li") {
        const parent = child.parentNode;
        const parentTag =
          parent instanceof HTMLElement ? parent.rawTagName?.toLowerCase() : "";
        blocks.push({
          kind: "list_item",
          ordered: parentTag === "ol",
          text: clean(child.textContent),
        });
        continue;
      }
      if (tag === "img" || tag === "image") {
        pushFigure(child);
        continue;
      }
      if (child.childNodes.length > 0) {
        walk(child);
      }
    }
  }

  function pushInlineBlocks(el: HTMLElement): void {
    const imgs = el.querySelectorAll("img, image");
    if (imgs.length > 0) {
      for (const img of imgs) pushFigure(img);
    }
    const text = clean(el.textContent);
    if (text) blocks.push({ kind: "paragraph", text });
  }

  function pushFigure(img: HTMLElement): void {
    const rawSrc =
      img.getAttribute("src") ??
      img.getAttribute("xlink:href") ??
      img.getAttribute("href");
    if (!rawSrc) return;
    // resolve relative to the containing document so the key matches the
    // zip-resolved image manifest keys
    const resolved = resolveZipPath(sectionDir, decodeURIComponent(rawSrc.split("#")[0]!));
    blocks.push({
      kind: "figure",
      assetHref: resolved,
      alt: img.getAttribute("alt") ?? null,
    });
  }

  return { id: `sec-${index}`, title, sourceHref: sectionZipPath, blocks: blocks.filter(keepMeaningful) };

  function keepMeaningful(b: SectionBlock): boolean {
    if (b.kind === "figure") return true;
    return b.text.length > 0;
  }
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}="([^"]*)"`);
  return re.exec(tag)?.[1] ?? null;
}

function firstTagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`);
  const value = re.exec(xml)?.[1]?.trim();
  return value ? value : null;
}

function posixDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function resolveZipPath(baseDir: string, href: string): string {
  const parts = `${baseDir}/${href}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

async function readEntry(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`epub entry not found: ${path}`);
  return entry.async("string");
}
