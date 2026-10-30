import type { Space, SpaceKind } from "../../src/api/types";

export const SPACE_KIND_LABELS: Record<SpaceKind, string> = {
  everyone: "全員",
  admin: "管理者のみ",
  personal: "自分だけ",
};

// Personal spaces have no name; the client decides how to show them.
export function spaceDisplayName(space: Pick<Space, "kind" | "name">): string {
  return space.kind === "personal" ? "個人スペース" : (space.name ?? "");
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
