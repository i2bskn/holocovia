import { useEffect, useState } from "react";
import type { Folder, Space } from "../../../src/api/types";
import { folderOptions } from "../edit";
import { spaceDisplayName } from "../format";
import { type ApiClient, type ListResult, loadFolderList, loadSpaceList } from "../load";
import { TOP_LEVEL_LABEL, folderIdToValue } from "./PageEditor";

export type Loadable<T> = { kind: "loading" } | { kind: "ok"; value: T } | { kind: "error" };

// After "redirecting" the move to the login page has started, so the list stays loading.
function toLoadable<T>(result: ListResult<T>): Loadable<T> {
  return result.kind === "redirecting" ? { kind: "loading" } : result;
}

export type MoveDestination = {
  spaces: Loadable<Space[]>;
  // The chosen space. Starts at the current space.
  spaceId: string;
  // Chooses another space. The folder goes back to the top level of it (see the callers).
  setSpaceId: (spaceId: string) => void;
  // All the folders of the chosen space.
  folders: Loadable<Folder[]>;
  // The chosen space as loaded, or null while the spaces are not loaded.
  space: Space | null;
};

// The spaces to choose the destination of a move from, and the folders of the chosen space. Loaded while
// enabled is true; the spaces again every time it becomes true, the folders again when the space changes.
export function useMoveDestination(
  client: ApiClient,
  enabled: boolean,
  spaceId: string,
  setSpaceId: (spaceId: string) => void,
): MoveDestination {
  const [spaces, setSpaces] = useState<Loadable<Space[]>>({ kind: "loading" });
  const [folders, setFolders] = useState<Loadable<Folder[]>>({ kind: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSpaces({ kind: "loading" });
    void loadSpaceList(client).then((result) => {
      if (!cancelled) setSpaces(toLoadable(result));
    });
    return () => {
      cancelled = true;
    };
    // client does not change while the screen is shown.
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setFolders({ kind: "loading" });
    void loadFolderList(client, spaceId).then((result) => {
      if (!cancelled) setFolders(toLoadable(result));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, spaceId]);

  const space = spaces.kind === "ok" ? (spaces.value.find((s) => s.id === spaceId) ?? null) : null;
  return { spaces, spaceId, setSpaceId, folders, space };
}

// The select of the destination space, and the message when the spaces could not be loaded.
export function MoveSpaceSelect({ destination, disabled }: { destination: MoveDestination; disabled: boolean }) {
  const { spaces, spaceId, setSpaceId } = destination;
  return (
    <>
      <label>
        移動先のスペース
        <select
          value={spaceId}
          onChange={(event) => setSpaceId(event.target.value)}
          disabled={disabled || spaces.kind !== "ok"}
        >
          {spaces.kind === "ok" ? (
            spaces.value.map((space) => (
              <option key={space.id} value={space.id}>
                {spaceDisplayName(space)}
              </option>
            ))
          ) : (
            <option value={spaceId}>{spaces.kind === "loading" ? "読み込み中…" : "（読み込めませんでした）"}</option>
          )}
        </select>
      </label>
      {spaces.kind === "error" && <p role="alert">スペースを読み込めませんでした</p>}
    </>
  );
}

// The select of the destination folder in the chosen space; see folderIdToValue for the values.
// Folders in exclude are left out.
export function MoveFolderSelect({
  destination,
  value,
  onChange,
  exclude,
  disabled,
}: {
  destination: MoveDestination;
  value: string;
  onChange: (value: string) => void;
  exclude?: ReadonlySet<string>;
  disabled: boolean;
}) {
  const { folders } = destination;
  return (
    <>
      <label>
        移動先のフォルダ
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || folders.kind === "loading"}
        >
          <option value={folderIdToValue(null)}>{TOP_LEVEL_LABEL}</option>
          {folders.kind === "ok" &&
            folderOptions(folders.value, exclude).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
        </select>
      </label>
      {folders.kind === "error" && <p role="alert">フォルダを読み込めませんでした</p>}
    </>
  );
}
