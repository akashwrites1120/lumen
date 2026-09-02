import { and, desc, eq, isNull } from "drizzle-orm";
import { notifications, type LumenDb } from "@lumen/db";

// The dispatcher + email transports live in @lumen/notify so the workers
// package can share the exact same delivery semantics. Re-exported here so
// API call sites and tests keep their import paths.
export {
  consoleEmailTransport,
  createEmailTransportFromEnv,
  dispatchNotification,
  notify,
  recipientEmailResolver,
  smtpEmailTransport,
} from "@lumen/notify";
export type {
  DispatchInput,
  EmailMessage,
  EmailTransport,
  NotificationKind,
  SmtpConfig,
} from "@lumen/notify";

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
