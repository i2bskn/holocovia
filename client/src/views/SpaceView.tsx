import { SPACE_KIND_LABELS, formatDateTime, spaceDisplayName } from "../format";
import { Link } from "../Link";
import { type ApiClient, loadSpaceView, useView } from "../load";
import { isValidId } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";

export function SpaceView({ client, id }: { client: ApiClient; id: string }) {
  const [state, reload] = useView(() => loadSpaceView(client, id), id);
  useDocumentTitle(viewTitle(state, (data) => spaceDisplayName(data.space)));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="スペースが見つかりません" onReload={reload} />;
  }
  const { space, pages } = state.data;
  const name = spaceDisplayName(space);
  return (
    <main className="main">
      <nav className="breadcrumbs" aria-label="パンくずリスト">
        <ol>
          <li>
            <Link to="/">スペース</Link>
          </li>
          <li aria-current="page">{name}</li>
        </ol>
      </nav>
      <div className="title-row">
        <h1>{name}</h1>
        <span className="space-kind">{SPACE_KIND_LABELS[space.kind]}</span>
      </div>
      {pages.length === 0 ? (
        <p>ページはまだありません</p>
      ) : (
        <ul className="pages">
          {pages.map((page) => (
            <li key={page.id}>
              <span className="page-title">
                {isValidId(page.id) ? <Link to={`/pages/${page.id}`}>{page.title}</Link> : page.title}
              </span>
              <time className="page-updated" dateTime={new Date(page.updated_at).toISOString()}>
                {formatDateTime(page.updated_at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
