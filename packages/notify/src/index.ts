import { eq, inArray } from "drizzle-orm";
import { notifications, users, type LumenDb, type notificationKind } from "@lumen/db";
import nodemailer from "nodemailer";

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

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailTransport {
  /** Diagnostic marker so logs/tests can tell transports apart. */
  readonly kind?: "console" | "smtp";
  send(msg: EmailMessage): Promise<void>;
}

/**
 * No-op transport used when SMTP is not configured. Logs to stdout so the
 * delivery path stays visible during local dev.
 */
export const consoleEmailTransport: EmailTransport = {
  kind: "console",
  async send(msg) {
    console.log(`[email:noop] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
  },
};

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * SMTP transport (works with any provider: Mailpit/MailHog locally,
 * SES SMTP interface, Postmark, Gmail relay... in prod).
 */
export function smtpEmailTransport(cfg: SmtpConfig): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    connectionTimeout: 10_000,
  });
  return {
    kind: "smtp",
    async send(msg) {
      await transporter.sendMail({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
      });
    },
  };
}

export interface EmailEnv {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  EMAIL_FROM?: string;
}

export const DEFAULT_EMAIL_FROM = "Lumen <no-reply@lumen.local>";

/**
 * Env-driven transport selection. Returns null when SMTP is not configured
 * so callers can decide to skip the email leg entirely (the in-app row is
 * always written; `emailedAt` is only stamped for real transports).
 */
export function createEmailTransportFromEnv(
  env: EmailEnv = process.env
): EmailTransport | null {
  const host = env.SMTP_HOST;
  if (!host) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  const secure = env.SMTP_SECURE === "true" || (!env.SMTP_SECURE && port === 465);
  return smtpEmailTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
  });
}

export interface ResolvedTarget {
  userId: string;
  email: string;
}

/** Builds a recipient resolver for dispatchNotification from the users table. */
export function recipientEmailResolver(
  db: LumenDb
): (userIds: string[]) => Promise<ResolvedTarget[]> {
  return async (userIds) => {
    if (userIds.length === 0) return [];
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    return rows.map((r) => ({ userId: r.id, email: r.email }));
  };
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

/**
 * Convenience wrapper: dispatch in-app rows and email only when a
 * transport is configured (null/undefined transport skips the email leg).
 */
export async function notify(
  db: LumenDb,
  input: DispatchInput,
  transport?: EmailTransport | null
): Promise<{ notificationIds: string[] }> {
  return dispatchNotification(
    db,
    input,
    transport ? { email: { transport, resolveRecipients: recipientEmailResolver(db) } } : {}
  );
}

async function listOrgUserIds(db: LumenDb, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.organizationId, organizationId));
  return rows.map((r) => r.id);
}
