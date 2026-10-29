import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    passwordHash: text("password_hash"),
    oidcIssuer: text("oidc_issuer"),
    oidcSubject: text("oidc_subject"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
  },
  (t) => [
    uniqueIndex("users_oidc_issuer_subject_unique").on(t.oidcIssuer, t.oidcSubject),
    check("users_role_check", sql`${t.role} IN ('admin', 'member')`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    familyId: text("family_id").notNull(),
    authMode: text("auth_mode", { enum: ["oidc", "password"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    familyExpiresAt: integer("family_expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    rotatedAt: integer("rotated_at"),
    rotatedTo: text("rotated_to"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_family_id_idx").on(t.familyId),
    check("sessions_auth_mode_check", sql`${t.authMode} IN ('oidc', 'password')`),
  ],
);

// Pages belong to one space, and access is decided by the space kind alone.
export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["everyone", "admin", "personal"] }).notNull(),
    // NULL only for personal spaces; clients decide their display name.
    name: text("name"),
    // Set only for personal spaces. Not deleted in cascade.
    ownerUserId: text("owner_user_id").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    // One personal space per user. NULLs do not conflict.
    uniqueIndex("spaces_owner_user_id_unique").on(t.ownerUserId),
    // Names are unique across everyone and admin spaces, compared exactly.
    uniqueIndex("spaces_name_unique").on(t.name),
    check("spaces_kind_check", sql`${t.kind} IN ('everyone', 'admin', 'personal')`),
    check(
      "spaces_personal_check",
      sql`(${t.kind} = 'personal') = (${t.ownerUserId} IS NOT NULL) AND (${t.kind} = 'personal') = (${t.name} IS NULL)`,
    ),
  ],
);

// The body is Markdown stored as is. version is for optimistic locking and starts at 1.
export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    // Not deleted in cascade, so deleting a space never deletes its pages.
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    version: integer("version").notNull(),
    // Pages outlive the users who created or edited them.
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("pages_space_id_updated_at_idx").on(t.spaceId, t.updatedAt)],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;
export type PageRow = typeof pages.$inferSelect;
