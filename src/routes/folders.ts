import { Hono, type Context } from "hono";
import type { CreateFolderInput, CreateFolderRequest, UpdateFolderInput, UpdateFolderRequest } from "../api/types";
import type { AppEnv } from "../env";
import { apiError, requireUser } from "../auth/middleware";
import { findAccessibleFolder } from "../folders/queries";
import { deleteFolder, updateFolder } from "../folders/service";
import {
  emptyFolderUpdateMessage,
  folderCycleMessage,
  folderNotEmptyMessage,
  folderNotFoundMessage,
  invalidFolderNameMessage,
  invalidParentIdMessage,
  normalizeFolderName,
  normalizeFolderRef,
  parentNotFoundOnMoveMessage,
} from "../folders/validation";
import { jsonBody, toApiFolder } from "./api";

function invalidName(c: Context<AppEnv>): Response {
  return apiError(c, 400, "invalid_name", invalidFolderNameMessage);
}

function invalidParentId(c: Context<AppEnv>): Response {
  return apiError(c, 400, "invalid_parent_id", invalidParentIdMessage);
}

export const createFolderBody = jsonBody<CreateFolderRequest, CreateFolderInput>((body, c) => {
  const name = normalizeFolderName(body.name);
  if (name === null) return invalidName(c);
  const parentId = normalizeFolderRef(body.parent_id);
  if (!parentId.ok) return invalidParentId(c);
  return { ok: true, value: { name, parentId: parentId.value ?? null } };
});

const updateFolderBody = jsonBody<UpdateFolderRequest, UpdateFolderInput>((body, c) => {
  if (body.name === undefined && body.parent_id === undefined) {
    return apiError(c, 400, "empty_update", emptyFolderUpdateMessage);
  }
  const value: UpdateFolderInput = {};
  if (body.name !== undefined) {
    const name = normalizeFolderName(body.name);
    if (name === null) return invalidName(c);
    value.name = name;
  }
  if (body.parent_id !== undefined) {
    const parentId = normalizeFolderRef(body.parent_id);
    if (!parentId.ok) return invalidParentId(c);
    value.parentId = parentId.value;
  }
  return { ok: true, value };
});

// Folders in spaces the user cannot access are reported as missing so that their existence is not revealed.
const foldersApi = new Hono<AppEnv>()
  .get("/:id", requireUser, async (c) => {
    const folder = await findAccessibleFolder(c.get("db"), c.get("user"), c.req.param("id"));
    if (!folder) return apiError(c, 404, "not_found", folderNotFoundMessage);
    return c.json(toApiFolder(folder), 200);
  })
  .patch("/:id", requireUser, updateFolderBody, async (c) => {
    const result = await updateFolder(c.get("db"), c.get("user"), c.req.param("id"), c.req.valid("json"));
    if (result.ok) return c.json(toApiFolder(result.folder), 200);
    switch (result.error) {
      case "not_found":
        return apiError(c, 404, "not_found", folderNotFoundMessage);
      // 400 rather than 404: the folder in the path exists, but the parent in the body does not.
      case "parent_not_found":
        return apiError(c, 400, "parent_not_found", parentNotFoundOnMoveMessage);
      case "folder_cycle":
        return apiError(c, 409, "folder_cycle", folderCycleMessage);
    }
  })
  .delete("/:id", requireUser, async (c) => {
    const result = await deleteFolder(c.get("db"), c.get("user"), c.req.param("id"));
    if (result.ok) return c.body(null, 204);
    if (result.error === "not_found") return apiError(c, 404, "not_found", folderNotFoundMessage);
    return apiError(c, 409, "folder_not_empty", folderNotEmptyMessage);
  });

export default foldersApi;
