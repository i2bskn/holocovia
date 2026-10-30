import { and, eq, or, type SQL } from "drizzle-orm";
import type { SpaceKind } from "../api/types";
import { spaces, type SpaceRow, type UserRow } from "../db/schema";
import { widensVisibility } from "./visibility";

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

// How the moves of pages and folders between spaces treat a move that lets more people see the content.
// The REST API does not require the acknowledgement (the Web UI warns instead); the MCP tools do.
export type MoveOptions = { requireVisibilityAck: boolean; acknowledged: boolean };

// destName is the display name of the destination space, for the message to the user.
export type VisibilityNotAcknowledged = {
  ok: false;
  error: "visibility_not_acknowledged";
  from: SpaceKind;
  to: SpaceKind;
  destName: string;
};

// Returns the failure if the move from source to dest widens the visibility and needs an acknowledgement
// that was not given, otherwise null. Call it only after the access to both spaces has been checked, so
// that the kind of a space the user cannot access is not revealed.
export function visibilityNotAcknowledged(
  source: Pick<SpaceRow, "kind">,
  dest: Pick<SpaceRow, "kind" | "name">,
  options: MoveOptions,
): VisibilityNotAcknowledged | null {
  if (!options.requireVisibilityAck || options.acknowledged) return null;
  if (!widensVisibility(source.kind, dest.kind)) return null;
  // Personal spaces have no name; this is the name the Web UI shows for them.
  const destName = dest.kind === "personal" ? "個人スペース" : (dest.name ?? "");
  return { ok: false, error: "visibility_not_acknowledged", from: source.kind, to: dest.kind, destName };
}
