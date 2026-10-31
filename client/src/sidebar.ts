import type { Folder, PageSummary } from "../../src/api/types";
import { folderPath } from "./folders";

// A row of the tree of a space in the sidebar.
export type TreeNode = { kind: "folder"; folder: Folder; children: TreeNode[] } | { kind: "page"; page: PageSummary };

type FolderNode = Extract<TreeNode, { kind: "folder" }>;

// By name in Japanese order, then by id, so that the order does not depend on the order of the API.
function compareNames(a: { name: string; id: string }, b: { name: string; id: string }): number {
  const byName = a.name.localeCompare(b.name, "ja");
  if (byName !== 0) return byName;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function compareFolders(a: Folder, b: Folder): number {
  return compareNames(a, b);
}

function comparePages(a: PageSummary, b: PageSummary): number {
  return compareNames({ name: a.title, id: a.id }, { name: b.title, id: b.id });
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// The folders and pages of a space as a tree. In each level, folders come first and then pages, each by name.
// Every folder and page appears exactly once: a folder whose parent is not in folders (a stale list) or that is
// in a cycle is put at the top level, and so is a page whose folder is not in folders.
export function buildSpaceTree(folders: Folder[], pages: PageSummary[]): TreeNode[] {
  const sortedFolders = [...folders].sort(compareFolders);
  const folderIds = new Set(sortedFolders.map((folder) => folder.id));
  const childrenOf = new Map<string | null, Folder[]>();
  for (const folder of sortedFolders) pushTo(childrenOf, folder.parent_id, folder);
  const pagesIn = new Map<string | null, PageSummary[]>();
  for (const page of [...pages].sort(comparePages)) {
    pushTo(pagesIn, page.folder_id !== null && folderIds.has(page.folder_id) ? page.folder_id : null, page);
  }

  // A folder seen once is not shown again, which stops on a cycle.
  const placed = new Set<string>();
  function build(folder: Folder): FolderNode {
    placed.add(folder.id);
    const children: TreeNode[] = [];
    for (const child of childrenOf.get(folder.id) ?? []) {
      if (!placed.has(child.id)) children.push(build(child));
    }
    for (const page of pagesIn.get(folder.id) ?? []) children.push({ kind: "page", page });
    return { kind: "folder", folder, children };
  }

  const top: FolderNode[] = [];
  for (const folder of childrenOf.get(null) ?? []) {
    if (!placed.has(folder.id)) top.push(build(folder));
  }
  // Folders whose parent is missing start their own branch first, so that their children stay inside them; the
  // folders left after that are in cycles.
  for (const folder of sortedFolders) {
    if (!placed.has(folder.id) && folder.parent_id !== null && !folderIds.has(folder.parent_id)) {
      top.push(build(folder));
    }
  }
  for (const folder of sortedFolders) {
    if (!placed.has(folder.id)) top.push(build(folder));
  }
  // The branches started from a missing parent or a cycle are put in order with the others.
  top.sort((a, b) => compareFolders(a.folder, b.folder));
  return [...top, ...(pagesIn.get(null) ?? []).map((page): TreeNode => ({ kind: "page", page }))];
}

// The IDs of the folders from the top level of the space down to folderId, including it. [] for null and for a
// folder that is not in folders.
export function folderPathIds(folders: Folder[], folderId: string | null): string[] {
  if (folderId === null) return [];
  return folderPath(folders, folderId).map((folder) => folder.id);
}
