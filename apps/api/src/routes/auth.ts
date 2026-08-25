import { eq } from "drizzle-orm";
import { auditEvents, organizations, users } from "@lumen/db";
import { LoginInput, RegisterInput, type PublicUser } from "@lumen/schemas";
import type { FastifyInstance } from "fastify";
import { createSession, destroySession, resolveSession } from "../auth/session.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import type { AppContext } from "../types.js";

function toPublicUser(u: {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "reviewer" | "viewer";
  organizationId: string;
}): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organizationId: u.organizationId,
  };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.post("/v1/auth/register", async (req, reply) => {
    const input = RegisterInput.parse(req.body);

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ error: "email_already_registered" });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: input.organizationName })
        .returning();
      if (!org) throw new Error("failed_to_create_organization");
      const [u] = await tx
        .insert(users)
        .values({
          organizationId: org.id,
          email: input.email,
          name: input.name,
          passwordHash,
          role: "owner",
        })
        .returning();
      if (!u) throw new Error("failed_to_create_user");
      return u;
    });

    const session = await createSession(db, user.id);
    await db.insert(auditEvents).values({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "user.registered",
      subjectType: "user",
      subjectId: user.id,
      detail: { organizationName: input.organizationName },
    });

    return reply.code(201).send({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: toPublicUser(user),
    });
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const input = LoginInput.parse(req.body);
    const rows = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const user = rows[0];
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const session = await createSession(db, user.id);
    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: toPublicUser(user),
    };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      await destroySession(db, header.slice(7));
    }
    return reply.code(204).send();
  });

  app.get("/v1/auth/me", async (req, reply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const user = token ? await resolveSession(db, token) : null;
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { user };
  });

  app.get("/v1/health", async () => ({ status: "ok", service: "lumen-api" }));
}
