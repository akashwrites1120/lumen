import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parseEpub } from "../../src/epub-parser.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const FIXTURE_PATH = resolve(REPO_ROOT, ".data/fixture/golden.epub");

function ensureFixture(): Buffer {
  if (!existsSync(FIXTURE_PATH)) {
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    execSync(`node scripts/make-fixture-epub.mjs ${FIXTURE_PATH}`, {
      stdio: "inherit",
      cwd: REPO_ROOT,
    });
  }
  return readFileSync(FIXTURE_PATH);
}

describe("golden corpus — EPUB ingest", () => {
  let ir: Awaited<ReturnType<typeof parseEpub>>;

  beforeAll(async () => {
    const buf = ensureFixture();
    ir = await parseEpub(buf);
  }, 30_000);

  it("extracts the package metadata", () => {
    expect(ir.title).toBe("Lumen Fixture Book");
    expect(ir.language).toBe("en");
  });

  it("resolves the spine to zip paths, excluding the nav document", () => {
    expect(ir.spineHrefs).toEqual([
      "OEBPS/ch1.xhtml",
      "OEBPS/ch2.xhtml",
    ]);
  });

  it("indexes every manifest image by its zip-resolved path", () => {
    expect([...ir.images.keys()].sort()).toEqual([
      "OEBPS/images/chart-bars.png",
      "OEBPS/images/duplicate-of-sunset.png",
      "OEBPS/images/sunset.png",
    ]);
    for (const img of ir.images.values()) {
      expect(img.mediaType).toBe("image/png");
    }
  });

  it("captures both sections with their block kinds", () => {
    expect(ir.sections.map((s) => s.title)).toEqual([
      "Chapter One: The Beginning",
      "Chapter Two: The Data",
    ]);

    const ch1 = ir.sections[0]!;
    expect(ch1.blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "figure",
      "paragraph",
      "list_item",
      "list_item",
    ]);
  });

  it("binds figures to zip-resolved image keys (not document-relative paths)", () => {
    const figures = ir.sections
      .flatMap((s) => s.blocks)
      .filter((b): b is Extract<typeof s.blocks[number], { kind: "figure" }> => b.kind === "figure")
      .map((b) => b.assetHref);

    expect(figures).toEqual([
      "OEBPS/images/sunset.png",
      "OEBPS/images/chart-bars.png",
      "OEBPS/images/duplicate-of-sunset.png",
    ]);
  });

  it("returns binary contents for indexed images", async () => {
    const buf = await ir.readBinary("OEBPS/images/sunset.png");
    expect(buf).not.toBeNull();
    // PNG magic header
    expect(buf!.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("returns null for unknown zip paths (no throw)", async () => {
    const buf = await ir.readBinary("OEBPS/images/does-not-exist.png");
    expect(buf).toBeNull();
  });
});
