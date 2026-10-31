import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { Page, PageSummary, Space } from "../../../src/api/types";
import { movePage, setTopPage, trashPage } from "../actions";
import { markdownLinkToPage } from "../edit";
import { formatDateTime, spaceDisplayName, widerVisibilityWarning } from "../format";
import { folderPath } from "../folders";
import { Link } from "../Link";
import { type ApiClient, type ListResult, loadBacklinks, loadPageView, loadTopPage, useView } from "../load";
import { Markdown } from "../Markdown";
import { isValidId, navigate } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";
import { MoveFolderSelect, MoveSpaceSelect, useMoveDestination } from "./MoveDestination";
import { folderIdToValue, valueToFolderId } from "./PageEditor";

export function PageView({
  client,
  id,
  origin,
  isAdmin,
}: {
  client: ApiClient;
  id: string;
  origin: string;
  isAdmin: boolean;
}) {
  const [state, reload] = useView(() => loadPageView(client, id), id);
  // Whether the confirmation of moving the page to the trash is shown.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Whether the panel to move the page is shown.
  const [moving, setMoving] = useState(false);
  const [copy, setCopy] = useState<CopyState>({ kind: "idle" });
  useDocumentTitle(viewTitle(state, (data) => data.page.title));

  // The result of copying the link is about the page it was copied from.
  useEffect(() => {
    setCopy({ kind: "idle" });
  }, [id]);

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
            <button
              type="button"
              className="page-copy-link-button"
              onClick={() => void copyLink(markdownLinkToPage(page.title, page.id), setCopy)}
            >
              リンクをコピー
            </button>
          </>
        )}
        {!moving && (
          <button type="button" className="page-move-button" onClick={() => setMoving(true)}>
            移動
          </button>
        )}
        {!confirmingDelete && (
          <button type="button" className="page-delete-button" onClick={() => setConfirmingDelete(true)}>
            削除
          </button>
        )}
      </p>
      {/* Outside the p above, which cannot contain these. */}
      {copy.kind === "copied" && <p role="status">コピーしました</p>}
      {copy.kind === "failed" && <CopyFallback markdown={copy.markdown} />}
      {/* Only pages in an everyone space can be shown at the top; the server checks it again. */}
      {isAdmin && space?.kind === "everyone" && <TopPageButton client={client} page={page} />}
      {moving && (
        <MovePage
          client={client}
          page={page}
          space={space}
          onCancel={() => setMoving(false)}
          onReload={() => {
            setMoving(false);
            reload();
          }}
        />
      )}
      {confirmingDelete && <TrashPage client={client} page={page} onCancel={() => setConfirmingDelete(false)} />}
      <Markdown body={page.body} origin={origin} />
      <Backlinks client={client} pageId={page.id} />
    </main>
  );
}

type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "failed"; markdown: string };

// Writes the Markdown link to the clipboard. The clipboard API is missing outside secure contexts and can
// reject, for example when the permission is denied; then the link is shown to be copied by hand.
async function copyLink(markdown: string, setCopy: (state: CopyState) => void): Promise<void> {
  // The result of the previous click is cleared.
  setCopy({ kind: "idle" });
  try {
    if (typeof navigator.clipboard?.writeText !== "function") throw new Error("no clipboard API");
    await navigator.clipboard.writeText(markdown);
    setCopy({ kind: "copied" });
  } catch {
    setCopy({ kind: "failed", markdown });
  }
}

// The link in a read-only input, selected so that it can be copied with the keyboard or the menu.
function CopyFallback({ markdown }: { markdown: string }) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.select();
  }, [markdown]);

  return (
    <div className="copy-fallback">
      <p role="alert">コピーできませんでした。選択してコピーしてください</p>
      <input
        ref={input}
        type="text"
        readOnly
        value={markdown}
        aria-label="ページへのリンク"
        onFocus={(event) => event.currentTarget.select()}
      />
    </div>
  );
}

type BacklinksState = { kind: "loading" } | ListResult<{ pages: PageSummary[]; hasMore: boolean }>;

