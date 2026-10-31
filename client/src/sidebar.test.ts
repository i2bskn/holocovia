import { describe, expect, it } from "vitest";
import type { Folder, PageSummary } from "../../src/api/types";
import { type TreeNode, buildSpaceTree, folderPathIds } from "./sidebar";

function folder(id: string, parentId: string | null, name = id.toUpperCase()): Folder {
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

function page(id: string, folderId: string | null, title = id.toUpperCase()): PageSummary {
  return {
    id,
    space_id: "s1",
    folder_id: folderId,
    title,
    version: 1,
    created_by: null,
    updated_by: null,
    created_at: 1,
    updated_at: 1,
  };
}

// The tree as nested IDs, folders as [id, children] and pages as their id, to compare easily.
type Shape = string | [string, Shape[]];

function shape(nodes: TreeNode[]): Shape[] {
  return nodes.map((node) => (node.kind === "page" ? node.page.id : [node.folder.id, shape(node.children)]));
}

// The IDs of every folder and page in the tree, in the order shown.
function allIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === "page" ? [node.page.id] : [node.folder.id, ...allIds(node.children)]));
}

describe("buildSpaceTree", () => {
  it("nests folders and puts pages in their folders", () => {
    const folders = [folder("child", "root"), folder("root", null), folder("grandchild", "child")];
    const pages = [page("p1", "grandchild"), page("p2", "root"), page("p3", null)];
    expect(shape(buildSpaceTree(folders, pages))).toEqual([
      ["root", [["child", [["grandchild", ["p1"]]]], "p2"]],
      "p3",
    ]);
  });

  it("puts folders before pages, each in Japanese order of their names", () => {
    const folders = [folder("f1", null, "議事録"), folder("f2", null, "あいさつ"), folder("f3", null, "設計")];
    const pages = [
      page("p1", null, "手順"),
      page("p2", null, "いろは"),
      page("p3", null, "アーキテクチャ"),
      page("p4", null, "運用"),
    ];
    const names = buildSpaceTree(folders, pages).map((node) =>
      node.kind === "page" ? node.page.title : node.folder.name,
    );
    const sortedFolders = ["議事録", "あいさつ", "設計"].sort((a, b) => a.localeCompare(b, "ja"));
    const sortedPages = ["手順", "いろは", "アーキテクチャ", "運用"].sort((a, b) => a.localeCompare(b, "ja"));
    expect(names).toEqual([...sortedFolders, ...sortedPages]);
    expect(sortedPages.slice(0, 2)).toEqual(["アーキテクチャ", "いろは"]);
  });

  it("orders folders and pages with the same name by id", () => {
    const folders = [folder("fb", null, "同じ"), folder("fa", null, "同じ")];
    const pages = [page("pb", null, "同じ"), page("pa", null, "同じ")];
    expect(shape(buildSpaceTree(folders, pages))).toEqual([
      ["fa", []],
      ["fb", []],
      "pa",
      "pb",
    ]);
  });

  it("puts a folder whose parent is missing at the top level, with its children", () => {
    const folders = [folder("b", null), folder("orphan", "missing"), folder("a", "orphan")];
    expect(shape(buildSpaceTree(folders, []))).toEqual([
      ["b", []],
      ["orphan", [["a", []]]],
    ]);
  });

  it("puts a page whose folder is missing at the top level", () => {
    const folders = [folder("f1", null)];
    const pages = [page("p1", "missing"), page("p2", "f1")];
    expect(shape(buildSpaceTree(folders, pages))).toEqual([["f1", ["p2"]], "p1"]);
  });

  it("stops on a cycle and shows every folder once", () => {
    const folders = [folder("a", "b"), folder("b", "a"), folder("self", "self"), folder("c", "a")];
    const pages = [page("p1", "b"), page("p2", "self")];
    const tree = buildSpaceTree(folders, pages);
    expect(shape(tree)).toEqual([
      ["a", [["b", ["p1"]], ["c", []]]],
      ["self", ["p2"]],
    ]);
    expect(allIds(tree).sort()).toEqual(["a", "b", "c", "p1", "p2", "self"]);
  });

  it("shows every folder and page exactly once", () => {
    const folders = [
      folder("root", null),
      folder("child", "root"),
      folder("orphan", "missing"),
      folder("x", "y"),
      folder("y", "x"),
    ];
    const pages = [page("p1", "child"), page("p2", "orphan"), page("p3", "missing"), page("p4", "x")];
    const ids = allIds(buildSpaceTree(folders, pages));
    expect(ids.sort()).toEqual(["child", "orphan", "p1", "p2", "p3", "p4", "root", "x", "y"]);
  });

  it("is empty for an empty space", () => {
    expect(buildSpaceTree([], [])).toEqual([]);
  });
});

describe("folderPathIds", () => {
  const folders = [folder("other", null), folder("grandchild", "child"), folder("root", null), folder("child", "root")];

  it("returns the folders from the top level down to the folder, including it", () => {
    expect(folderPathIds(folders, "grandchild")).toEqual(["root", "child", "grandchild"]);
    expect(folderPathIds(folders, "root")).toEqual(["root"]);
  });

  it("returns an empty list for null and for a folder that is not in the list", () => {
    expect(folderPathIds(folders, null)).toEqual([]);
    expect(folderPathIds(folders, "missing")).toEqual([]);
  });

  it("stops on a cycle", () => {
    expect(folderPathIds([folder("a", "b"), folder("b", "a")], "a")).toEqual(["b", "a"]);
    expect(folderPathIds([folder("self", "self")], "self")).toEqual(["self"]);
  });
});
