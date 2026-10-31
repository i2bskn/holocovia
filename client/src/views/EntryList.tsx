import type { Folder, PageSummary } from "../../../src/api/types";
import { formatDateTime } from "../format";
import { ChevronIcon, FolderIcon, PageIcon } from "../icons";
import { Link } from "../Link";
import { isValidId } from "../router";

// Folders first, then pages, in one list. Folders have no updated time, so that the list stays short.
export function EntryList({
  folders,
  pages,
  emptyMessage,
}: {
  folders: Folder[];
  pages: PageSummary[];
  emptyMessage: string;
}) {
  if (folders.length === 0 && pages.length === 0) return <p className="empty">{emptyMessage}</p>;
  return (
    <ul className="entries">
      {folders.map((folder) => (
        <li key={folder.id} className="entry entry-folder">
          <FolderIcon />
          <span className="entry-title">
            {isValidId(folder.id) ? (
              <Link to={`/folders/${folder.id}`} className="stretched">
                {folder.name}
              </Link>
            ) : (
              folder.name
            )}
          </span>
          {isValidId(folder.id) && <ChevronIcon />}
        </li>
      ))}
      {pages.map((page) => (
        <li key={page.id} className="entry">
          <PageIcon />
          <span className="entry-title">
            {isValidId(page.id) ? (
              <Link to={`/pages/${page.id}`} className="stretched">
                {page.title}
              </Link>
            ) : (
              page.title
            )}
          </span>
          <time className="entry-meta" dateTime={new Date(page.updated_at).toISOString()}>
            {formatDateTime(page.updated_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
