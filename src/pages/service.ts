import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { CreatePageInput, UpdatePageInput } from "../api/types";
import { clock } from "../clock";
import type { Db } from "../db/client";
import { isForeignKeyViolation } from "../db/errors";
import { folders, pages, type PageRow, type UserRow } from "../db/schema";
import { folderExistsInSpace } from "../folders/queries";
import { canAccessSpace } from "../spaces/access";
import { findSpaceById } from "../spaces/queries";
import { findAccessiblePage, findPageById } from "./queries";
import { insertRevisionQuery, pruneRevisionsQuery } from "./revisions";

// Shared by the REST API and the MCP tools. Input is validated by the callers (see validation.ts).

export type CreatePageResult =
  | { ok: true; page: PageRow }
  | { ok: false; error: "space_not_found" | "folder_not_found" };

export async function createPage(
  db: Db,
  user: UserRow,
  spaceId: string,
  input: CreatePageInput,
): Promise<CreatePageResult> {
  const space = await findSpaceById(db, spaceId);
  // Spaces the user cannot access are reported as missing so that their existence is not revealed.
  if (!space || !canAccessSpace(user, space)) return { ok: false, error: "space_not_found" };
  // Assumes that the space of a folder never changes, so the check cannot go stale before the insert.
  // When folders can move between spaces (M3), make this one conditional INSERT ... SELECT ... WHERE EXISTS.
  if (input.folderId !== null && !(await folderExistsInSpace(db, input.folderId, space.id))) {
    return { ok: false, error: "folder_not_found" };
  }

  const now = clock.now();
  try {
    const page = await db
      .insert(pages)
      .values({
        id: crypto.randomUUID(),
        spaceId: space.id,
        folderId: input.folderId,
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
    // The folder or the space was deleted after the checks above (or the user, whose session ends with it).
    if (!isForeignKeyViolation(error)) throw error;
    if (input.folderId !== null && !(await folderExistsInSpace(db, input.folderId, space.id))) {
      return { ok: false, error: "folder_not_found" };
    }
    return { ok: false, error: "space_not_found" };
  }
}

export type UpdatePageResult =
  | { ok: true; page: PageRow }
  | { ok: false; error: "not_found" | "version_conflict" | "folder_not_found" };

// The condition of the UPDATE in updatePage and of the revision copied with it.
// space_id keeps the write inside the space whose access was checked, and deleted_at keeps a page moved
// to the trash after the check from being updated.
export function pageUpdateWhere(
  page: Pick<PageRow, "id" | "spaceId">,
  version: number,
  folderId: string | null | undefined,
): SQL | undefined {
  const conditions: SQL[] = [
    eq(pages.id, page.id),
    eq(pages.spaceId, page.spaceId),
    eq(pages.version, version),
    isNull(pages.deletedAt),
  ];
  if (typeof folderId === "string") {
    conditions.push(sql`EXISTS (SELECT 1 FROM ${folders} f WHERE f.id = ${folderId} AND f.space_id = ${page.spaceId})`);
  }
  return and(...conditions);
}

export async function updatePage(
  db: Db,
  user: UserRow,
  pageId: string,
  input: UpdatePageInput,
): Promise<UpdatePageResult> {
  const page = await findAccessiblePage(db, user, pageId);
  if (!page) return { ok: false, error: "not_found" };

  // The version is incremented even if nothing changed. Moving to another folder is an update too.
  const folderId = input.folderId;
  // The revision is copied with the same condition, so that it is kept only when the update happens.
  const where = pageUpdateWhere(page, input.version, folderId);
  const update = db
    .update(pages)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.body !== undefined && { body: input.body }),
      ...(folderId !== undefined && { folderId }),
      version: sql`${pages.version} + 1`,
      updatedBy: user.id,
      updatedAt: clock.now(),
    })
    .where(where)
    .returning();
  let updated: PageRow | undefined;
  if (input.title !== undefined || input.body !== undefined) {
    // One batch (a transaction in D1). The copy comes first so that it reads the values before the update.
    // Kept even if the values do not change. Moving to another folder alone keeps no revision.
    const [, rows] = await db.batch([insertRevisionQuery(db, where), update, pruneRevisionsQuery(db, page.id)]);
    updated = rows[0];
  } else {
    updated = await update.get();
  }
  if (updated) return { ok: true, page: updated };

  // Access is not checked again: the page was visible just before.
  const current = await findPageById(db, page.id);
  if (!current || current.spaceId !== page.spaceId || current.deletedAt !== null) {
    return { ok: false, error: "not_found" };
  }
  if (current.version !== input.version) return { ok: false, error: "version_conflict" };
  if (typeof folderId === "string") return { ok: false, error: "folder_not_found" };
  return { ok: false, error: "version_conflict" };
}
