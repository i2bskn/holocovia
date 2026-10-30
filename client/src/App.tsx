import type { User } from "../../src/api/types";
import { createApiClient, createApiFetch, unexpectedResponseMessage } from "./api";
import { Link } from "./Link";
import { loadMe, useView } from "./load";
import { matchRoute, usePathname } from "./router";
import { LoadError, NotFound, useDocumentTitle } from "./views/common";
import { ErrorBoundary } from "./views/ErrorBoundary";
import { HomeView } from "./views/HomeView";
import { PageView } from "./views/PageView";
import { SpaceView } from "./views/SpaceView";

// One client for every screen: the shared refresh and the single move to the login page are per instance.
const client = createApiClient(
  createApiFetch({
    fetch: globalThis.fetch.bind(globalThis),
    redirectToLogin: (url) => location.assign(url),
    currentPath: () => location.pathname + location.search,
  }),
);

export function App() {
  // Loaded once; moving between screens does not load it again. Screens load their data after it.
  const [me, reload] = useView(() => loadMe(client), "me");
  const pathname = usePathname();

  switch (me.kind) {
    case "loading":
      return <p className="status">読み込み中…</p>;
    case "redirecting":
      return <p className="status">ログイン画面へ移動しています…</p>;
    case "error":
      return <LoadError message={me.message} onReload={reload} />;
    case "notFound":
      // loadMe reports a 404 as an error; this case only completes the switch.
      return <LoadError message={unexpectedResponseMessage(404)} onReload={reload} />;
    case "ready":
      return (
        <>
          <Header user={me.data} />
          <ErrorBoundary key={pathname}>
            <Screen pathname={pathname} />
          </ErrorBoundary>
        </>
      );
  }
}

function Screen({ pathname }: { pathname: string }) {
  const route = matchRoute(pathname);
  switch (route.name) {
    case "home":
      return <HomeView client={client} />;
    case "space":
      return <SpaceView client={client} id={route.id} />;
    case "page":
      return <PageView client={client} id={route.id} origin={location.origin} />;
    case "notFound":
      return <RouteNotFound />;
  }
}

function RouteNotFound() {
  useDocumentTitle("見つかりません - holocovia");
  return <NotFound message="ページが見つかりません" />;
}

function Header({ user }: { user: User }) {
  return (
    <header className="header">
      <Link to="/" className="brand">
        holocovia
      </Link>
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
  );
}
