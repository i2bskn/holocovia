import { type FormEvent, useState } from "react";
import type { CreateSpaceRequest } from "../../../src/api/types";
import { createSpace } from "../actions";
import { CREATABLE_SPACE_KINDS, SPACE_KIND_LABELS, isCreatableSpaceKind, spaceDisplayName } from "../format";
import { Link } from "../Link";
import { type ApiClient, loadHomeView, useView } from "../load";
import { isValidId, navigate } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";

const UNKNOWN_RESULT_MESSAGE = "サーバーに接続できませんでした。読み込み直して確かめてください";

export function HomeView({ client, isAdmin }: { client: ApiClient; isAdmin: boolean }) {
  const [state, reload] = useView(() => loadHomeView(client), "home");
  useDocumentTitle(viewTitle(state, () => null));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="ページが見つかりません" onReload={reload} />;
  }
  const { spaces } = state.data;
  return (
    <main className="main">
      <h1>スペース</h1>
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
