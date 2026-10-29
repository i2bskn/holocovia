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

// A page without its body, as returned by page lists.
export type PageSummary = {
  id: string;
  space_id: string;
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
};

// CreatePageRequest after validation. title is trimmed.
export type CreatePageInput = CreatePageRequest;

// At least one of title and body is required; this is checked at runtime, not by the type.
export type UpdatePageRequest = {
  // The version the change is based on. A different current version is a conflict.
  version: number;
  title?: string;
  body?: string;
};

// UpdatePageRequest after validation. title is trimmed.
export type UpdatePageInput = UpdatePageRequest;
