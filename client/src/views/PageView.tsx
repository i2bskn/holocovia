import { useState } from "react";
import type { Page } from "../../../src/api/types";
import { trashPage } from "../actions";
import { formatDateTime, spaceDisplayName } from "../format";
import { folderPath } from "../folders";
import { Link } from "../Link";
import { type ApiClient, loadPageView, useView } from "../load";
import { Markdown } from "../Markdown";
import { isValidId, navigate } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";

export function PageView({ client, id, origin }: { client: ApiClient; id: string; origin: string }) {
  const [state, reload] = useView(() => loadPageView(client, id), id);
  // Whether the confirmation of moving the page to the trash is shown.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useDocumentTitle(viewTitle(state, (data) => data.page.title));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="ページが見つかりません" onReload={reload} />;
  }
  const { page, space, folders } = state.data;
  // The page is shown even if its space or folders could not be loaded.
  const spaceName = space ? spaceDisplayName(space) : "スペース";
  const path = folders && page.folder_id !== null ? folderPath(folders, page.folder_id) : [];
  return (
    <main className="main">
      <nav className="breadcrumbs" aria-label="パンくずリスト">
        <ol>
          <li>
            <Link to="/">スペース</Link>
          </li>
          <li>{isValidId(page.space_id) ? <Link to={`/spaces/${page.space_id}`}>{spaceName}</Link> : spaceName}</li>
          {path.map((folder) => (
            <li key={folder.id}>
              {isValidId(folder.id) ? <Link to={`/folders/${folder.id}`}>{folder.name}</Link> : folder.name}
            </li>
          ))}
          <li aria-current="page">{page.title}</li>
        </ol>
      </nav>
      <h1>{page.title}</h1>
      <p className="page-meta">
        更新: <time dateTime={new Date(page.updated_at).toISOString()}>{formatDateTime(page.updated_at)}</time>
        {isValidId(page.id) && (
          <>
            <Link to={`/pages/${page.id}/edit`} className="page-edit-link">
              編集
            </Link>
            <Link to={`/pages/${page.id}/history`} className="page-history-link">
              履歴
            </Link>
          </>
        )}
        {!confirmingDelete && (
          <button type="button" className="page-delete-button" onClick={() => setConfirmingDelete(true)}>
            削除
          </button>
        )}
      </p>
      {confirmingDelete && <TrashPage client={client} page={page} onCancel={() => setConfirmingDelete(false)} />}
      <Markdown body={page.body} origin={origin} />
    </main>
  );
}

type TrashState = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string };

const UNKNOWN_RESULT_MESSAGE =
  "サーバーに接続できませんでした。ページを開き直して、ゴミ箱に移っているか確かめてからやり直してください";

// Where to go after the page is moved to the trash: its folder, or its space at the top level.
function pathAfterTrash(page: Page): string | null {
  if (page.folder_id !== null && isValidId(page.folder_id)) return `/folders/${page.folder_id}`;
  if (isValidId(page.space_id)) return `/spaces/${page.space_id}`;
  return null;
}

function TrashPage({ client, page, onCancel }: { client: ApiClient; page: Page; onCancel: () => void }) {
  const [state, setState] = useState<TrashState>({ kind: "idle" });

  async function onTrash() {
    setState({ kind: "sending" });
    const result = await trashPage(client, page.id);
    switch (result.kind) {
      case "ok":
        navigate(pathAfterTrash(page) ?? "/");
        return;
      case "notFound":
        setState({ kind: "error", message: "このページは見つかりません。すでに削除されている可能性があります" });
        return;
      case "error":
        setState({ kind: "error", message: result.message });
        return;
      case "unknown":
        setState({ kind: "error", message: UNKNOWN_RESULT_MESSAGE });
        return;
      case "redirecting":
        // The move to the login page has started; the buttons stay disabled.
        return;
    }
  }

  const sending = state.kind === "sending";
  return (
    <div className="trash-confirm" role="group" aria-label="ゴミ箱に移す">
      <p>このページをゴミ箱に移します。30 日たつと完全に削除されます。</p>
      <div className="trash-actions">
        <button type="button" onClick={() => void onTrash()} disabled={sending}>
          ゴミ箱に移す
        </button>
        <button type="button" onClick={onCancel} disabled={sending}>
          やめる
        </button>
      </div>
      {state.kind === "error" && <p role="alert">{state.message}</p>}
    </div>
  );
}
