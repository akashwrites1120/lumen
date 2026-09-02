import { describe, it, expect, beforeEach, vi } from "vitest";
import { dispatchNotification, consoleEmailTransport } from "../src/notifications.js";

describe("dispatchNotification", () => {
  let inserted: unknown[];
  let emailedAtIds: string[];
  let listedUserIds: string[];
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    inserted = [];
    emailedAtIds = [];
    listedUserIds = [];
    sendSpy = vi.fn(async () => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  function makeDb() {
    return {
      insert: (_t: unknown) => ({
        values: (v: unknown) => {
          const arr = Array.isArray(v) ? v : [v];
          inserted.push(...arr);
          const ids = arr.map((_, i) => `n-${inserted.length - arr.length + i}`);
          return { returning: async () => ids.map((id) => ({ id })) };
        },
      }),
      // The dispatcher's listOrgUserIds path is exercised in only one of the
      // tests below; for the userId-set path we don't need it to work, so
      // we throw so an accidental call fails the test loudly.
      select: () => ({
        from: () => ({
          where: async () => {
            // listOrgUserIds ends with .where(); listNotifications chains .orderBy().limit()
            return listedUserIds.map((id) => ({ id }));
          },
          orderBy: () => ({
            limit: async () => listedUserIds.map((id) => ({ id })),
          }),
        }),
      }),
      update: (_t: unknown) => ({
        set: (s: { emailedAt?: Date }) => {
          if (s.emailedAt) emailedAtIds.push("emailed");
          return {
            where: () => ({
              returning: async () => [{ id: "x" }],
            }),
          };
        },
      }),
    };
  }

  it("writes one row per recipient when userId is null", async () => {
    listedUserIds = ["u-1", "u-2"];
    const db = makeDb();

    const { notificationIds } = await dispatchNotification(db as unknown as never, {
      organizationId: "org-1",
      kind: "export.completed",
      title: "Export ready",
      body: "Your EPUB is ready.",
    });

    expect(notificationIds).toHaveLength(2);
    expect(inserted).toHaveLength(2);
    expect((inserted[0] as { userId: string }).userId).toBe("u-1");
    expect((inserted[1] as { userId: string }).userId).toBe("u-2");
  });

  it("writes a single row when userId is provided", async () => {
    const db = makeDb();
    const { notificationIds } = await dispatchNotification(db as unknown as never, {
      organizationId: "org-1",
      userId: "u-9",
      kind: "review.assigned",
      title: "New review",
      body: "Asset 42 was assigned to you.",
      subjectType: "asset",
      subjectId: "asset-42",
    });
    expect(notificationIds).toHaveLength(1);
    expect(inserted).toHaveLength(1);
    expect((inserted[0] as { userId: string; subjectId: string }).userId).toBe("u-9");
    expect((inserted[0] as { subjectId: string }).subjectId).toBe("asset-42");
  });

  it("sends email through the transport when provided", async () => {
    listedUserIds = ["u-1"];
    const db = makeDb();

    await dispatchNotification(
      db as unknown as never,
      {
        organizationId: "org-1",
        kind: "export.completed",
        title: "Export ready",
        body: "Your EPUB is ready.",
      },
      {
        email: {
          transport: { send: sendSpy },
          resolveRecipients: async (uids) => uids.map((u) => ({ userId: u, email: `${u}@example.com` })),
        },
      }
    );

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith({ to: "u-1@example.com", subject: "Export ready", body: "Your EPUB is ready." });
    expect(emailedAtIds).toHaveLength(1);
  });

  it("swallows email transport failures and still records the in-app row", async () => {
    listedUserIds = ["u-1"];
    const db = makeDb();
    const failingTransport = { send: vi.fn(async () => { throw new Error("smtp down"); }) };

    await expect(
      dispatchNotification(
        db as unknown as never,
        { organizationId: "org-1", kind: "export.completed", title: "t", body: "b" },
        {
          email: {
            transport: failingTransport,
            resolveRecipients: async (uids) => uids.map((u) => ({ userId: u, email: `${u}@x` })),
          },
        }
      )
    ).resolves.toBeDefined();

    expect(inserted).toHaveLength(1);
    expect(console.warn).toHaveBeenCalled();
  });

  it("consoleEmailTransport logs to stdout", async () => {
    await consoleEmailTransport.send({ to: "a@b", subject: "S", body: "B" });
    expect(console.log).toHaveBeenCalled();
  });
});
