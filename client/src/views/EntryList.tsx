import type { Folder, PageSummary } from "../../../src/api/types";
import { formatDateTime } from "../format";
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
  if (folders.length === 0 && pages.length === 0) return <p>{emptyMessage}</p>;
  return (
    <ul className="pages">
      {folders.map((folder) => (
        <li key={folder.id}>
          <span className="folder-name">
            <FolderIcon />
            {isValidId(folder.id) ? <Link to={`/folders/${folder.id}`}>{folder.name}</Link> : folder.name}
          </span>
        </li>
      ))}
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
  );
}

// Decorative: the link text is the folder name, so screen readers skip the icon.
function FolderIcon() {
  return (
    <svg className="folder-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
