import { describe, expect, it, vi } from "vitest";
import type { Page, PageSummary, SearchHit, Space } from "../../src/api/types";
import { createApiClient, createApiFetch } from "./api";
import { loadPageView, loadSearchView, loadSpaceView } from "./load";

const SPACE: Space = { id: "s1", kind: "everyone", name: "開発", created_at: 1, updated_at: 2 };
const SUMMARY: PageSummary = {
  id: "p1",
  space_id: "s1",
  title: "手順",
  version: 1,
  created_by: "u1",
  updated_by: "u1",
  created_at: 1,
  updated_at: 2,
};
const PAGE: Page = { ...SUMMARY, body: "# 手順" };

type Reply = () => Response;

function json(code: number, body: unknown): Reply {
  return () => Response.json(body, { status: code });
}

function apiError(code: number, message: string): Reply {
  return json(code, { error: { code: "error", message } });
}

// fetch that answers each URL from its own queue, in order. /auth/refresh answers 204 unless given.
function setup(routes: Record<string, Reply[]>) {
  const queues = new Map(Object.entries(routes).map(([url, replies]) => [url, [...replies]]));
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    const reply = queues.get(url)?.shift() ?? (url === "/auth/refresh" ? () => new Response(null, { status: 204 }) : null);
    if (!reply) throw new Error(`unexpected fetch: ${url}`);
    return reply();
  });
  const redirectToLogin = vi.fn<(url: string) => void>();
  const client = createApiClient(createApiFetch({ fetch, redirectToLogin, currentPath: () => "/" }));
  const calls = (url: string) => fetch.mock.calls.filter(([input]) => String(input) === url).length;
  return { client, fetch, redirectToLogin, calls };
}

const unauthorized = apiError(401, "ログインしてください");

