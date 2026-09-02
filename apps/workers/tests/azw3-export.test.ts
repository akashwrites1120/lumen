import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isKindleConversionConfigured, isPlausibleAzw3, runAzw3Conversion } from "../src/export/azw3.js";

function makeAzw3Bytes(len = 2048): Buffer {
  const buf = Buffer.alloc(len, 0x00);
  buf.write("BOOKMOBI", 60, "latin1");
  return buf;
}

describe("isPlausibleAzw3", () => {
  it("accepts bytes carrying the BOOKMOBI marker at offset 60", () => {
    expect(isPlausibleAzw3(makeAzw3Bytes())).toBe(true);
  });

  it("rejects buffers without the magic", () => {
    const buf = Buffer.alloc(2048, 0x00);
    buf.write("ZIPX   ", 60, "latin1");
    expect(isPlausibleAzw3(buf)).toBe(false);
    expect(isPlausibleAzw3(Buffer.from("PK\u0003\u0004 not a kindle book"))).toBe(false);
  });

  it("rejects buffers too short to contain a PalmDB header", () => {
    expect(isPlausibleAzw3(Buffer.alloc(40, 0x00))).toBe(false);
  });
});

describe("runAzw3Conversion", () => {
  const savedUrl = process.env.AZW3_CONVERT_URL;
  const savedCmd = process.env.CALIBRE_CMD;

  beforeEach(() => {
    delete process.env.AZW3_CONVERT_URL;
    delete process.env.CALIBRE_CMD;
  });
  afterEach(() => {
    if (savedUrl === undefined) delete process.env.AZW3_CONVERT_URL;
    else process.env.AZW3_CONVERT_URL = savedUrl;
    if (savedCmd === undefined) delete process.env.CALIBRE_CMD;
    else process.env.CALIBRE_CMD = savedCmd;
  });

  it("isKindleConversionConfigured tracks both envs", () => {
    expect(isKindleConversionConfigured()).toBe(false);
    process.env.CALIBRE_CMD = "ebook-convert";
    expect(isKindleConversionConfigured()).toBe(true);
    delete process.env.CALIBRE_CMD;
    process.env.AZW3_CONVERT_URL = "http://localhost:4012";
    expect(isKindleConversionConfigured()).toBe(true);
  });

  it("reports honestly when no tool is configured", async () => {
    const result = await runAzw3Conversion(Buffer.from("epub-bytes"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not configured");
    }
  });

  it("converts through the HTTP sidecar and validates the returned bytes", async () => {
    process.env.AZW3_CONVERT_URL = "http://sidecar:4012";
    const azw3 = makeAzw3Bytes();
    const fetchMock = (async () =>
      new Response(azw3, { status: 200 })) as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const result = await runAzw3Conversion(Buffer.from("epub-bytes"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tool).toContain("http://sidecar:4012");
        expect(result.bytes.equals(azw3)).toBe(true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats sidecar junk bytes as a conversion failure", async () => {
    process.env.AZW3_CONVERT_URL = "http://sidecar:4012";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(Buffer.from("definitely not kindle"), { status: 200 })) as typeof fetch;
    try {
      const result = await runAzw3Conversion(Buffer.from("epub-bytes"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("BOOKMOBI");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps sidecar http errors to an honest failure reason", async () => {
    process.env.AZW3_CONVERT_URL = "http://sidecar:4012";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as typeof fetch;
    try {
      const result = await runAzw3Conversion(Buffer.from("epub-bytes"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("http 500");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
