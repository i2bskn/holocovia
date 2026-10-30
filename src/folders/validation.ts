// Shared by the REST API and the MCP tools, so that both accept the same input and report the same messages.

const FOLDER_NAME_MAX_LENGTH = 100;
const CONTROL_CHARACTER = /\p{Cc}/u;
// With the u flag, \p{Cs} matches only unpaired surrogates (see pages/validation.ts).
const LONE_SURROGATE = /\p{Cs}/u;

export const folderNotFoundMessage = "フォルダが見つかりません";
export const parentNotFoundOnCreateMessage = "親フォルダが見つかりません";
export const parentNotFoundOnMoveMessage = "移動先のフォルダが見つかりません";
export const invalidFolderNameMessage =
  "フォルダの名前は 1 文字以上 100 文字以下で、改行などの制御文字を含まない文字列にしてください";
export const invalidParentIdMessage = "parent_id はフォルダの id か null で指定してください";
export const invalidFolderIdMessage = "folder_id はフォルダの id か null で指定してください";
export const emptyFolderUpdateMessage = "name か parent_id のどちらかを指定してください";
export const folderCycleMessage = "フォルダを自分自身やその中のフォルダへは移せません";
export const folderNotEmptyMessage =
  "中にページかフォルダがあるフォルダは削除できません。中身を移すか削除してから消してください";

// Returns the trimmed name, or null if invalid. Length is counted in code points; no Unicode normalization.
export function normalizeFolderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  const length = [...name].length;
  if (length < 1 || length > FOLDER_NAME_MAX_LENGTH) return null;
  if (CONTROL_CHARACTER.test(name) || LONE_SURROGATE.test(name)) return null;
  return name;
}

// A reference to a folder (parent_id, folder_id). undefined is not specified, null is the top level
// of the space, and a non-empty string is a folder id. Whether the folder exists is checked later.
export function normalizeFolderRef(value: unknown): { ok: true; value: string | null | undefined } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value };
  if (typeof value === "string" && value !== "") return { ok: true, value };
  return { ok: false };
}
