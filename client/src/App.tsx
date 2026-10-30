import { useEffect, useState } from "react";
import type { Space, SpaceKind, User } from "../../src/api/types";
import {
  LoginRequiredError,
  createApiClient,
  createApiFetch,
  responseErrorMessage,
  unexpectedResponseMessage,
} from "./api";

const client = createApiClient(
  createApiFetch({
    fetch: globalThis.fetch.bind(globalThis),
    redirectToLogin: (url) => location.assign(url),
    currentPath: () => location.pathname + location.search,
  }),
);

type State =
  | { kind: "loading" }
  | { kind: "ready"; user: User; spaces: Space[] }
  | { kind: "error"; message: string }
  | { kind: "redirecting" };

const CONNECTION_ERROR = "サーバーに接続できませんでした";

const SPACE_KIND_LABELS: Record<SpaceKind, string> = {
  everyone: "全員",
  admin: "管理者のみ",
  personal: "自分だけ",
};

// Reads the JSON body of an ok response. null if it is not JSON.
async function readJson<T>(res: { json(): Promise<T> }): Promise<T | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function load(): Promise<State> {
  const [me, spaces] = await Promise.allSettled([client.api.v1.me.$get(), client.api.v1.spaces.$get()]);
  // Moving to the login page takes precedence over showing an error.
  for (const result of [me, spaces]) {
    if (result.status === "rejected" && result.reason instanceof LoginRequiredError) return { kind: "redirecting" };
  }
  if (me.status === "rejected" || spaces.status === "rejected") return { kind: "error", message: CONNECTION_ERROR };
  if (!me.value.ok) return { kind: "error", message: await responseErrorMessage(me.value) };
  if (!spaces.value.ok) return { kind: "error", message: await responseErrorMessage(spaces.value) };

  const user = await readJson(me.value);
  if (user === null) return { kind: "error", message: unexpectedResponseMessage(me.value.status) };
  const list = await readJson(spaces.value);
  if (list === null) return { kind: "error", message: unexpectedResponseMessage(spaces.value.status) };
  return { kind: "ready", user, spaces: list.spaces };
}

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  // Incremented by the reload button to load again from the start.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  switch (state.kind) {
    case "loading":
      return <p className="status">読み込み中…</p>;
    case "redirecting":
      return <p className="status">ログイン画面へ移動しています…</p>;
    case "error":
      return (
        <main className="main">
          <h1>読み込みに失敗しました</h1>
          <p>{state.message}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            再読み込み
          </button>
        </main>
      );
    case "ready":
      return <Home user={state.user} spaces={state.spaces} />;
  }
}

function Home({ user, spaces }: { user: User; spaces: Space[] }) {
  return (
    <>
      <header className="header">
        <span className="brand">holocovia</span>
        <div className="account">
          <span className="user">
            {user.name ?? user.email}
            {user.role === "admin" && <span className="role">管理者</span>}
          </span>
          <form method="post" action="/auth/logout">
            <button type="submit">ログアウト</button>
          </form>
        </div>
      </header>
      <main className="main">
        <h1>スペース</h1>
        {spaces.length === 0 ? (
          <p>スペースがありません</p>
        ) : (
          <ul className="spaces">
            {spaces.map((space) => (
              <li key={space.id}>
                <span className="space-name">{space.kind === "personal" ? "個人スペース" : space.name}</span>
                <span className="space-kind">{SPACE_KIND_LABELS[space.kind]}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
