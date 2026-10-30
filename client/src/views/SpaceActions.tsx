import { type FormEvent, useState } from "react";
import type { Space } from "../../../src/api/types";
import { type SpaceActionResult, deleteSpace, renameSpace } from "../actions";
import { Link } from "../Link";
import type { ApiClient } from "../load";
import { navigate } from "../router";

type Operation = "rename" | "delete";

type Failure =
  | { kind: "text"; text: string }
  // The space is gone.
  | { kind: "spaceGone" };

const UNKNOWN_RESULT_MESSAGE = "サーバーに接続できませんでした。読み込み直して確かめてください";

// The buttons for admins to rename and delete a space other than a personal space. The caller shows them
// only to admins, for a space with a valid id. One operation is open at a time, independently of
// FolderActions.
export function SpaceActions({ client, space, onReload }: { client: ApiClient; space: Space; onReload: () => void }) {
  const [open, setOpen] = useState<Operation | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [name, setName] = useState("");

  const spaceId = space.id;

  function openOperation(operation: Operation) {
    setOpen(operation);
    setFailure(null);
    setName(operation === "rename" ? (space.name ?? "") : "");
  }

  function close() {
    setOpen(null);
    setFailure(null);
  }

  async function run(operation: Operation, call: () => Promise<SpaceActionResult>) {
    setSending(true);
    setFailure(null);
    const result = await call();
    switch (result.kind) {
      case "ok":
        if (operation === "delete") {
          navigate("/");
          return;
        }
        setSending(false);
        setOpen(null);
        onReload();
        return;
      case "notFound":
        setSending(false);
        setFailure({ kind: "spaceGone" });
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
      case "rename":
        void run("rename", () => renameSpace(client, spaceId, name));
        return;
      case "delete":
        void run("delete", () => deleteSpace(client, spaceId));
        return;
      case null:
        return;
    }
  }

  return (
    <>
      <div className="folder-actions">
        <button type="button" onClick={() => openOperation("rename")} disabled={sending}>
          {OPERATION_LABELS.rename}
        </button>
        <button type="button" onClick={() => openOperation("delete")} disabled={sending}>
          {OPERATION_LABELS.delete}
        </button>
      </div>
      {open !== null && (
        <form className="folder-form" aria-label={OPERATION_LABELS[open]} onSubmit={onSubmit}>
          {open === "rename" && (
            <label>
              新しい名前
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={sending} />
            </label>
          )}
          {open === "delete" && (
            <p>このスペースを削除します。ページ（ゴミ箱のページを含む）やフォルダが残っていると削除できません。</p>
          )}
          <div className="folder-form-actions">
            <button type="submit" disabled={sending}>
              {SUBMIT_LABELS[open]}
            </button>
            <button type="button" onClick={close} disabled={sending}>
              やめる
            </button>
          </div>
          {failure?.kind === "text" && <p role="alert">{failure.text}</p>}
          {failure?.kind === "spaceGone" && (
            <p role="alert">
              このスペースは見つかりません。削除された可能性があります <Link to="/">スペース一覧へ</Link>
            </p>
          )}
        </form>
      )}
    </>
  );
}

const OPERATION_LABELS: Record<Operation, string> = {
  rename: "スペースの名前を変更",
  delete: "スペースを削除",
};

const SUBMIT_LABELS: Record<Operation, string> = {
  rename: "保存",
  delete: "削除",
};
