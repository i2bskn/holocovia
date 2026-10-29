import { and, eq, or, type SQL } from "drizzle-orm";
import { spaces, type SpaceRow, type UserRow } from "../db/schema";

// role must come from the DB on every request (c.get("user")), not from the access token.
export type SpaceViewer = Pick<UserRow, "id" | "role">;

// Access depends only on the space kind, the viewer's role and the space owner.
// Keep in sync with accessibleSpacesWhere.
export function canAccessSpace(viewer: SpaceViewer, space: Pick<SpaceRow, "kind" | "ownerUserId">): boolean {
  switch (space.kind) {
    case "everyone":
      return true;
    case "admin":
      return viewer.role === "admin";
    case "personal":
      return space.ownerUserId === viewer.id;
  }
}

// The same condition as canAccessSpace as a where clause on spaces.
export function accessibleSpacesWhere(viewer: SpaceViewer): SQL {
  const conditions = [
    eq(spaces.kind, "everyone"),
    and(eq(spaces.kind, "personal"), eq(spaces.ownerUserId, viewer.id)),
  ];
  if (viewer.role === "admin") conditions.push(eq(spaces.kind, "admin"));
  const where = or(...conditions);
  if (!where) throw new Error("unreachable: empty space access condition");
  return where;
}