describe("loadSpaceView", () => {
  it("shows the space and its pages", async () => {
    const { client } = setup({
      "/api/v1/spaces/s1": [json(200, SPACE)],
      "/api/v1/spaces/s1/pages": [json(200, { pages: [SUMMARY] })],
    });
    expect(await loadSpaceView(client, "s1")).toEqual({ kind: "ready", data: { space: SPACE, pages: [SUMMARY] } });
  });

  it("is not found when the space is 404", async () => {
    const { client } = setup({
      "/api/v1/spaces/s1": [apiError(404, "スペースが見つかりません")],
      "/api/v1/spaces/s1/pages": [apiError(404, "スペースが見つかりません")],
    });
    expect(await loadSpaceView(client, "s1")).toEqual({ kind: "notFound" });
  });

  it("is an error with the API message when the page list is 500", async () => {
    const { client } = setup({
      "/api/v1/spaces/s1": [json(200, SPACE)],
      "/api/v1/spaces/s1/pages": [apiError(500, "サーバーでエラーが発生しました")],
    });
    expect(await loadSpaceView(client, "s1")).toEqual({ kind: "error", message: "サーバーでエラーが発生しました" });
  });

  it.each(["/api/v1/spaces/s1", "/api/v1/spaces/s1/pages"])(
    "moves to the login page when %s stays 401 after the refresh",
    async (url) => {
      const routes: Record<string, Reply[]> = {
        "/api/v1/spaces/s1": [json(200, SPACE)],
        "/api/v1/spaces/s1/pages": [json(200, { pages: [] })],
        "/auth/refresh": [() => new Response(null, { status: 401 })],
      };
      routes[url] = [unauthorized, unauthorized];
      const { client, redirectToLogin } = setup(routes);
      expect(await loadSpaceView(client, "s1")).toEqual({ kind: "redirecting" });
      expect(redirectToLogin).toHaveBeenCalledTimes(1);
    },
  );

  it("prefers not found to an error", async () => {
    const { client } = setup({
      "/api/v1/spaces/s1": [apiError(404, "スペースが見つかりません")],
      "/api/v1/spaces/s1/pages": [apiError(500, "サーバーでエラーが発生しました")],
    });
    expect(await loadSpaceView(client, "s1")).toEqual({ kind: "notFound" });
  });

  it("does not call the API for an invalid ID", async () => {
    const { client, fetch } = setup({});
    expect(await loadSpaceView(client, "../users")).toEqual({ kind: "notFound" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("loadPageView", () => {
  it("shows the page and its space", async () => {
    const { client } = setup({
      "/api/v1/pages/p1": [json(200, PAGE)],
      "/api/v1/spaces/s1": [json(200, SPACE)],
    });
    expect(await loadPageView(client, "p1")).toEqual({ kind: "ready", data: { page: PAGE, space: SPACE } });
  });

  it("is not found without loading the space when the page is 404", async () => {
    const { client, calls } = setup({ "/api/v1/pages/p1": [apiError(404, "ページが見つかりません")] });
    expect(await loadPageView(client, "p1")).toEqual({ kind: "notFound" });
    expect(calls("/api/v1/spaces/s1")).toBe(0);
  });

  it.each([404, 500])("shows the page without the space when the space is %i", async (code) => {
    const { client } = setup({
      "/api/v1/pages/p1": [json(200, PAGE)],
      "/api/v1/spaces/s1": [apiError(code, "失敗")],
    });
    expect(await loadPageView(client, "p1")).toEqual({ kind: "ready", data: { page: PAGE, space: null } });
  });

  it("moves to the login page when the space stays 401 after the refresh", async () => {
    const { client, redirectToLogin } = setup({
      "/api/v1/pages/p1": [json(200, PAGE)],
      "/api/v1/spaces/s1": [unauthorized, unauthorized],
    });
    expect(await loadPageView(client, "p1")).toEqual({ kind: "redirecting" });
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("does not load the space for an invalid space_id", async () => {
    const { client, fetch } = setup({ "/api/v1/pages/p1": [json(200, { ...PAGE, space_id: "a/b" })] });
    const result = await loadPageView(client, "p1");
    expect(result).toEqual({ kind: "ready", data: { page: { ...PAGE, space_id: "a/b" }, space: null } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("loadSearchView", () => {
  const HIT: SearchHit = { ...SUMMARY, snippet: "…手順…" };
  const PERSONAL: Space = { id: "s2", kind: "personal", name: null, created_at: 1, updated_at: 2 };
  const SEARCH_URL = "/api/v1/search?q=%E6%89%8B%E9%A0%86";

  it("shows the hits with the names of their spaces", async () => {
    const { client } = setup({
      [SEARCH_URL]: [json(200, { hits: [HIT], has_more: true })],
      "/api/v1/spaces": [json(200, { spaces: [SPACE, PERSONAL] })],
    });
    expect(await loadSearchView(client, "  手順 ")).toEqual({
      kind: "ready",
      data: {
        query: "手順",
        hits: [HIT],
        hasMore: true,
        spaceNames: new Map([
          ["s1", "開発"],
          ["s2", "個人スペース"],
        ]),
      },
    });
  });

  it("does not call the API for an empty query", async () => {
    const { client, fetch } = setup({});
    expect(await loadSearchView(client, "   ")).toEqual({
      kind: "ready",
      data: { query: "", hits: [], hasMore: false, spaceNames: new Map() },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is an error with the API message when the search is 400", async () => {
    const { client } = setup({
      [SEARCH_URL]: [apiError(400, "検索語は 1 文字以上 100 文字以下で、改行などの制御文字を含まない文字列にしてください")],
      "/api/v1/spaces": [json(200, { spaces: [SPACE] })],
    });
    expect(await loadSearchView(client, "手順")).toEqual({
      kind: "error",
      message: "検索語は 1 文字以上 100 文字以下で、改行などの制御文字を含まない文字列にしてください",
    });
  });

  it("moves to the login page when the search stays 401 after the refresh", async () => {
    const { client, redirectToLogin } = setup({
      [SEARCH_URL]: [unauthorized, unauthorized],
      "/api/v1/spaces": [json(200, { spaces: [SPACE] })],
      "/auth/refresh": [() => new Response(null, { status: 401 })],
    });
    expect(await loadSearchView(client, "手順")).toEqual({ kind: "redirecting" });
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("shows the hits without space names when the spaces fail", async () => {
    const { client } = setup({
      [SEARCH_URL]: [json(200, { hits: [HIT], has_more: false })],
      "/api/v1/spaces": [apiError(500, "サーバーでエラーが発生しました")],
    });
    expect(await loadSearchView(client, "手順")).toEqual({
      kind: "ready",
      data: { query: "手順", hits: [HIT], hasMore: false, spaceNames: new Map() },
    });
  });

  it("moves to the login page when the spaces stay 401 after the refresh", async () => {
    const { client, redirectToLogin } = setup({
      [SEARCH_URL]: [json(200, { hits: [HIT], has_more: false })],
      "/api/v1/spaces": [unauthorized, unauthorized],
      "/auth/refresh": [() => new Response(null, { status: 401 })],
    });
    expect(await loadSearchView(client, "手順")).toEqual({ kind: "redirecting" });
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});
