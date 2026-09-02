import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifications, usageEvents } from "@lumen/db";
import { maybeAlertMonthlySpend, monthStart, spendAlertThresholdFromEnv } from "../src/spend-alert.js";

/**
 * Fake db that understands the two query shapes maybeAlertMonthlySpend uses:
 *   - usage sum:   select().from(usageEvents).where(...)            → awaited
 *   - alert check: select().from(notifications).where(...).limit(1) → awaited
 * dispatching on the table identity passed to .from().
 */
function makeFakeDb(opts: { monthlyUnits: number; existingAlerts: number }) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    select: (_selection?: unknown) => ({
      from: (table: unknown) => ({
        where: () => {
          const awaited =
            table === usageEvents
              ? Promise.resolve([{ units: opts.monthlyUnits }])
              : Promise.resolve(
                  opts.existingAlerts > 0 ? [{ id: "alert-1" }] : []
                );
          return {
            limit: () => awaited,
            then: (
              resolve: (v: unknown) => void,
              reject?: (e: unknown) => void
            ) => awaited.then(resolve, reject),
          };
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db, inserted };
}

describe("spendAlertThresholdFromEnv", () => {
  const saved = process.env.ORG_MONTHLY_VISION_ALERT;
  beforeEach(() => {
    delete process.env.ORG_MONTHLY_VISION_ALERT;
  });

  it("is disabled (0) by default and for invalid values", () => {
    expect(spendAlertThresholdFromEnv()).toBe(0);
    process.env.ORG_MONTHLY_VISION_ALERT = "-3";
    expect(spendAlertThresholdFromEnv()).toBe(0);
    process.env.ORG_MONTHLY_VISION_ALERT = "abc";
    expect(spendAlertThresholdFromEnv()).toBe(0);
  });

  it("parses positive integers", () => {
    process.env.ORG_MONTHLY_VISION_ALERT = "5000";
    expect(spendAlertThresholdFromEnv()).toBe(5000);
    if (saved !== undefined) process.env.ORG_MONTHLY_VISION_ALERT = saved;
  });
});

describe("monthStart", () => {
  it("truncates to the first day of the month", () => {
    const start = monthStart(new Date("2026-09-02T15:30:00"));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(8);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
  });
});

describe("maybeAlertMonthlySpend", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("is a no-op when disabled", async () => {
    const { db, inserted } = makeFakeDb({ monthlyUnits: 10_000, existingAlerts: 0 });
    await expect(
      maybeAlertMonthlySpend(db as unknown as never, "org-1", { threshold: 0 })
    ).resolves.toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("does not alert below the threshold", async () => {
    const { db, inserted } = makeFakeDb({ monthlyUnits: 999, existingAlerts: 0 });
    await expect(
      maybeAlertMonthlySpend(db as unknown as never, "org-1", { threshold: 1000 })
    ).resolves.toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("inserts one org-wide usage.alert when the threshold is crossed", async () => {
    const { db, inserted } = makeFakeDb({ monthlyUnits: 1200, existingAlerts: 0 });
    await expect(
      maybeAlertMonthlySpend(db as unknown as never, "org-1", { threshold: 1000 })
    ).resolves.toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organizationId: "org-1",
      userId: null,
      kind: "usage.alert",
      subjectType: "organization",
      subjectId: "org-1",
    });
    expect(String(inserted[0]?.title)).toContain("1200");
  });

  it("never duplicates the alert within the same calendar month", async () => {
    const { db, inserted } = makeFakeDb({ monthlyUnits: 1200, existingAlerts: 1 });
    await expect(
      maybeAlertMonthlySpend(db as unknown as never, "org-1", { threshold: 1000 })
    ).resolves.toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("swallows db failures instead of breaking the draft job", async () => {
    const brokenDb = {
      select: () => {
        throw new Error("db down");
      },
    };
    await expect(
      maybeAlertMonthlySpend(brokenDb as unknown as never, "org-1", { threshold: 10 })
    ).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});
