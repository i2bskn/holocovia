import { and, asc, eq, exists, isNull, sql } from "drizzle-orm";
import { describeError } from "../auth/middleware";
import { clock } from "../clock";
import type { Db } from "../db/client";
import { isForeignKeyViolation } from "../db/errors";
import { attachments, pages, type AttachmentRow, type PageRow, type UserRow } from "../db/schema";
import { findAccessiblePage } from "../pages/queries";
import type { SpaceViewer } from "../spaces/access";
import type { AttachmentContentType } from "./validation";

// Shared by the REST API and the MCP tools. Input is validated by the callers (see validation.ts).
// An attachment belongs to a page and is accessible exactly when the page is: the page must not be in the
// trash, and the viewer must be able to access its space. It moves with the page, which it refers to only
// by page_id, and is deleted with the page by ON DELETE CASCADE. The object in R2 is deleted by the
// scheduled job (sweep.ts).

// The key of the object in R2 that holds the contents.
export function attachmentKey(id: string): string {
  return `attachments/${id}`;
}

// Deletes an object whose row was not written or was just deleted. A failure is only logged: the scheduled
// job deletes objects without a row.
async function deleteObject(bucket: R2Bucket, id: string): Promise<void> {
  try {
    await bucket.delete(attachmentKey(id));
  } catch (error) {
    console.error("attachment object delete failed", { id, ...describeError(error) });
  }
}

export type CreateAttachmentInput = {
  // Normalized, with the extension of contentType.
  filename: string;
  contentType: AttachmentContentType;
  bytes: Uint8Array;
};

export type CreateAttachmentResult = { ok: true; attachment: AttachmentRow } | { ok: false; error: "not_found" };

// Puts the contents in R2 first, then writes the row, so that there is never a row without an object.
// An object whose row is not written is deleted; one left by a Worker that stopped in between is deleted
// by the scheduled job.
export async function createAttachment(
  db: Db,
  bucket: R2Bucket,
  user: UserRow,
  pageId: string,
  input: CreateAttachmentInput,
): Promise<CreateAttachmentResult> {
  const page = await findAccessiblePage(db, user, pageId);
  if (!page) return { ok: false, error: "not_found" };

  const id = crypto.randomUUID();
  await bucket.put(attachmentKey(id), input.bytes, { httpMetadata: { contentType: input.contentType } });

  // One conditional INSERT ... SELECT, so that a page moved to the trash or to another space after the
  // check above gets nothing. drizzle checks that the keys are those of the table, in the same order.
  let attachment: AttachmentRow | undefined;
  try {
    attachment = await db
      .insert(attachments)
      .select(
        db
          .select({
            id: sql<string>`${id}`.as("id"),
            pageId: sql<string>`${page.id}`.as("page_id"),
            filename: sql<string>`${input.filename}`.as("filename"),
            contentType: sql<AttachmentContentType>`${input.contentType}`.as("content_type"),
            size: sql<number>`${input.bytes.byteLength}`.as("size"),
            createdBy: sql<string>`${user.id}`.as("created_by"),
            createdAt: sql<number>`${clock.now()}`.as("created_at"),
          })
          .from(pages)
          .where(and(eq(pages.id, page.id), eq(pages.spaceId, page.spaceId), isNull(pages.deletedAt))),
      )
      .returning()
      .get();
  } catch (error) {
    await deleteObject(bucket, id);
    // The page was deleted, or the user was deleted (the session ends with it), after the check above.
    if (isForeignKeyViolation(error)) return { ok: false, error: "not_found" };
    throw error;
  }
  if (attachment) return { ok: true, attachment };
  await deleteObject(bucket, id);
  return { ok: false, error: "not_found" };
}

export type ListAttachmentsResult = { ok: true; attachments: AttachmentRow[] } | { ok: false; error: "not_found" };

// Lists the attachments of the page, oldest first.
export async function listAttachments(db: Db, viewer: SpaceViewer, pageId: string): Promise<ListAttachmentsResult> {
  const page = await findAccessiblePage(db, viewer, pageId);
  if (!page) return { ok: false, error: "not_found" };
  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.pageId, page.id))
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .all();
  return { ok: true, attachments: rows };
}

// Returns the attachment with its page only if the page is not in the trash and the viewer can access its
// space, otherwise null. Callers report null as missing so that the existence of the file is not revealed.
export async function findAccessibleAttachment(
  db: Db,
  viewer: SpaceViewer,
  id: string,
): Promise<{ attachment: AttachmentRow; page: PageRow } | null> {
  const attachment = await db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!attachment) return null;
  const page = await findAccessiblePage(db, viewer, attachment.pageId);
  if (!page) return null;
  return { attachment, page };
}

export type DeleteAttachmentResult = { ok: true } | { ok: false; error: "not_found" };

// Deletes the attachment and its object. Everyone who can edit the page can. There is no trash: this
// cannot be undone. Pages that refer to it in their bodies keep the reference, which no longer shows.
export async function deleteAttachment(
  db: Db,
  bucket: R2Bucket,
  viewer: SpaceViewer,
  id: string,
): Promise<DeleteAttachmentResult> {
  const found = await findAccessibleAttachment(db, viewer, id);
  if (!found) return { ok: false, error: "not_found" };
  const { attachment, page } = found;
  // The page must still be out of the trash and in the space whose access was just checked.
  const deleted = await db
    .delete(attachments)
    .where(
      and(
        eq(attachments.id, attachment.id),
        eq(attachments.pageId, page.id),
        exists(
          db
            .select({ id: pages.id })
            .from(pages)
            .where(and(eq(pages.id, page.id), eq(pages.spaceId, page.spaceId), isNull(pages.deletedAt))),
        ),
      ),
    )
    .returning({ id: attachments.id })
    .get();
  if (!deleted) return { ok: false, error: "not_found" };
  await deleteObject(bucket, attachment.id);
  return { ok: true };
}
