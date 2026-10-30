import { type FormEvent, useState } from "react";
import type { CreateSpaceRequest, Page } from "../../../src/api/types";
import { createSpace, setTopPage } from "../actions";
import { CREATABLE_SPACE_KINDS, SPACE_KIND_LABELS, isCreatableSpaceKind, spaceDisplayName } from "../format";
import { Link } from "../Link";
import { type ApiClient, loadHomeView, useView } from "../load";
import { Markdown } from "../Markdown";
import { isValidId, navigate } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";

const UNKNOWN_RESULT_MESSAGE = "サーバーに接続できませんでした。読み込み直して確かめてください";

export function HomeView({ client, isAdmin, origin }: { client: ApiClient; isAdmin: boolean; origin: string }) {
  const [state, reload] = useView(() => loadHomeView(client), "home");
  useDocumentTitle(viewTitle(state, () => null));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="ページが見つかりません" onReload={reload} />;
  }
  const { spaces, topPage, topPageError } = state.data;
  return (
    <main className="main">
      {topPage !== null && (
        <TopPage client={client} page={topPage} isAdmin={isAdmin} origin={origin} onReload={reload} />
      )}
      {topPageError && <p>トップのページを読み込めませんでした</p>}
      {topPage === null && !topPageError && isAdmin && (
        <div className="top-page-help">
          <p>
            トップにはページが表示されていません。全員スペースのページを開いて「トップに表示」を押すと、ここに表示されます。設定したページを全員スペース以外へ移したりゴミ箱に入れたりした場合も表示されず、戻すとまた表示されます
          </p>
          {/* Clears a setting whose page is hidden; harmless when nothing is set. */}
          <ClearTopPage client={client} label="設定を外す" onReload={reload} />
        </div>
      )}
      {topPage !== null ? <h2 className="spaces-heading">スペース</h2> : <h1>スペース</h1>}
      {isAdmin && <CreateSpace client={client} onReload={reload} />}
      {spaces.length === 0 ? (
        <p>スペースがありません</p>
      ) : (
        <ul className="spaces">
          {spaces.map((space) => (
            <li key={space.id}>
              <span className="space-name">
                {isValidId(space.id) ? (
                  <Link to={`/spaces/${space.id}`}>{spaceDisplayName(space)}</Link>
                ) : (
                  spaceDisplayName(space)
                )}
              </span>
              <span className="space-kind">{SPACE_KIND_LABELS[space.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// The page chosen by an admin, shown above the spaces to everyone the same way.
function TopPage({
  client,
  page,
  isAdmin,
  origin,
  onReload,
}: {
  client: ApiClient;
  page: Page;
  isAdmin: boolean;
  origin: string;
  onReload: () => void;
}) {
  return (
    <section className="top-page" aria-label="トップのページ">
      <h1>{isValidId(page.id) ? <Link to={`/pages/${page.id}`}>{page.title}</Link> : page.title}</h1>
      <Markdown body={page.body} origin={origin} />
      {isAdmin && <ClearTopPage client={client} label="トップから外す" onReload={onReload} />}
    </section>
  );
}

type ClearTopPageState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string }
  // The move to the login page has started; the button stays disabled.
  | { kind: "redirecting" };

// The button for admins to clear the top page setting. The screen is loaded again after it is cleared.
function ClearTopPage({ client, label, onReload }: { client: ApiClient; label: string; onReload: () => void }) {
  const [state, setState] = useState<ClearTopPageState>({ kind: "idle" });

  async function onClear() {
    setState({ kind: "sending" });
    const result = await setTopPage(client, null);
    switch (result.kind) {
      case "ok":
        onReload();
        return;
      case "error":
        setState({ kind: "error", message: result.message });
        return;
      case "unknown":
        setState({ kind: "error", message: UNKNOWN_RESULT_MESSAGE });
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
        onClick={() => void onClear()}
        disabled={state.kind === "sending" || state.kind === "redirecting"}
      >
        {label}
      </button>
      {state.kind === "error" && <p role="alert">{state.message}</p>}
    </div>
  );
}

// The button and form for admins to create a space that everyone or only admins can see.
function CreateSpace({ client, onReload }: { client: ApiClient; onReload: () => void }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [kind, setKind] = useState<CreateSpaceRequest["kind"]>("everyone");
  const [name, setName] = useState("");

  function openForm() {
    setOpen(true);
    setFailure(null);
    setKind("everyone");
    setName("");
  }

  function close() {
    setOpen(false);
    setFailure(null);
  }

  async function submit() {
    setSending(true);
    setFailure(null);
    const result = await createSpace(client, { kind, name });
    switch (result.kind) {
      case "ok":
        if (isValidId(result.space.id)) {
          // The buttons stay disabled until the screen changes.
          navigate(`/spaces/${result.space.id}`);
          return;
        }
        setSending(false);
        setOpen(false);
        onReload();
        return;
      case "error":
        setSending(false);
        setFailure(result.message);
        return;
      case "unknown":
        setSending(false);
        setFailure(UNKNOWN_RESULT_MESSAGE);
        return;
      case "redirecting":
        // The move to the login page has started; the buttons stay disabled.
        return;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <>
      <div className="folder-actions">
        <button type="button" onClick={openForm} disabled={sending}>
          スペースを作成
        </button>
      </div>
      {open && (
        <form className="folder-form" aria-label="スペースを作成" onSubmit={onSubmit}>
          <label>
            種類
            <select
              value={kind}
              onChange={(event) => {
                const value = event.target.value;
                if (isCreatableSpaceKind(value)) setKind(value);
              }}
              disabled={sending}
            >
              {CREATABLE_SPACE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {SPACE_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            スペースの名前
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={sending} />
          </label>
          <div className="folder-form-actions">
            <button type="submit" disabled={sending}>
              作成
            </button>
            <button type="button" onClick={close} disabled={sending}>
              やめる
            </button>
          </div>
          {failure !== null && <p role="alert">{failure}</p>}
        </form>
      )}
    </>
  );
}
