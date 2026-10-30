import { describe, expect, it } from "vitest";
import type { SpaceKind } from "../src/api/types";
import { widensVisibility } from "../src/spaces/visibility";

describe("widensVisibility", () => {
  it.each<[SpaceKind, SpaceKind, boolean]>([
    ["personal", "personal", false],
    ["personal", "admin", true],
    ["personal", "everyone", true],
    ["admin", "personal", false],
    ["admin", "admin", false],
    ["admin", "everyone", true],
    ["everyone", "personal", false],
    ["everyone", "admin", false],
    ["everyone", "everyone", false],
  ])("from %s to %s is %s", (from, to, expected) => {
    expect(widensVisibility(from, to)).toBe(expected);
  });
});
