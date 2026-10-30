import type { Folder } from "../../src/api/types";
import { folderPath } from "./folders";

// The inputs of the page form. folderId null is the top level of the space.
export type PageFields = { title: string; body: string; folderId: string | null };

// The fields of PATCH /api/v1/pages/:id other than version.
export type PageChanges = { title?: string; body?: string; folder_id?: string | null };

// The fields that differ between the page as loaded and the inputs. The title is compared after trimming,
// as the server trims it; a change of only the surrounding spaces is not a change.
export function pageChanges(original: PageFields, edited: PageFields): PageChanges {
  const changes: PageChanges = {};
  const title = edited.title.trim();
  if (title !== original.title) changes.title = title;
  if (edited.body !== original.body) changes.body = edited.body;
  if (edited.folderId !== original.folderId) changes.folder_id = edited.folderId;
  return changes;
}

export function hasPageChanges(changes: PageChanges): boolean {
  return Object.keys(changes).length > 0;
}

// Whether the inputs of the page creation screen hold anything to lose. initialFolderId is the folder the
// screen started with.
export function hasNewPageInput(fields: PageFields, initialFolderId: string | null): boolean {
  return fields.title.trim() !== "" || fields.body !== "" || fields.folderId !== initialFolderId;
}

export type FolderOption = { id: string; label: string };

// The folders to choose from, labeled with their path from the top level ("議事録 / 2026") and sorted by
// the label. Folders in exclude are left out.
export function folderOptions(folders: Folder[], exclude?: ReadonlySet<string>): FolderOption[] {
  return folders
    .filter((folder) => !exclude?.has(folder.id))
    .map((folder) => ({
      id: folder.id,
      label: folderPath(folders, folder.id)
        .map((f) => f.name)
        .join(" / "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));
}

// A range of the body textarea, as selectionStart and selectionEnd.
export type TextSelection = { start: number; end: number };

// Puts markdown in place of the selection (at the end of the body for null), on a line of its own: a line
// break is added before and after it unless it is at the start or end of a line. cursor is the position
// right after the inserted text.
export function insertMarkdown(
  body: string,
  selection: TextSelection | null,
  markdown: string,
): { body: string; cursor: number } {
  const start = Math.min(Math.max(selection?.start ?? body.length, 0), body.length);
  const end = Math.min(Math.max(selection?.end ?? body.length, start), body.length);
  const before = body.slice(0, start);
  const after = body.slice(end);
  const head = `${before}${before !== "" && !before.endsWith("\n") ? "\n" : ""}${markdown}`;
  const tail = `${after !== "" && !after.startsWith("\n") ? "\n" : ""}${after}`;
  return { body: head + tail, cursor: head.length };
}
