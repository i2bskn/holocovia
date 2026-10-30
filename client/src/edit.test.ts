import { describe, expect, it } from "vitest";
import type { Folder } from "../../src/api/types";
import { type PageFields, folderOptions, hasNewPageInput, hasPageChanges, pageChanges } from "./edit";
import { descendantIds } from "./folders";

const ORIGINAL: PageFields = { title: "手順", body: "# 手順", folderId: "f1" };

describe("pageChanges", () => {
  it("is empty when nothing changed", () => {
    expect(pageChanges(ORIGINAL, { ...ORIGINAL })).toEqual({});
    expect(hasPageChanges(pageChanges(ORIGINAL, { ...ORIGINAL }))).toBe(false);
  });

  it("does not count spaces around the title as a change", () => {
    expect(pageChanges(ORIGINAL, { ...ORIGINAL, title: "  手順 \n" })).toEqual({});
  });

  it("returns the trimmed title when it changed", () => {
    expect(pageChanges(ORIGINAL, { ...ORIGINAL, title: " 新しい手順 " })).toEqual({ title: "新しい手順" });
  });

  it("returns only the body when only the body changed", () => {
    const changes = pageChanges(ORIGINAL, { ...ORIGINAL, body: "# 手順\n\n追記" });
    expect(changes).toEqual({ body: "# 手順\n\n追記" });
    expect(hasPageChanges(changes)).toBe(true);
  });

  it("counts spaces in the body as a change", () => {
    expect(pageChanges(ORIGINAL, { ...ORIGINAL, body: "# 手順 " })).toEqual({ body: "# 手順 " });
  });

  it("returns only the folder when only the folder changed", () => {
    expect(pageChanges(ORIGINAL, { ...ORIGINAL, folderId: "f2" })).toEqual({ folder_id: "f2" });
  });

  it("returns null for a move to the top level and an ID for a move out of it", () => {
    expect(pageChanges(ORIGINAL, { ...ORIGINAL, folderId: null })).toEqual({ folder_id: null });
    const top: PageFields = { ...ORIGINAL, folderId: null };
    expect(pageChanges(top, { ...top, folderId: "f1" })).toEqual({ folder_id: "f1" });
    expect(pageChanges(top, { ...top })).toEqual({});
  });

  it("returns every field that changed", () => {
    expect(pageChanges(ORIGINAL, { title: "B", body: "b", folderId: null })).toEqual({
      title: "B",
      body: "b",
      folder_id: null,
    });
  });
});

describe("hasNewPageInput", () => {
  const empty: PageFields = { title: "", body: "", folderId: "f1" };

  it("is false for the empty form and a title of only spaces", () => {
    expect(hasNewPageInput(empty, "f1")).toBe(false);
    expect(hasNewPageInput({ ...empty, title: "  " }, "f1")).toBe(false);
  });

  it("is true with a title, a body or another folder", () => {
    expect(hasNewPageInput({ ...empty, title: "a" }, "f1")).toBe(true);
    expect(hasNewPageInput({ ...empty, body: " " }, "f1")).toBe(true);
    expect(hasNewPageInput({ ...empty, folderId: null }, "f1")).toBe(true);
  });
});

function folder(id: string, parentId: string | null, name: string): Folder {
  return {
    id,
    space_id: "s1",
    parent_id: parentId,
    name,
    created_by: null,
    updated_by: null,
    created_at: 1,
    updated_at: 1,
  };
}

describe("folderOptions", () => {
  const minutes = folder("m", null, "議事録");
  const y2026 = folder("y26", "m", "2026");
  const y2025 = folder("y25", "m", "2025");
  const april = folder("apr", "y26", "4月");
  const docs = folder("d", null, "資料");
  const folders = [y2026, docs, april, minutes, y2025];

  it("labels the folders with their path and sorts them by the label", () => {
    expect(folderOptions(folders)).toEqual([
      { id: "m", label: "議事録" },
      { id: "y25", label: "議事録 / 2025" },
      { id: "y26", label: "議事録 / 2026" },
      { id: "apr", label: "議事録 / 2026 / 4月" },
      { id: "d", label: "資料" },
    ]);
  });

  it("leaves out the excluded folders", () => {
    const exclude = descendantIds(folders, "y26").add("y26");
    expect(folderOptions(folders, exclude)).toEqual([
      { id: "m", label: "議事録" },
      { id: "y25", label: "議事録 / 2025" },
      { id: "d", label: "資料" },
    ]);
  });

  it("returns nothing without folders", () => {
    expect(folderOptions([])).toEqual([]);
  });
});
