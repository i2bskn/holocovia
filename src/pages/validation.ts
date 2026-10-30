// Shared by the REST API and the MCP tools, so that both accept the same input and report the same messages.

const PAGE_TITLE_MAX_LENGTH = 200;
const PAGE_BODY_MAX_BYTES = 512 * 1024;
const SEARCH_QUERY_MAX_LENGTH = 100;
const CONTROL_CHARACTER = /\p{Cc}/u;
// With the u flag, \p{Cs} matches only unpaired surrogates, so this is the same as !isWellFormed()
// (not in the ES2022 lib). D1 would store them as U+FFFD, so the saved value would differ.
const LONE_SURROGATE = /\p{Cs}/u;

export const pageNotFoundMessage = "ページが見つかりません";
export const invalidTitleMessage =
  "タイトルは 1 文字以上 200 文字以下で、改行などの制御文字を含まない文字列にしてください";
export const invalidPageBodyMessage = "本文は 512KB 以下で、NUL 文字を含まない文字列にしてください";
export const invalidVersionMessage = "version は 1 以上の整数で指定してください";
export const emptyUpdateMessage = "title、body、folder_id のいずれかを指定してください";
export const versionConflictMessage = "ページが他の人に更新されています。最新の内容を取得してからやり直してください";
export const invalidSearchQueryMessage =
  "検索語は 1 文字以上 100 文字以下で、改行などの制御文字を含まない文字列にしてください";

// Returns the trimmed title, or null if invalid. Length is counted in code points; no Unicode normalization.
export function normalizePageTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  const length = [...title].length;
  if (length < 1 || length > PAGE_TITLE_MAX_LENGTH) return null;
  if (CONTROL_CHARACTER.test(title) || LONE_SURROGATE.test(title)) return null;
  return title;
}

// The body is Markdown and kept as is, including leading and trailing whitespace.
export function isValidPageBody(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.includes("\u0000") || LONE_SURROGATE.test(value)) return false;
  return new TextEncoder().encode(value).byteLength <= PAGE_BODY_MAX_BYTES;
}

// Returns the version, or null unless it is an integer of 1 or more.
export function normalizeVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

// Returns the trimmed search query, or null if invalid. Length is counted in code points; no Unicode normalization.
export function normalizeSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim();
  const length = [...query].length;
  if (length < 1 || length > SEARCH_QUERY_MAX_LENGTH) return null;
  if (CONTROL_CHARACTER.test(query) || LONE_SURROGATE.test(query)) return null;
  return query;
}
