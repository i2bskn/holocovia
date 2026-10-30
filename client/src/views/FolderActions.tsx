import { type FormEvent, useState } from "react";
import type { Folder } from "../../../src/api/types";
import { type FolderActionResult, createFolder, deleteFolder, updateFolder } from "../actions";
import { folderOptions } from "../edit";
import { descendantIds } from "../folders";
import { Link } from "../Link";
import type { ApiClient } from "../load";
import { isValidId, navigate } from "../router";
import { TOP_LEVEL_LABEL, folderIdToValue, valueToFolderId } from "./PageEditor";

type Operation = "create" | "rename" | "move" | "delete";

type Failure =
  | { kind: "text"; text: string }
  // The folder of a rename, move or delete is gone.
  | { kind: "folderGone" };

const UNKNOWN_RESULT_MESSAGE = "サーバーに接続できませんでした。読み込み直して確かめてください";
const CREATE_NOT_FOUND_MESSAGE = "スペースかフォルダが見つかりません。読み込み直してください";

// The links and buttons below the heading of a space (folder null) or a folder: creating a page and a
// folder in it, and renaming, moving and deleting the folder. One operation is open at a time.
export function FolderActions({
  client,
  spaceId,
  folders,
  folder,
  onReload,
}: {
  client: ApiClient;
  spaceId: string;
  // All the folders of the space.
  folders: Folder[];
  folder: Folder | null;
  onReload: () => void;
}) {
  const [open, setOpen] = useState<Operation | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [name, setName] = useState("");
  // The value of the move select; see folderIdToValue.
  const [parentValue, setParentValue] = useState("");

  if (!isValidId(spaceId)) return null;
  const folderId = folder !== null && isValidId(folder.id) ? folder.id : null;
  const newPagePath = folderId !== null ? `/spaces/${spaceId}/new?folder=${folderId}` : `/spaces/${spaceId}/new`;

  function openOperation(operation: Operation) {
    setOpen(operation);
    setFailure(null);
    setName(operation === "rename" && folder ? folder.name : "");
    setParentValue(folderIdToValue(folder?.parent_id ?? null));
  }

  function close() {
    setOpen(null);
    setFailure(null);
  }

  // Where to go after the folder is deleted: its parent, or the space.
  function pathAfterDelete(): string {
    const parentId = folder?.parent_id ?? null;
    return parentId !== null && isValidId(parentId) ? `/folders/${parentId}` : `/spaces/${spaceId}`;
  }

  async function run(operation: Operation, call: () => Promise<FolderActionResult>) {
    setSending(true);
    setFailure(null);
    const result = await call();
    switch (result.kind) {
      case "ok":
        if (operation === "delete") {
          navigate(pathAfterDelete());
          return;
        }
        setSending(false);
        setOpen(null);
        onReload();
        return;
      case "notFound":
        setSending(false);
        setFailure(operation === "create" ? { kind: "text", text: CREATE_NOT_FOUND_MESSAGE } : { kind: "folderGone" });
        return;
      case "error":
        setSending(false);
        setFailure({ kind: "text", text: result.message });
        return;
      case "unknown":
        setSending(false);
        setFailure({ kind: "text", text: UNKNOWN_RESULT_MESSAGE });
        return;
      case "redirecting":
        // The move to the login page has started; the buttons stay disabled.
        return;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    switch (open) {
      case "create":
        void run("create", () => createFolder(client, spaceId, { name, parentId: folderId }));
        return;
      case "rename":
        if (folderId !== null) void run("rename", () => updateFolder(client, folderId, { name }));
        return;
      case "move":
        if (folderId !== null) {
          void run("move", () => updateFolder(client, folderId, { parent_id: valueToFolderId(parentValue) }));
        }
        return;
      case "delete":
        if (folderId !== null) void run("delete", () => deleteFolder(client, folderId));
        return;
      case null:
        return;
    }
  }

  // The folder itself and the folders inside it cannot be its parent.
  const moveExclude = folderId !== null ? descendantIds(folders, folderId).add(folderId) : new Set<string>();

  return (
    <>
      <div className="folder-actions">
        <Link to={newPagePath}>ページを作成</Link>
        <button type="button" onClick={() => openOperation("create")} disabled={sending}>
          フォルダを作成
        </button>
        {folderId !== null && (
          <>
            <button type="button" onClick={() => openOperation("rename")} disabled={sending}>
              名前を変更
            </button>
            <button type="button" onClick={() => openOperation("move")} disabled={sending}>
              移動
            </button>
            <button type="button" onClick={() => openOperation("delete")} disabled={sending}>
              削除
            </button>
          </>
        )}
      </div>
      {open !== null && (
        <form className="folder-form" aria-label={OPERATION_LABELS[open]} onSubmit={onSubmit}>
          {open === "create" && (
            <label>
              フォルダの名前
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={sending} />
            </label>
          )}
          {open === "rename" && (
            <label>
              新しい名前
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={sending} />
            </label>
          )}
          {open === "move" && (
            <label>
              移動先
              <select value={parentValue} onChange={(event) => setParentValue(event.target.value)} disabled={sending}>
                <option value={folderIdToValue(null)}>{TOP_LEVEL_LABEL}</option>
                {folderOptions(folders, moveExclude).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {open === "delete" && <p>このフォルダを削除します。中にページやフォルダがあると削除できません。</p>}
          <div className="folder-form-actions">
            <button type="submit" disabled={sending}>
              {SUBMIT_LABELS[open]}
            </button>
            <button type="button" onClick={close} disabled={sending}>
              やめる
            </button>
          </div>
          {failure?.kind === "text" && <p role="alert">{failure.text}</p>}
          {failure?.kind === "folderGone" && (
            <p role="alert">
              このフォルダは見つかりません。削除された可能性があります <Link to={`/spaces/${spaceId}`}>スペースへ</Link>
            </p>
          )}
        </form>
      )}
    </>
  );
}

const OPERATION_LABELS: Record<Operation, string> = {
  create: "フォルダを作成",
  rename: "名前を変更",
  move: "移動",
  delete: "削除",
};

const SUBMIT_LABELS: Record<Operation, string> = {
  create: "作成",
  rename: "保存",
  move: "移動",
  delete: "削除",
};
