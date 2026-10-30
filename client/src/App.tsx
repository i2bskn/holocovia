import type { FormEvent } from "react";
import type { User } from "../../src/api/types";
import { createApiClient, createApiFetch, unexpectedResponseMessage } from "./api";
import { Link } from "./Link";
import { loadMe, useView } from "./load";
import { type Route, matchRoute, navigate, usePath } from "./router";
import { markLeaving } from "./unload";
import { LoadError, NotFound, useDocumentTitle } from "./views/common";
import { ErrorBoundary } from "./views/ErrorBoundary";
import { FolderView } from "./views/FolderView";
import { HomeView } from "./views/HomeView";
import { PageEditView } from "./views/PageEditView";
import { PageHistoryView } from "./views/PageHistoryView";
import { PageNewView } from "./views/PageNewView";
import { PageRevisionView } from "./views/PageRevisionView";
import { PageView } from "./views/PageView";
import { SearchView } from "./views/SearchView";
import { SpaceView } from "./views/SpaceView";
import { TrashView } from "./views/TrashView";

// One client for every screen: the shared refresh and the single move to the login page are per instance.
const client = createApiClient(
  createApiFetch({
    fetch: globalThis.fetch.bind(globalThis),
    redirectToLogin: (url) => {
      markLeaving();
      location.assign(url);
    },
    currentPath: () => location.pathname + location.search,
  }),
);

export function App() {
  // Loaded once; moving between screens does not load it again. Screens load their data after it.
  const [me, reload] = useView(() => loadMe(client), "me");
  const path = usePath();
  const route = matchRoute(path);

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
          <Header user={me.data} route={route} />
          <ErrorBoundary key={path}>
            <Screen route={route} user={me.data} />
          </ErrorBoundary>
        </>
      );
  }
}

function Screen({ route, user }: { route: Route; user: User }) {
  switch (route.name) {
    case "home":
      return <HomeView client={client} isAdmin={user.role === "admin"} />;
    case "space":
      return <SpaceView client={client} id={route.id} isAdmin={user.role === "admin"} />;
    case "trash":
      return <TrashView client={client} id={route.id} isAdmin={user.role === "admin"} />;
    case "folder":
      return <FolderView client={client} id={route.id} />;
    case "page":
      return <PageView client={client} id={route.id} origin={location.origin} />;
    case "pageHistory":
      return <PageHistoryView client={client} id={route.id} />;
    case "pageRevision":
      return <PageRevisionView client={client} id={route.id} version={route.version} origin={location.origin} />;
    case "pageNew":
      return (
        <PageNewView
          client={client}
          spaceId={route.spaceId}
          folderId={route.folderId}
          userId={user.id}
          origin={location.origin}
        />
      );
    case "pageEdit":
      return <PageEditView client={client} id={route.id} userId={user.id} origin={location.origin} />;
    case "search":
      return <SearchView client={client} query={route.query} />;
    case "notFound":
      return <RouteNotFound />;
  }
}

function RouteNotFound() {
  useDocumentTitle("見つかりません - holocovia");
  return <NotFound message="ページが見つかりません" />;
}

function Header({ user, route }: { user: User; route: Route }) {
  // The search screen shows its query; other screens start empty.
  const query = route.name === "search" ? route.query : "";

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const q = typeof value === "string" ? value.trim() : "";
    if (q === "") return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <header className="header">
      <Link to="/" className="brand">
        holocovia
      </Link>
      {/* action and method are used when JavaScript does not run; /search is served by the SPA. */}
      <form role="search" className="search-form" action="/search" method="get" onSubmit={onSearch}>
        <input
          key={query}
          type="search"
          name="q"
          aria-label="ページを検索"
          placeholder="ページを検索"
          maxLength={100}
          defaultValue={query}
        />
        <button type="submit">検索</button>
      </form>
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
