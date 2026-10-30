import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatFileSize,
  formatPurgeRemaining,
  formatSnippet,
  spaceDisplayName,
  widerVisibilityWarning,
} from "./format";

describe("spaceDisplayName", () => {
  it("shows personal spaces as 個人スペース", () => {
    expect(spaceDisplayName({ kind: "personal", name: null })).toBe("個人スペース");
  });

  it("shows other spaces by name", () => {
    expect(spaceDisplayName({ kind: "everyone", name: "開発" })).toBe("開発");
    expect(spaceDisplayName({ kind: "admin", name: "管理" })).toBe("管理");
  });
});

describe("formatDateTime", () => {
  it("formats in the given time zone", () => {
    expect(formatDateTime(Date.UTC(2026, 9, 30, 3, 4), "Asia/Tokyo")).toBe("2026/10/30 12:04");
  });
});

describe("formatSnippet", () => {
  it("joins lines and collapses whitespace", () => {
    expect(formatSnippet("# 手順\n\n1. 設計\t方針  を  決める\r\n")).toBe("…# 手順 1. 設計 方針 を 決める…");
  });

  it("adds … on both sides", () => {
    expect(formatSnippet("  abc  ")).toBe("…abc…");
    expect(formatSnippet("abc")).toBe("…abc…");
  });
});

describe("formatPurgeRemaining", () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 30);

  it("counts whole days, rounded up", () => {
    expect(formatPurgeRemaining(NOW + 30 * DAY, NOW)).toBe("あと 30 日で完全に削除されます");
    expect(formatPurgeRemaining(NOW + DAY, NOW)).toBe("あと 1 日で完全に削除されます");
    expect(formatPurgeRemaining(NOW + DAY / 2, NOW)).toBe("あと 1 日で完全に削除されます");
  });

  it("says soon at or after the time", () => {
    expect(formatPurgeRemaining(NOW, NOW)).toBe("まもなく完全に削除されます");
    expect(formatPurgeRemaining(NOW - DAY, NOW)).toBe("まもなく完全に削除されます");
  });
});

describe("widerVisibilityWarning", () => {
  it("warns about a space more people can see, with the kinds and the revisions", () => {
    expect(widerVisibilityWarning("personal", { kind: "everyone", name: "開発" })).toBe(
      "移動先の「開発」は、今のスペースより多くの人が見られます（自分だけ → 全員）。" +
        "ページの過去の版（履歴）と添付ファイルも見られるようになります。",
    );
    expect(widerVisibilityWarning("admin", { kind: "everyone", name: "開発" })).toContain("（管理者のみ → 全員）");
    expect(widerVisibilityWarning("personal", { kind: "admin", name: "管理" })).toContain("「管理」");
  });

  it("is null for a space of the same kind or one fewer people can see", () => {
    expect(widerVisibilityWarning("everyone", { kind: "everyone", name: "別" })).toBeNull();
    expect(widerVisibilityWarning("everyone", { kind: "admin", name: "管理" })).toBeNull();
    expect(widerVisibilityWarning("admin", { kind: "personal", name: null })).toBeNull();
  });
});

describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024 - 1, "1024.0 KB"],
    [1024 * 1024, "1.0 MB"],
    [10 * 1024 * 1024, "10.0 MB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
