import { and, eq, sql } from "drizzle-orm";
import type { CreatePageInput, UpdatePageInput } from "../api/types";
import { clock } from "../clock";
import type { Db } from "../db/client";
import { isForeignKeyViolation } from "../db/errors";
import { pages, type PageRow, type UserRow } from "../db/schema";
import { canAccessSpace } from "../spaces/access";
import { findSpaceById } from "../spaces/queries";
import { findAccessiblePage, findPageById } from "./queries";

// Shared by the REST API and the MCP tools. Input is validated by the callers (see validation.ts).

export type CreatePageResult = { ok: true; page: PageRow } | { ok: false; error: "space_not_found" };

export async function createPage(
  db: Db,
  user: UserRow,
  spaceId: string,
  input: CreatePageInput,
): Promise<CreatePageResult> {
  const space = await findSpaceById(db, spaceId);
  // Spaces the user cannot access are reported as missing so that their existence is not revealed.
  if (!space || !canAccessSpace(user, space)) return { ok: false, error: "space_not_found" };

  const now = clock.now();
  try {
    const page = await db
      .insert(pages)
      .values({
        id: crypto.randomUUID(),
        spaceId: space.id,
        title: input.title,
        body: input.body,
        version: 1,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return { ok: true, page };
  } catch (error) {
    // The space was deleted after the check above (or the user, whose session ends with it).
    if (isForeignKeyViolation(error)) return { ok: false, error: "space_not_found" };
    throw error;
  }
}

export type UpdatePageResult = { ok: true; page: PageRow } | { ok: false; error: "not_found" | "version_conflict" };

export async function updatePage(
  db: Db,
  user: UserRow,
  pageId: string,
  input: UpdatePageInput,
): Promise<UpdatePageResult> {
  const page = await findAccessiblePage(db, user, pageId);
  if (!page) return { ok: false, error: "not_found" };

  // space_id keeps the write inside the space whose access was just checked.
  // The version is incremented even if nothing changed.
  const updated = await db
    .update(pages)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.body !== undefined && { body: input.body }),
      version: sql`${pages.version} + 1`,
      updatedBy: user.id,
      updatedAt: clock.now(),
    })
    .where(and(eq(pages.id, page.id), eq(pages.spaceId, page.spaceId), eq(pages.version, input.version)))
    .returning()
    .get();
  if (updated) return { ok: true, page: updated };

  // Access is not checked again: the page was visible just before.
  const current = await findPageById(db, page.id);
  if (!current || current.spaceId !== page.spaceId) return { ok: false, error: "not_found" };
  return { ok: false, error: "version_conflict" };
}
