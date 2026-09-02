import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordUsage } from "../src/usage.js";

interface Inserted {
  organizationId: string;
  kind: string;
  units: number;
  subjectType: string | null;
  subjectId: string | null;
  detail: unknown;
}

function makeFakeDb() {
  const inserted: Inserted[] = [];
  const db = {
    insert: () => ({
      values: (v: Inserted) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db, inserted };
}

describe("recordUsage", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("appends a row with the expected fields", async () => {
    const { db, inserted } = makeFakeDb();
    await recordUsage(db as unknown as never, {
      organizationId: "org-1",
      kind: "vision_call",
      subjectType: "asset",
      subjectId: "asset-1",
      detail: { provider: "openai" },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual({
      organizationId: "org-1",
      kind: "vision_call",
      units: 1,
      subjectType: "asset",
      subjectId: "asset-1",
      detail: { provider: "openai" },
    });
  });

  it("honors explicit units and serializes detail as a record", async () => {
    const { db, inserted } = makeFakeDb();
    await recordUsage(db as unknown as never, {
      organizationId: "org-2",
      kind: "export_artifact",
      units: 3,
      detail: { format: "epub" },
    });
    expect(inserted[0]?.units).toBe(3);
    expect(inserted[0]?.detail).toEqual({ format: "epub" });
  });

  it("swallows db errors and logs a warning instead of throwing", async () => {
    const db = {
      insert: () => ({
        values: () => {
          throw new Error("db down");
        },
      }),
    };
    await expect(
      recordUsage(db as unknown as never, { organizationId: "org-3", kind: "webhook_delivery" })
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
