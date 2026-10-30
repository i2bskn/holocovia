import type { CreateSpaceRequest, Space, SpaceKind } from "../../src/api/types";
// A value import from the server code: visibility.ts imports nothing else, so no other server code is bundled.
import { widensVisibility } from "../../src/spaces/visibility";

export const SPACE_KIND_LABELS: Record<SpaceKind, string> = {
  everyone: "全員",
  admin: "管理者のみ",
  personal: "自分だけ",
};

// The kinds of space that can be created from the client; personal spaces are created with their user.
export const CREATABLE_SPACE_KINDS = ["everyone", "admin"] as const satisfies readonly CreateSpaceRequest["kind"][];

export function isCreatableSpaceKind(value: string): value is CreateSpaceRequest["kind"] {
  return (CREATABLE_SPACE_KINDS as readonly string[]).includes(value);
}

// Personal spaces have no name; the client decides how to show them.
export function spaceDisplayName(space: Pick<Space, "kind" | "name">): string {
  return space.kind === "personal" ? "個人スペース" : (space.name ?? "");
}

// The warning shown before moving to a space that more people can see than the current one (sourceKind),
// or null if the move does not widen who can see it.
export function widerVisibilityWarning(sourceKind: SpaceKind, dest: Pick<Space, "kind" | "name">): string | null {
  if (!widensVisibility(sourceKind, dest.kind)) return null;
  return (
    `移動先の「${spaceDisplayName(dest)}」は、今のスペースより多くの人が見られます` +
    `（${SPACE_KIND_LABELS[sourceKind]} → ${SPACE_KIND_LABELS[dest.kind]}）。` +
    "ページの過去の版（履歴）と添付ファイルも見られるようになります。"
  );
}

// Formats UNIX time in milliseconds. timeZone defaults to the browser's.
export function formatDateTime(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone }).format(ms);
}

// Shows a body snippet as one line of plain text. It is cut from the body, so "…" is added on both sides.
export function formatSnippet(snippet: string): string {
  return `…${snippet.replace(/\s+/g, " ").trim()}…`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// How long until a page in the trash is deleted, from purge_after (UNIX time in milliseconds).
// Counted in whole days, rounded up.
export function formatPurgeRemaining(purgeAfter: number, now: number): string {
  const days = Math.ceil((purgeAfter - now) / DAY_MS);
  return days <= 0 ? "まもなく完全に削除されます" : `あと ${days} 日で完全に削除されます`;
}

// A file size in bytes: under 1KB in bytes, under 1MB in KB and otherwise in MB, with one decimal place
// (1KB = 1024 bytes).
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
