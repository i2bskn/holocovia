import { formatDateTime, formatSnippet, splitByQuery } from "../format";
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
        <p className="empty">検索語を入力してください</p>
      </main>
    );
  }
  return (
    <main className="main">
      <h1>「{state.data.query}」の検索結果</h1>
      {hits.length > 0 && <p className="title-note">{hasMore ? "50\u00a0件以上" : `${hits.length}\u00a0件`}</p>}
      {hits.length === 0 ? (
        <p className="empty">一致するページはありません</p>
      ) : (
        <ul className="search-results">
          {hits.map((hit) => {
            const spaceName = spaceNames.get(hit.space_id);
            return (
              <li key={hit.id}>
                <div className="search-hit-head">
                  <span className="search-hit-title">
                    {isValidId(hit.id) ? (
                      <Link to={`/pages/${hit.id}`} className="stretched">
                        <Highlighted text={hit.title} query={state.data.query} />
                      </Link>
                    ) : (
                      hit.title
                    )}
                  </span>
                  <span className="search-hit-meta">
                    {spaceName !== undefined && <span className="search-hit-space">{spaceName}</span>}
                    <time dateTime={new Date(hit.updated_at).toISOString()}>{formatDateTime(hit.updated_at)}</time>
                  </span>
                </div>
                {/* Plain text: snippets are cut from Markdown at any character, so they are not rendered. */}
                {hit.snippet !== null && (
                  <p className="search-snippet">
                    <Highlighted text={formatSnippet(hit.snippet)} query={state.data.query} />
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && <p className="notice">一致するページが多いため、最初の&nbsp;50&nbsp;件だけを表示しています。検索語を絞り込んでください</p>}
    </main>
  );
}

// The text with the parts that match the query marked.
function Highlighted({ text, query }: { text: string; query: string }) {
  return splitByQuery(text, query).map((part, index) =>
    // The parts never change order for the same text, so the index is a stable key.
    part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
  );
}
