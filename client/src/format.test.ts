import { describe, expect, it } from "vitest";
import { formatDateTime, formatSnippet, spaceDisplayName } from "./format";

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
