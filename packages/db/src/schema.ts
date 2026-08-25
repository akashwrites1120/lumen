import { relations, sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Block, Section } from "@lumen/schemas";

export interface IRSnapshot {
  sections: Section[];
}

export const orgRole = pgEnum("org_role", ["owner", "admin", "reviewer", "viewer"]);
export const documentState = pgEnum("document_state", [
  "uploaded",
  "parsing",
  "ingested",
  "failed",
]);
export const assetState = pgEnum("asset_state", [
  "extracted",
  "ai_drafted",
  "in_review",
  "approved",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: orgRole("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash)]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    stage: text("stage").notNull().default("idle"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)]
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    state: documentState("state").notNull().default("uploaded"),
    storageKey: text("storage_key").notNull(),
    title: text("title"),
    language: text("language").notNull().default("en"),
    errorDetail: text("error_detail"),
    irSnapshot: jsonb("ir_snapshot").$type<IRSnapshot>(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_project_idx").on(t.projectId)]
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    sourceHref: text("source_href"),
    spineIndex: integer("spine_index"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    imageClass: text("image_class"),
    state: assetState("state").notNull().default("extracted"),
    duplicateOfAssetId: uuid("duplicate_of_asset_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assets_document_idx").on(t.documentId),
    uniqueIndex("assets_document_checksum_unique").on(t.documentId, t.checksumSha256),
  ]
);

export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    provider: text("provider"),
    altText: text("alt_text").notNull(),
    longDescription: text("long_description"),
    confidence: smallint("confidence"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suggestions_asset_revision_unique").on(t.assetId, t.revision)]
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    suggestionId: uuid("suggestion_id")
      .notNull()
      .references(() => suggestions.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    finalAltText: text("final_alt_text").notNull(),
    feedback: text("feedback"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_suggestion_idx").on(t.suggestionId)]
);

export const exports = pgTable("exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  formats: jsonb("formats").$type<string[]>().notNull(),
  status: text("status").notNull().default("pending"),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  artifactKeys: jsonb("artifact_keys").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const validations = pgTable("validations", {
  exportId: uuid("export_id")
    .notNull()
    .references(() => exports.id, { onDelete: "cascade" }),
  validator: text("validator").notNull(),
  format: text("format").notNull(),
  passed: text("passed").notNull(),
  output: jsonb("output"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.exportId, t.validator, t.format] })]);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    detail: jsonb("detail"),
    at: timestamp("at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("audit_events_subject_idx").on(t.subjectType, t.subjectId)]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id],
  }),
  assets: many(assets),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  document: one(documents, {
    fields: [assets.documentId],
    references: [documents.id],
  }),
  suggestions: many(suggestions),
}));
