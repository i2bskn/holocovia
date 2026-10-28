import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { users, type UserRow } from "../db/schema";

export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (e.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}

export function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function findUserByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export async function countUsers(db: Db): Promise<number> {
  const row = await db.select({ count: sql<number>`COUNT(*)` }).from(users).get();
  return row?.count ?? 0;
}

// Creates the first admin only when there are no users, in a single statement.
// Returns null if a user already exists.
export async function createInitialAdmin(
  db: Db,
  params: { email: string; name: string | null; passwordHash: string; now: number },
): Promise<UserRow | null> {
  const id = crypto.randomUUID();
  const { email, name, passwordHash, now } = params;
  const result = await db.run(sql`
    INSERT INTO users (id, email, name, role, password_hash, oidc_issuer, oidc_subject, created_at, updated_at, last_login_at)
    SELECT ${id}, ${email}, ${name}, 'admin', ${passwordHash}, NULL, NULL, ${now}, ${now}, NULL
    WHERE NOT EXISTS (SELECT 1 FROM users)`);
  if (result.meta.changes !== 1) return null;
  return (await findUserById(db, id)) ?? null;
}

export type OidcIdentity = {
  issuer: string;
  subject: string;
  email: string;
  name: string | null;
};

export type OidcUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: "conflict" | "failed" };

// Maps an OIDC identity to a user, creating one just in time (spec 6.6).
export async function resolveOidcUser(db: Db, identity: OidcIdentity, now: number): Promise<OidcUserResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await tryResolveOidcUser(db, identity, now);
    if (result !== "retry") return result;
  }
  return { ok: false, reason: "failed" };
}

async function tryResolveOidcUser(
  db: Db,
  identity: OidcIdentity,
  now: number,
): Promise<OidcUserResult | "retry"> {
  const { issuer, subject, email, name } = identity;

  const linked = await db
    .select()
    .from(users)
    .where(and(eq(users.oidcIssuer, issuer), eq(users.oidcSubject, subject)))
    .get();
  if (linked) {
    if (linked.email === email) return { ok: true, user: linked };
    try {
      await db.update(users).set({ email, updatedAt: now }).where(eq(users.id, linked.id)).run();
      return { ok: true, user: { ...linked, email, updatedAt: now } };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      console.warn("oidc email update skipped: email is used by another user", { userId: linked.id });
      return { ok: true, user: linked };
    }
  }

  const byEmail = await findUserByEmail(db, email);
  if (byEmail) {
    if (byEmail.oidcSubject !== null) return { ok: false, reason: "conflict" };
    try {
      const result = await db
        .update(users)
        .set({ oidcIssuer: issuer, oidcSubject: subject, updatedAt: now })
        .where(and(eq(users.id, byEmail.id), isNull(users.oidcSubject)))
        .run();
      if (result.meta.changes !== 1) return "retry";
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return "retry";
    }
    const user = await findUserById(db, byEmail.id);
    return user ? { ok: true, user } : "retry";
  }

  const id = crypto.randomUUID();
  try {
    await db.run(sql`
      INSERT INTO users (id, email, name, role, password_hash, oidc_issuer, oidc_subject, created_at, updated_at, last_login_at)
      SELECT ${id}, ${email}, ${name}, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'member' ELSE 'admin' END,
        NULL, ${issuer}, ${subject}, ${now}, ${now}, NULL`);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return "retry";
  }
  const user = await findUserById(db, id);
  return user ? { ok: true, user } : "retry";
}
