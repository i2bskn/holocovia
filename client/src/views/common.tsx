import { useEffect } from "react";
import { Link } from "../Link";
import type { ViewState } from "../load";

const APP_NAME = "holocovia";

// Sets document.title. null keeps the current title (while loading).
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);
}

// The document title for a screen's state. readyTitle is the screen's own title, without the app name.
export function viewTitle<T>(state: ViewState<T>, readyTitle: (data: T) => string | null): string | null {
  switch (state.kind) {
    case "loading":
      return null;
    case "ready": {
      const title = readyTitle(state.data);
      return title === null ? APP_NAME : `${title} - ${APP_NAME}`;
    }
    case "notFound":
      return `見つかりません - ${APP_NAME}`;
    case "error":
    case "redirecting":
      return APP_NAME;
  }
}

export function NotFound({ message }: { message: string }) {
  return (
    <main className="main not-found">
      <h1>{message}</h1>
      <p>
        <Link to="/">スペースの一覧へ</Link>
      </p>
    </main>
  );
}

// Shows a state other than ready.
export function ViewStatus({
  state,
  notFoundMessage,
  onReload,
}: {
  state: Exclude<ViewState<unknown>, { kind: "ready" }>;
  notFoundMessage: string;
  onReload: () => void;
}) {
  switch (state.kind) {
    case "loading":
      return <p className="status">読み込み中…</p>;
    case "redirecting":
      return <p className="status">ログイン画面へ移動しています…</p>;
    case "notFound":
      return <NotFound message={notFoundMessage} />;
    case "error":
      return <LoadError message={state.message} onReload={onReload} />;
  }
}

export function LoadError({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <main className="main">
      <h1>読み込みに失敗しました</h1>
      <p>{message}</p>
      <button type="button" onClick={onReload}>
        再読み込み
      </button>
    </main>
  );
}
