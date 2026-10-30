import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import type { CreatePageInput, CreatePageRequest, UpdatePageInput, UpdatePageRequest } from "../api/types";
import { pages } from "../db/schema";
import type { AppEnv } from "../env";
import { apiError, requireUser } from "../auth/middleware";
import { folderNotFoundMessage, invalidFolderIdMessage, normalizeFolderRef } from "../folders/validation";
import { findAccessiblePage } from "../pages/queries";
import { updatePage } from "../pages/service";
import {
  emptyUpdateMessage,
  invalidPageBodyMessage,
  invalidTitleMessage,
  invalidVersionMessage,
  isValidPageBody,
  normalizePageTitle,
  normalizeVersion,
  pageNotFoundMessage,
  versionConflictMessage,
} from "../pages/validation";
import { jsonBody, toApiPage } from "./api";

function invalidTitle(c: Context<AppEnv>): Response {
  return apiError(c, 400, "invalid_title", invalidTitleMessage);
}

// Not invalid_body, which jsonBody returns when the JSON is not an object.
function invalidPageBody(c: Context<AppEnv>): Response {
  return apiError(c, 400, "invalid_page_body", invalidPageBodyMessage);
}

function invalidFolderId(c: Context<AppEnv>): Response {
  return apiError(c, 400, "invalid_folder_id", invalidFolderIdMessage);
}

export const createPageBody = jsonBody<CreatePageRequest, CreatePageInput>((body, c) => {
  const title = normalizePageTitle(body.title);
  if (title === null) return invalidTitle(c);
  if (!isValidPageBody(body.body)) return invalidPageBody(c);
  const folderId = normalizeFolderRef(body.folder_id);
  if (!folderId.ok) return invalidFolderId(c);
  return { ok: true, value: { title, body: body.body, folderId: folderId.value ?? null } };
});

const updatePageBody = jsonBody<UpdatePageRequest, UpdatePageInput>((body, c) => {
  const version = normalizeVersion(body.version);
  if (version === null) return apiError(c, 400, "invalid_version", invalidVersionMessage);
  if (body.title === undefined && body.body === undefined && body.folder_id === undefined) {
    return apiError(c, 400, "empty_update", emptyUpdateMessage);
  }
  const value: UpdatePageInput = { version };
  if (body.title !== undefined) {
    const title = normalizePageTitle(body.title);
    if (title === null) return invalidTitle(c);
    value.title = title;
  }
  if (body.body !== undefined) {
    if (!isValidPageBody(body.body)) return invalidPageBody(c);
    value.body = body.body;
  }
  if (body.folder_id !== undefined) {
    const folderId = normalizeFolderRef(body.folder_id);
    if (!folderId.ok) return invalidFolderId(c);
    value.folderId = folderId.value;
  }
  return { ok: true, value };
});

const pagesApi = new Hono<AppEnv>()
  .get("/:id", requireUser, async (c) => {
    const page = await findAccessiblePage(c.get("db"), c.get("user"), c.req.param("id"));
    if (!page) return apiError(c, 404, "not_found", pageNotFoundMessage);
    return c.json(toApiPage(page), 200);
  })
  .patch("/:id", requireUser, updatePageBody, async (c) => {
    const result = await updatePage(c.get("db"), c.get("user"), c.req.param("id"), c.req.valid("json"));
    if (result.ok) return c.json(toApiPage(result.page), 200);
    if (result.error === "not_found") return apiError(c, 404, "not_found", pageNotFoundMessage);
    // 400 rather than 404: the page in the path exists, but the folder in the body does not.
    if (result.error === "folder_not_found") return apiError(c, 400, "folder_not_found", folderNotFoundMessage);
    return apiError(c, 409, "version_conflict", versionConflictMessage);
  })
  .delete("/:id", requireUser, async (c) => {
    const db = c.get("db");
    const page = await findAccessiblePage(db, c.get("user"), c.req.param("id"));
    if (!page) return apiError(c, 404, "not_found", pageNotFoundMessage);
    // There is no history yet, so this cannot be undone.
    const result = await db
      .delete(pages)
      .where(and(eq(pages.id, page.id), eq(pages.spaceId, page.spaceId)))
      .run();
    if (result.meta.changes === 0) return apiError(c, 404, "not_found", pageNotFoundMessage);
    return c.body(null, 204);
  });

export default pagesApi;
