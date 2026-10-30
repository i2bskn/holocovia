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
