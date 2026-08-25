import { and, eq, gt } from "drizzle-orm";
import type { LumenDb } from "@lumen/db";
import { sessions, users } from "@lumen/db";
import type { OrgRole } from "@lumen/schemas";
import { generateSessionToken, sha256 } from "../lib/crypto.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: OrgRole;
  organizationId: string;
}

const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

export async function createSession(db: LumenDb, userId: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(
  db: LumenDb,
  token: string | undefined | null
): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      organizationId: users.organizationId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(db: LumenDb, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}
