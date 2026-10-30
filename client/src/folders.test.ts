import { describe, expect, it } from "vitest";
import type { Folder } from "../../src/api/types";
import { childFolders, descendantIds, folderPath } from "./folders";

function folder(id: string, parentId: string | null): Folder {
  return {
    id,
    space_id: "s1",
    parent_id: parentId,
    name: id.toUpperCase(),
    created_by: null,
    updated_by: null,
    created_at: 1,
    updated_at: 1,
  };
}

const ROOT = folder("root", null);
const CHILD = folder("child", "root");
const GRANDCHILD = folder("grandchild", "child");
const OTHER = folder("other", null);

describe("folderPath", () => {
  it("returns the folders from the top level down to the folder", () => {
    expect(folderPath([OTHER, GRANDCHILD, ROOT, CHILD], "grandchild")).toEqual([ROOT, CHILD, GRANDCHILD]);
    expect(folderPath([ROOT], "root")).toEqual([ROOT]);
  });

  it("returns an empty list for a folder that is not in the list", () => {
    expect(folderPath([ROOT, CHILD], "missing")).toEqual([]);
    expect(folderPath([], "root")).toEqual([]);
  });

  it("starts at the highest folder that could be followed when a parent is missing", () => {
    expect(folderPath([CHILD, GRANDCHILD], "grandchild")).toEqual([CHILD, GRANDCHILD]);
  });

  it("stops on a cycle", () => {
    const a = folder("a", "b");
    const b = folder("b", "a");
    expect(folderPath([a, b], "a")).toEqual([b, a]);
    const self = folder("self", "self");
    expect(folderPath([self], "self")).toEqual([self]);
  });
});

describe("childFolders", () => {
  it("returns the folders directly in the parent, in the given order", () => {
    const second = folder("second", "root");
    expect(childFolders([OTHER, CHILD, GRANDCHILD, ROOT, second], "root")).toEqual([CHILD, second]);
  });

  it("returns the top level folders for null", () => {
    expect(childFolders([CHILD, OTHER, ROOT], null)).toEqual([OTHER, ROOT]);
  });
});

describe("descendantIds", () => {
  it("returns the folders inside the folder at any depth, without the folder", () => {
    const greatGrandchild = folder("great", "grandchild");
    const sibling = folder("sibling", "root");
    const folders = [OTHER, greatGrandchild, GRANDCHILD, ROOT, CHILD, sibling];
    expect(descendantIds(folders, "root")).toEqual(new Set(["child", "grandchild", "great", "sibling"]));
    expect(descendantIds(folders, "child")).toEqual(new Set(["grandchild", "great"]));
    expect(descendantIds(folders, "great")).toEqual(new Set());
    expect(descendantIds(folders, "missing")).toEqual(new Set());
  });

  it("stops on a cycle", () => {
    const a = folder("a", "c");
    const b = folder("b", "a");
    const c = folder("c", "b");
    expect(descendantIds([a, b, c], "a")).toEqual(new Set(["b", "c"]));
    const self = folder("self", "self");
    expect(descendantIds([self], "self")).toEqual(new Set());
  });
});
