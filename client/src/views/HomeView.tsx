import { SPACE_KIND_LABELS, spaceDisplayName } from "../format";
import { Link } from "../Link";
import { type ApiClient, loadHomeView, useView } from "../load";
import { isValidId } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";

export function HomeView({ client }: { client: ApiClient }) {
  const [state, reload] = useView(() => loadHomeView(client), "home");
  useDocumentTitle(viewTitle(state, () => null));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="ページが見つかりません" onReload={reload} />;
  }
  const { spaces } = state.data;
  return (
    <main className="main">
      <h1>スペース</h1>
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
