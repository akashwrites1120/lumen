import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  notifications,
  users,
  type LumenDb,
  type notificationKind,
} from "@lumen/db";

export type NotificationKind = (typeof notificationKind.enumValues)[number];

export interface DispatchInput {
  organizationId: string;
  /** If null, the notification is org-wide (visible to all members). */
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  subjectType?: string;
  subjectId?: string;
}

export interface EmailTransport {
  send(msg: { to: string; subject: string; body: string }): Promise<void>;
}

/**
 * No-op transport used until SMTP/SES is wired. Logs to stdout so the
 * delivery path is visible during local dev.
 */
export const consoleEmailTransport: EmailTransport = {
  async send(msg) {
    console.log(`[email:noop] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
  },
};

interface ResolvedTarget {
  userId: string;
  email: string;
}

interface DispatchOptions {
  /** When true, also email the recipients via the provided transport. */
  email?: { transport: EmailTransport; resolveRecipients: (userIds: string[]) => Promise<ResolvedTarget[]> };
}

/**
 * Persist a notification row per recipient and (optionally) hand it off
 * to an email transport. The in-app row is the source of truth; email
 * delivery is fire-and-forget and best-effort.
 */
export async function dispatchNotification(
  db: LumenDb,
  input: DispatchInput,
  opts: DispatchOptions = {}
): Promise<{ notificationIds: string[] }> {
  const recipients = input.userId ? [input.userId] : await listOrgUserIds(db, input.organizationId);
  if (recipients.length === 0) return { notificationIds: [] };

  const inserted = await db
    .insert(notifications)
    .values(
      recipients.map((uid) => ({
        organizationId: input.organizationId,
        userId: uid,
        kind: input.kind,
        title: input.title,
        body: input.body,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
      }))
    )
    .returning({ id: notifications.id });

  if (opts.email && inserted.length > 0) {
    try {
      const targets = await opts.email.resolveRecipients(recipients);
      for (const t of targets) {
        await opts.email.transport.send({ to: t.email, subject: input.title, body: input.body });
      }
      await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(inArray(notifications.id, inserted.map((i) => i.id)));
    } catch (err) {
      console.warn(
        `[notify] email transport failed for kind=${input.kind}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { notificationIds: inserted.map((i) => i.id) };
}

async function listOrgUserIds(db: LumenDb, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.organizationId, organizationId));
  return rows.map((r) => r.id);
}

/** List a user's notifications, newest first. */
export async function listNotifications(
  db: LumenDb,
  userId: string,
  limit = 25
): Promise<Array<{
  id: string;
  kind: string;
  title: string;
  body: string;
  subjectType: string | null;
  subjectId: string | null;
  readAt: Date | null;
  createdAt: Date;
}>> {
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      subjectType: notifications.subjectType,
      subjectId: notifications.subjectId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows;
}

/** Mark a single notification read for a user. */
export async function markRead(db: LumenDb, userId: string, notificationId: string): Promise<boolean> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return updated.length > 0;
}
