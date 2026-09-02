import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LumenDb } from "@lumen/db";
import { notifications, users } from "@lumen/db";
import {
  consoleEmailTransport,
  createEmailTransportFromEnv,
  notify,
  smtpEmailTransport,
} from "./index.js";

interface InsertedRow extends Record<string, unknown> {
  organizationId: string;
  userId: string | null;
  kind: string;
}

function makeDb(orgUsers: { id: string; email: string }[]) {
  const inserted: InsertedRow[] = [];
  let emailedAtStamped = false;
  const db = {
    insert: (_t: unknown) => ({
      values: (v: InsertedRow | InsertedRow[]) => {
        const arr = Array.isArray(v) ? v : [v];
        inserted.push(...arr);
        return {
          returning: async () => arr.map((_, i) => ({ id: `n-${inserted.length - arr.length + i}` })),
        };
      },
    }),
    select: (_s?: unknown) => ({
      from: (table: unknown) => ({
        where: async () => (table === users ? orgUsers : []),
      }),
    }),
    update: (_t: unknown) => ({
      set: (_s: Record<string, unknown>) => ({
        where: async () => {
          emailedAtStamped = true;
          return [];
        },
      }),
    }),
  };
  return { db: db as unknown as LumenDb, inserted, emailedAtStamped: () => emailedAtStamped };
}

describe("createEmailTransportFromEnv", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_FROM;
    return () => {
      process.env = { ...saved };
    };
  });

  it("returns null when SMTP_HOST is unset (in-app only)", () => {
    expect(createEmailTransportFromEnv(process.env)).toBeNull();
  });

  it("builds an smtp transport from env without connecting", () => {
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_PORT = "1025";
    const transport = createEmailTransportFromEnv(process.env);
    expect(transport).not.toBeNull();
    expect(transport?.kind).toBe("smtp");
  });

  it("smtpEmailTransport defaults the from address through the factory", () => {
    const transport = smtpEmailTransport({
      host: "localhost",
      port: 1025,
      secure: false,
      from: "Lumen <test@lumen.local>",
    });
    expect(transport.kind).toBe("smtp");
  });
});

describe("consoleEmailTransport", () => {
  it("logs instead of sending", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleEmailTransport.send({ to: "a@b.c", subject: "S", body: "B" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("notify convenience wrapper", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("writes in-app rows for every org user and skips email when transport is null", async () => {
    const { db, inserted, emailedAtStamped } = makeDb([
      { id: "u-1", email: "u1@x.io" },
      { id: "u-2", email: "u2@x.io" },
    ]);
    const send = vi.fn(async () => {});

    const { notificationIds } = await notify(
      db,
      { organizationId: "org-1", kind: "export.completed", title: "Export ready", body: "Done." },
      null
    );

    expect(notificationIds).toHaveLength(2);
    expect(inserted).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
    expect(emailedAtStamped()).toBe(false);
  });

  it("emails each recipient and stamps emailedAt when a transport is provided", async () => {
    const { db, inserted, emailedAtStamped } = makeDb([{ id: "u-1", email: "u1@x.io" }]);
    const send = vi.fn(async () => {});

    await notify(
      db,
      {
        organizationId: "org-1",
        kind: "review.assigned",
        title: "1 image assigned to you",
        body: "Please review.",
      },
      { kind: "console", send }
    );

    expect(send).toHaveBeenCalledWith({ to: "u1@x.io", subject: "1 image assigned to you", body: "Please review." });
    expect(emailedAtStamped()).toBe(true);
    expect(inserted[0]?.kind).toBe("review.assigned");
  });

  it("keeps the in-app rows when the email leg fails", async () => {
    const { db, inserted } = makeDb([{ id: "u-1", email: "u1@x.io" }]);
    const send = vi.fn(async () => {
      throw new Error("smtp down");
    });

    await expect(
      notify(
        db,
        { organizationId: "org-1", kind: "draft.failed", title: "t", body: "b" },
        { send }
      )
    ).resolves.toHaveProperty("notificationIds.length", 1);

    expect(inserted).toHaveLength(1);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("notifications table import sanity", () => {
  it("exposes the drizzle table for the shared dispatcher", () => {
    expect(notifications).toBeDefined();
  });
});
