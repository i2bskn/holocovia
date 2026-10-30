import { SPACE_KIND_LABELS, spaceDisplayName } from "../format";
import { childFolders } from "../folders";
import { Link } from "../Link";
import { type ApiClient, loadSpaceView, useView } from "../load";
import { isValidId } from "../router";
import { ViewStatus, useDocumentTitle, viewTitle } from "./common";
import { EntryList } from "./EntryList";

export function SpaceView({ client, id }: { client: ApiClient; id: string }) {
  const [state, reload] = useView(() => loadSpaceView(client, id), id);
  useDocumentTitle(viewTitle(state, (data) => spaceDisplayName(data.space)));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="スペースが見つかりません" onReload={reload} />;
  }
  const { space, folders, pages } = state.data;
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
        {isValidId(space.id) && (
          <Link to={`/spaces/${space.id}/trash`} className="trash-link">
            ゴミ箱
          </Link>
        )}
      </div>
      {/* Only the top level; the rest is shown on the folder screens. */}
      <EntryList
        folders={childFolders(folders, null)}
        pages={pages.filter((page) => page.folder_id === null)}
        emptyMessage="ページはまだありません"
      />
    </main>
  );
}
