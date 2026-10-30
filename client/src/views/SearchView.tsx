import { formatDateTime, formatSnippet } from "../format";
import { Link } from "../Link";
import { type ApiClient, loadSearchView, useView } from "../load";
import { isValidId } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";

export function SearchView({ client, query }: { client: ApiClient; query: string }) {
  const [state, reload] = useView(() => loadSearchView(client, query), query);
  useDocumentTitle(viewTitle(state, (data) => (data.query === "" ? "検索" : `「${data.query}」の検索結果`)));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="ページが見つかりません" onReload={reload} />;
  }
  const { hits, hasMore, spaceNames } = state.data;
  if (state.data.query === "") {
    return (
      <main className="main">
        <p>検索語を入力してください</p>
      </main>
    );
  }
  return (
    <main className="main">
      <h1>「{state.data.query}」の検索結果</h1>
      {hits.length === 0 ? (
        <p>一致するページはありません</p>
      ) : (
        <ul className="search-results">
          {hits.map((hit) => {
            const spaceName = spaceNames.get(hit.space_id);
            return (
              <li key={hit.id}>
                <div className="search-hit-head">
                  <span className="page-title">
                    {isValidId(hit.id) ? <Link to={`/pages/${hit.id}`}>{hit.title}</Link> : hit.title}
                  </span>
                  <span className="page-meta">
                    {spaceName !== undefined && <span className="search-hit-space">{spaceName}</span>}
                    <time dateTime={new Date(hit.updated_at).toISOString()}>{formatDateTime(hit.updated_at)}</time>
                  </span>
                </div>
                {/* Plain text: snippets are cut from Markdown at any character, so they are not rendered. */}
                {hit.snippet !== null && <p className="search-snippet">{formatSnippet(hit.snippet)}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && <p>一致するページが多いため、最初の 50 件だけを表示しています。検索語を絞り込んでください</p>}
    </main>
  );
}
