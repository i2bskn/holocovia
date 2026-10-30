import { formatDateTime, spaceDisplayName } from "../format";
import { Link } from "../Link";
import { type ApiClient, loadPageView, useView } from "../load";
import { Markdown } from "../Markdown";
import { isValidId } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";

export function PageView({ client, id, origin }: { client: ApiClient; id: string; origin: string }) {
  const [state, reload] = useView(() => loadPageView(client, id), id);
  useDocumentTitle(viewTitle(state, (data) => data.page.title));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="ページが見つかりません" onReload={reload} />;
  }
  const { page, space } = state.data;
  // The page is shown even if its space could not be loaded.
  const spaceName = space ? spaceDisplayName(space) : "スペース";
  return (
    <main className="main">
      <nav className="breadcrumbs" aria-label="パンくずリスト">
        <ol>
          <li>
            <Link to="/">スペース</Link>
          </li>
          <li>{isValidId(page.space_id) ? <Link to={`/spaces/${page.space_id}`}>{spaceName}</Link> : spaceName}</li>
          <li aria-current="page">{page.title}</li>
        </ol>
      </nav>
      <h1>{page.title}</h1>
      <p className="page-meta">
        更新: <time dateTime={new Date(page.updated_at).toISOString()}>{formatDateTime(page.updated_at)}</time>
      </p>
      <Markdown body={page.body} origin={origin} />
    </main>
  );
}
