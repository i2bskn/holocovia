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
