import { SPACE_KIND_DESCRIPTIONS, spaceDisplayName } from "../format";
import { childFolders, folderPath } from "../folders";
import { Link } from "../Link";
import { type ApiClient, loadFolderView, useView } from "../load";
import { isValidId } from "../router";
import { SpaceKindBadge, ViewStatus, useDocumentTitle, viewTitle } from "./common";
import { EntryList } from "./EntryList";
import { FolderActions } from "./FolderActions";

export function FolderView({ client, id }: { client: ApiClient; id: string }) {
  const [state, reload] = useView(() => loadFolderView(client, id), id);
  useDocumentTitle(viewTitle(state, (data) => data.folder.name));

  if (state.kind !== "ready") {
    return <ViewStatus state={state} notFoundMessage="フォルダが見つかりません" onReload={reload} />;
  }
  const { folder, space, folders, pages } = state.data;
  const spaceName = spaceDisplayName(space);
  // Without the folder itself. Empty if the folder list is older than the folder.
  const ancestors = folderPath(folders, folder.id).slice(0, -1);
  return (
    <main className="main">
      <nav className="breadcrumbs" aria-label="パンくずリスト">
        <ol>
          <li>
            <Link to="/">スペース</Link>
          </li>
          <li>{isValidId(space.id) ? <Link to={`/spaces/${space.id}`}>{spaceName}</Link> : spaceName}</li>
          {ancestors.map((ancestor) => (
            <li key={ancestor.id}>
              {isValidId(ancestor.id) ? <Link to={`/folders/${ancestor.id}`}>{ancestor.name}</Link> : ancestor.name}
            </li>
          ))}
          <li aria-current="page">{folder.name}</li>
        </ol>
      </nav>
      <FolderActions
        client={client}
        space={space}
        folders={folders}
        folder={folder}
        heading={
          <>
            <h1>{folder.name}</h1>
            <p className="title-note">
              <SpaceKindBadge kind={space.kind} />
              {SPACE_KIND_DESCRIPTIONS[space.kind]}
            </p>
          </>
        }
        onReload={reload}
      />
      <EntryList
        folders={childFolders(folders, folder.id)}
        pages={pages.filter((page) => page.folder_id === folder.id)}
        emptyMessage="このフォルダは空です"
      />
    </main>
  );
}
