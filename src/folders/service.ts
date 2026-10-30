import { and, eq, sql, type SQL } from "drizzle-orm";
import type { CreateFolderInput, UpdateFolderInput } from "../api/types";
import { clock } from "../clock";
import type { Db } from "../db/client";
import { isForeignKeyViolation } from "../db/errors";
import { folders, pages, type FolderRow, type UserRow } from "../db/schema";
import { canAccessSpace } from "../spaces/access";
import { findSpaceById } from "../spaces/queries";
import { findAccessibleFolder, findFolderById, folderExistsInSpace } from "./queries";

// Shared by the REST API and the MCP tools. Input is validated by the callers (see validation.ts).
// D1 has no interactive transactions, so each write is one conditional statement.

export type CreateFolderResult =
  | { ok: true; folder: FolderRow }
  | { ok: false; error: "space_not_found" | "parent_not_found" };

export async function createFolder(
  db: Db,
  user: UserRow,
  spaceId: string,
  input: CreateFolderInput,
): Promise<CreateFolderResult> {
  const space = await findSpaceById(db, spaceId);
  // Spaces the user cannot access are reported as missing so that their existence is not revealed.
  if (!space || !canAccessSpace(user, space)) return { ok: false, error: "space_not_found" };
  // Assumes that the space of a folder never changes, so the check cannot go stale before the insert.
  // When folders can move between spaces (M3), make this one conditional INSERT ... SELECT ... WHERE EXISTS.
  if (input.parentId !== null && !(await folderExistsInSpace(db, input.parentId, space.id))) {
    return { ok: false, error: "parent_not_found" };
  }

  const now = clock.now();
  try {
    const folder = await db
      .insert(folders)
      .values({
        id: crypto.randomUUID(),
        spaceId: space.id,
        parentId: input.parentId,
        name: input.name,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return { ok: true, folder };
  } catch (error) {
    // The parent or the space was deleted after the checks above (or the user, whose session ends with it).
    if (!isForeignKeyViolation(error)) throw error;
    if (input.parentId !== null && !(await folderExistsInSpace(db, input.parentId, space.id))) {
      return { ok: false, error: "parent_not_found" };
    }
    return { ok: false, error: "space_not_found" };
  }
}

export type UpdateFolderResult =
  | { ok: true; folder: FolderRow }
  | { ok: false; error: "not_found" | "parent_not_found" | "folder_cycle" };

// Renames the folder and/or moves it inside its space. No version: the last write wins.
export async function updateFolder(
  db: Db,
  user: UserRow,
  folderId: string,
  input: UpdateFolderInput,
): Promise<UpdateFolderResult> {
  const folder = await findAccessibleFolder(db, user, folderId);
  if (!folder) return { ok: false, error: "not_found" };

  // space_id keeps the write inside the space whose access was just checked.
  const conditions: SQL[] = [eq(folders.id, folder.id), eq(folders.spaceId, folder.spaceId)];
  const parentId = input.parentId;
  if (typeof parentId === "string") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${folders} p WHERE p.id = ${parentId} AND p.space_id = ${folder.spaceId})`,
      // Walks up from the new parent; finding the folder itself means a cycle. This also rejects the folder
      // as its own parent. UNION (not UNION ALL) stops even on an existing cycle.
      // D1 runs writes one at a time, so two concurrent moves cannot make a cycle either.
      sql`NOT EXISTS (WITH RECURSIVE anc(id) AS (
        SELECT ${parentId}
        UNION SELECT f.parent_id FROM ${folders} f JOIN anc ON f.id = anc.id WHERE f.parent_id IS NOT NULL
      ) SELECT 1 FROM anc WHERE anc.id = ${folder.id})`,
    );
  }
  // Updated even if nothing changed, so that updated_at and updated_by move forward.
  const updated = await db
    .update(folders)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(parentId !== undefined && { parentId }),
      updatedBy: user.id,
      updatedAt: clock.now(),
    })
    .where(and(...conditions))
    .returning()
    .get();
  if (updated) return { ok: true, folder: updated };

  // Access is not checked again: the folder was visible just before.
  const current = await findFolderById(db, folder.id);
  if (!current || current.spaceId !== folder.spaceId) return { ok: false, error: "not_found" };
  if (typeof parentId === "string" && !(await folderExistsInSpace(db, parentId, folder.spaceId))) {
    return { ok: false, error: "parent_not_found" };
  }
  return { ok: false, error: "folder_cycle" };
}

export type DeleteFolderResult = { ok: true } | { ok: false; error: "not_found" | "folder_not_empty" };

// Deletes the folder only if it has no folders or pages in it.
export async function deleteFolder(db: Db, user: UserRow, folderId: string): Promise<DeleteFolderResult> {
  const folder = await findAccessibleFolder(db, user, folderId);
  if (!folder) return { ok: false, error: "not_found" };

  // One statement, so a folder or page added after the check above keeps the folder.
  // The foreign keys from folders.parent_id and pages.folder_id also reject the delete.
  const result = await db
    .delete(folders)
    .where(
      and(
        eq(folders.id, folder.id),
        eq(folders.spaceId, folder.spaceId),
        sql`NOT EXISTS (SELECT 1 FROM ${folders} c WHERE c.parent_id = ${folder.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${pages} WHERE ${pages.folderId} = ${folder.id})`,
      ),
    )
    .run();
  if (result.meta.changes === 1) return { ok: true };
  const current = await findFolderById(db, folder.id);
  if (!current || current.spaceId !== folder.spaceId) return { ok: false, error: "not_found" };
  return { ok: false, error: "folder_not_empty" };
}
