import type { Role } from "../auth/validate";

export type User = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  // UNIX time in milliseconds.
  created_at: number;
  // UNIX time in milliseconds.
  last_login_at: number | null;
};

export type UserList = {
  users: User[];
};

export type ApiError = {
  error: {
    // snake_case error code, e.g. `invalid_email`, `not_found`.
    code: string;
    message: string;
  };
};

export type ChangeMyPasswordRequest = {
  current_password: string;
  new_password: string;
};

export type CreateUserRequest = {
  email: string;
  name?: string | null;
  password: string;
  role: Role;
};

// CreateUserRequest after validation. email is normalized and a missing or blank name is null.
export type CreateUserInput = {
  email: string;
  name: string | null;
  password: string;
  role: Role;
};

export type ResetPasswordRequest = {
  password: string;
};

export type UpdateUserRequest = {
  role: Role;
};

export type SpaceKind = "everyone" | "admin" | "personal";

export type Space = {
  id: string;
  kind: SpaceKind;
  // null for personal spaces; clients decide the display name.
  name: string | null;
  // UNIX time in milliseconds.
  created_at: number;
  // UNIX time in milliseconds.
  updated_at: number;
};

export type SpaceList = {
  spaces: Space[];
};

// Personal spaces are created with their user and cannot be created here.
export type CreateSpaceRequest = {
  kind: "everyone" | "admin";
  name: string;
};

// CreateSpaceRequest after validation. name is trimmed.
export type CreateSpaceInput = {
  kind: "everyone" | "admin";
  name: string;
};

export type UpdateSpaceRequest = {
  name: string;
};

// Folders organize pages inside one space and carry no permissions of their own.
export type Folder = {
  id: string;
  space_id: string;
  // null for a folder at the top level of the space.
  parent_id: string | null;
  name: string;
  // null once the user is deleted.
  created_by: string | null;
  // null once the user is deleted.
  updated_by: string | null;
  // UNIX time in milliseconds.
  created_at: number;
  // UNIX time in milliseconds.
  updated_at: number;
};

// All folders of a space as a flat list, ordered by name and id. Build the tree with parent_id.
export type FolderList = {
  folders: Folder[];
};

// A missing or null parent_id creates the folder at the top level of the space.
export type CreateFolderRequest = {
  name: string;
  parent_id?: string | null;
};

// CreateFolderRequest after validation. name is trimmed and a missing parent_id is null.
export type CreateFolderInput = {
  name: string;
  parentId: string | null;
};

// At least one of name and parent_id is required; this is checked at runtime, not by the type.
// parent_id null moves the folder to the top level; the folder stays in its space.
export type UpdateFolderRequest = {
  name?: string;
  parent_id?: string | null;
};

// UpdateFolderRequest after validation. name is trimmed; undefined keeps the current value.
export type UpdateFolderInput = {
  name?: string;
  parentId?: string | null;
};

// A page without its body, as returned by page lists.
export type PageSummary = {
  id: string;
  space_id: string;
  // null for a page at the top level of the space.
  folder_id: string | null;
  title: string;
  // Starts at 1 and is incremented on every update. Send it back when updating.
  version: number;
  // null once the user is deleted.
  created_by: string | null;
  // null once the user is deleted.
  updated_by: string | null;
  // UNIX time in milliseconds.
  created_at: number;
  // UNIX time in milliseconds.
  updated_at: number;
};

// PageSummary with the body. Written out flat rather than as an intersection so that it is
// the same type as the response inferred by hc<AppType>().
export type Page = {
  id: string;
  space_id: string;
  folder_id: string | null;
  title: string;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
  // Markdown.
  body: string;
};

export type PageList = {
  pages: PageSummary[];
};

export type CreatePageRequest = {
  title: string;
  body: string;
  // A folder in the same space. Missing or null puts the page at the top level of the space.
  folder_id?: string | null;
};

// CreatePageRequest after validation. title is trimmed and a missing folder_id is null.
export type CreatePageInput = {
  title: string;
  body: string;
  folderId: string | null;
};

// At least one of title, body and folder_id is required; this is checked at runtime, not by the type.
export type UpdatePageRequest = {
  // The version the change is based on. A different current version is a conflict.
  version: number;
  title?: string;
  body?: string;
  // Moves the page to a folder in the same space; null moves it to the top level.
  folder_id?: string | null;
};

// UpdatePageRequest after validation. title is trimmed; undefined keeps the current value.
export type UpdatePageInput = {
  version: number;
  title?: string;
  body?: string;
  folderId?: string | null;
};

// A page found by search, without its body. Written out flat like Page.
export type SearchHit = {
  id: string;
  space_id: string;
  folder_id: string | null;
  title: string;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
  // The body around the first match: 40 characters before, the match, and 40 after.
  // null when only the title matches.
  snippet: string | null;
};

export type SearchResult = {
  hits: SearchHit[];
  // true when more than 50 pages matched; only the first 50 are returned.
  has_more: boolean;
};
