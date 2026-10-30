import { formatDateTime, spaceDisplayName } from "../format";
import { folderPath } from "../folders";
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
      </p>
      <Markdown body={page.body} origin={origin} />
    </main>
  );
}