// The pages that link to the page, loaded separately so that a failure does not hide the page.
function Backlinks({ client, pageId }: { client: ApiClient; pageId: string }) {
  const [state, setState] = useState<BacklinksState>({ kind: "loading" });
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void loadBacklinks(client, pageId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
    // client does not change while the screen is shown.
  }, [pageId]);

  // The move to the login page has started.
  if (state.kind === "redirecting") return null;
  return (
    <section className="backlinks" aria-labelledby={headingId}>
      <h2 id={headingId}>このページへのリンク</h2>
      {state.kind === "loading" && <p>読み込み中…</p>}
      {state.kind === "error" && <p>リンクの一覧を読み込めませんでした</p>}
      {state.kind === "ok" && state.value.pages.length === 0 && <p>このページへのリンクはありません</p>}
      {state.kind === "ok" && state.value.pages.length > 0 && (
        <ul className="backlinks-list">
          {state.value.pages.map((linking) => (
            <li key={linking.id}>
              <span className="backlinks-title">
                {isValidId(linking.id) ? <Link to={`/pages/${linking.id}`}>{linking.title}</Link> : linking.title}
              </span>
              <span className="page-meta">
                <time dateTime={new Date(linking.updated_at).toISOString()}>{formatDateTime(linking.updated_at)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.kind === "ok" && state.value.hasMore && <p>ほかにもあります（新しい 50 件を表示しています）</p>}
    </section>
  );
}

type MoveState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string }
  // Someone else updated the page after it was loaded.
  | { kind: "conflict" }
  // The move to the login page has started; the buttons stay disabled.
  | { kind: "redirecting" };

const MOVE_UNKNOWN_RESULT_MESSAGE = "サーバーに接続できませんでした。読み込み直して確かめてください";

// The panel to move the page to another space or folder. space is the page's space, or null when it could
// not be loaded; then its kind is taken from the list of spaces.
function MovePage({
  client,
  page,
  space,
  onCancel,
  onReload,
}: {
  client: ApiClient;
  page: Page;
  space: Space | null;
  onCancel: () => void;
  onReload: () => void;
}) {
  const [state, setState] = useState<MoveState>({ kind: "idle" });
  const [spaceId, setSpaceId] = useState(page.space_id);
  // The value of the folder select; see folderIdToValue.
  const [folderValue, setFolderValue] = useState(folderIdToValue(page.folder_id));
  const destination = useMoveDestination(client, true, spaceId, (next) => {
    setSpaceId(next);
    setFolderValue(folderIdToValue(null));
  });

  const spaces = destination.spaces;
  const source = space ?? (spaces.kind === "ok" ? (spaces.value.find((s) => s.id === page.space_id) ?? null) : null);
  const dest = destination.space;
  const folderId = valueToFolderId(folderValue);
  const warning = source && dest ? widerVisibilityWarning(source.kind, dest) : null;
  const unchanged = spaceId === page.space_id && folderId === page.folder_id;
  const busy = state.kind === "sending" || state.kind === "redirecting";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "sending" });
    const result = await movePage(client, page.id, { version: page.version, spaceId, folderId });
    switch (result.kind) {
      case "ok":
        // The breadcrumbs show the new space and folder after the reload.
        onReload();
        return;
      case "conflict":
        setState({ kind: "conflict" });
        return;
      case "notFound":
        setState({ kind: "error", message: "このページは見つかりません。削除された可能性があります" });
        return;
      case "error":
        setState({ kind: "error", message: result.message });
        return;
      case "unknown":
        setState({ kind: "error", message: MOVE_UNKNOWN_RESULT_MESSAGE });
        return;
      case "redirecting":
        setState({ kind: "redirecting" });
        return;
    }
  }

  return (
    <form className="folder-form" aria-label="ページを移動" onSubmit={(event) => void onSubmit(event)}>
      <MoveSpaceSelect destination={destination} disabled={busy} />
      <MoveFolderSelect destination={destination} value={folderValue} onChange={setFolderValue} disabled={busy} />
      {warning !== null && <p>{warning}</p>}
      <div className="folder-form-actions">
        <button
          type="submit"
          disabled={
            busy ||
            unchanged ||
            spaces.kind !== "ok" ||
            destination.folders.kind === "loading" ||
            // Without the kinds of both spaces, whether the move widens the visibility is not known.
            source === null ||
            dest === null
          }
        >
          {warning !== null ? "公開範囲を広げて移動" : "移動"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      </div>
      {state.kind === "error" && <p role="alert">{state.message}</p>}
      {state.kind === "conflict" && (
        <p role="alert">
          このページは他の人に更新されています。読み込み直してからやり直してください{" "}
          <button type="button" onClick={onReload}>
            読み込み直す
          </button>
        </p>
      )}
    </form>
  );
}

type TopPageState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string }
  // The move to the login page has started; the button stays disabled.
  | { kind: "redirecting" };

// The button for admins to show the page at the top of the home screen, or to stop showing it. The current
// top page is loaded to tell which; nothing is shown until it is loaded. It loads the whole top page only to
// compare the ID.
function TopPageButton({ client, page }: { client: ApiClient; page: Page }) {
  const [current, setCurrent] = useState<{ kind: "loading" } | ListResult<Page | null>>({ kind: "loading" });
  const [state, setState] = useState<TopPageState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    setCurrent({ kind: "loading" });
    void loadTopPage(client).then((next) => {
      if (!cancelled) setCurrent(next);
    });
    return () => {
      cancelled = true;
    };
    // client does not change while the screen is shown.
  }, [page.id]);

  if (current.kind !== "ok") return null;
  const isTop = current.value?.id === page.id;

  async function onClick() {
    setState({ kind: "sending" });
    const result = await setTopPage(client, isTop ? null : page.id);
    switch (result.kind) {
      case "ok":
        setCurrent({ kind: "ok", value: result.page });
        setState({ kind: "done", message: isTop ? "トップから外しました" : "トップに表示しました" });
        return;
      case "error":
        setState({ kind: "error", message: result.message });
        return;
      case "unknown":
        setState({ kind: "error", message: MOVE_UNKNOWN_RESULT_MESSAGE });
        return;
      case "redirecting":
        setState({ kind: "redirecting" });
        return;
    }
  }

  return (
    <div className="folder-actions">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={state.kind === "sending" || state.kind === "redirecting"}
      >
        {isTop ? "トップから外す" : "トップに表示"}
      </button>
      {state.kind === "done" && <p role="status">{state.message}</p>}
      {state.kind === "error" && <p role="alert">{state.message}</p>}
    </div>
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
