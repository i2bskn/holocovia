// Imported by the client as a value too, so this file must not import any other server code.
import type { SpaceKind } from "../api/types";

// How many people can see a space of each kind: personal (the owner) < admin (all admins) < everyone.
const VISIBILITY_RANK: Record<SpaceKind, number> = { personal: 0, admin: 1, everyone: 2 };

// Whether moving from a space of kind from to one of kind to lets more people see the content.
// Two spaces of the same kind are not wider, even if they are different spaces.
export function widensVisibility(from: SpaceKind, to: SpaceKind): boolean {
  return VISIBILITY_RANK[to] > VISIBILITY_RANK[from];
}
