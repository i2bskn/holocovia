import type { Folder } from "../../src/api/types";

// The folders from the top level of the space down to folderId, including it. [] if folderId is not in
// folders. If a parent is missing from folders (a stale list) or there is a cycle, the path starts at the
// highest folder that could be followed.
export function folderPath(folders: Folder[], folderId: string): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
  const path: Folder[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current);
    current = current.parent_id === null ? undefined : byId.get(current.parent_id);
  }
  return path.reverse();
}

// The folders directly in parentId (null for the top level of the space), in the order given.
export function childFolders(folders: Folder[], parentId: string | null): Folder[] {
  return folders.filter((folder) => folder.parent_id === parentId);
}

// The IDs of the folders inside id, at any depth, without id itself. Stops on a cycle.
export function descendantIds(folders: Folder[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parent_id === null) continue;
    const list = children.get(folder.parent_id);
    if (list) list.push(folder.id);
    else children.set(folder.parent_id, [folder.id]);
  }
  const found = new Set<string>();
  const queue = [id];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    for (const child of children.get(current) ?? []) {
      if (child === id || found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return found;
}
