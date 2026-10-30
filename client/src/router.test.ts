import { describe, expect, it } from "vitest";
import { type ClickEvent, matchRoute, shouldHandleClick } from "./router";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("matchRoute", () => {
  it("matches the screens", () => {
    expect(matchRoute("/")).toEqual({ name: "home" });
    expect(matchRoute("/spaces/abc")).toEqual({ name: "space", id: "abc" });
    expect(matchRoute("/pages/abc")).toEqual({ name: "page", id: "abc" });
    expect(matchRoute(`/spaces/${UUID}`)).toEqual({ name: "space", id: UUID });
    expect(matchRoute(`/pages/${UUID}`)).toEqual({ name: "page", id: UUID });
    expect(matchRoute("/folders/abc")).toEqual({ name: "folder", id: "abc" });
    expect(matchRoute(`/folders/${UUID}`)).toEqual({ name: "folder", id: UUID });
  });

  it.each([
    "/pages/..%2F..%2Fusers",
    "/spaces/x%2Fpages",
    "/pages/a%3Fb",
    "/spaces/%E3%81%82",
    "/pages/a.b",
    "/folders/a.b",
    "/folders/..%2Fspaces",
  ])(
    "does not accept the ID in %s",
    (path) => {
      expect(matchRoute(path)).toEqual({ name: "notFound" });
    },
  );

  it("matches the search screen with its query", () => {
    expect(matchRoute("/search?q=abc")).toEqual({ name: "search", query: "abc" });
    expect(matchRoute("/search")).toEqual({ name: "search", query: "" });
    expect(matchRoute("/search?q=")).toEqual({ name: "search", query: "" });
    expect(matchRoute("/search?q=%E6%A4%9C")).toEqual({ name: "search", query: "検" });
    expect(matchRoute("/search?q=a+b")).toEqual({ name: "search", query: "a b" });
    expect(matchRoute("/search?q=a&q=b")).toEqual({ name: "search", query: "a" });
  });

  it("ignores the search part on other screens", () => {
    expect(matchRoute("/spaces/x?a=1")).toEqual({ name: "space", id: "x" });
    expect(matchRoute("/?q=a")).toEqual({ name: "home" });
  });

  it("accepts IDs of up to 64 characters", () => {
    const id64 = "a".repeat(64);
    expect(matchRoute(`/pages/${id64}`)).toEqual({ name: "page", id: id64 });
    expect(matchRoute(`/pages/${"a".repeat(65)}`)).toEqual({ name: "notFound" });
  });

  it.each(["/spaces/", "/spaces/abc/", "/spaces/abc/x", "//spaces/abc", "/pages", "/folders", "/folders/", "/unknown"])(
    "does not match %s",
    (path) => {
      expect(matchRoute(path)).toEqual({ name: "notFound" });
    },
  );
});

describe("shouldHandleClick", () => {
  const click: ClickEvent = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it("handles a plain left click", () => {
    expect(shouldHandleClick(click)).toBe(true);
  });

  it("leaves a click whose default is prevented", () => {
    expect(shouldHandleClick({ ...click, defaultPrevented: true })).toBe(false);
  });

  it("leaves a middle click", () => {
    expect(shouldHandleClick({ ...click, button: 1 })).toBe(false);
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)("leaves a click with %s", (key) => {
    expect(shouldHandleClick({ ...click, [key]: true })).toBe(false);
  });

  it("leaves a link with a target", () => {
    expect(shouldHandleClick(click, "_blank")).toBe(false);
  });
});
