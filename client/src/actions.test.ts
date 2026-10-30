import { describe, expect, it, vi } from "vitest";
import type { Page } from "../../src/api/types";
import {
  createFolder,
  createPage,
  deleteFolder,
  purgeTrashedPage,
  restoreRevision,
  restoreTrashedPage,
  trashPage,
  updateFolder,
  updatePage,
} from "./actions";
import { createApiClient, createApiFetch } from "./api";

const PAGE: Page = {
  id: "p1",
  space_id: "s1",
  folder_id: null,
  title: "手順",
  version: 4,
  created_by: "u1",
  updated_by: "u1",
  created_at: 1,
  updated_at: 2,
  body: "# 手順",
};

const RESTORE_URL = "/api/v1/pages/p1/revisions/2/restore";

// fetch that answers expectedUrl (the restore URL unless given) with reply. /auth/refresh answers 401
// unless given, so a 401 ends at the login page.
function setup(reply: () => Response | Promise<Response>, refreshStatus = 401, expectedUrl = RESTORE_URL) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url === "/auth/refresh") return new Response(null, { status: refreshStatus });
    if (url !== expectedUrl) throw new Error(`unexpected fetch: ${url}`);
    return reply();
  });
  const redirectToLogin = vi.fn<(url: string) => void>();
  const client = createApiClient(createApiFetch({ fetch, redirectToLogin, currentPath: () => "/" }));
  return { client, fetch, redirectToLogin };
}

function apiError(code: number, message: string): () => Response {
  return () => Response.json({ error: { code: "error", message } }, { status: code });
}

describe("restoreRevision", () => {
  it("sends the current version and is ok on 200", async () => {
    const { client, fetch } = setup(() => Response.json({ ...PAGE, version: 5 }));
    expect(await restoreRevision(client, "p1", 2, 4)).toEqual({ kind: "ok" });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ version: 4 });
  });

  it("is a conflict on 409", async () => {
    const { client } = setup(apiError(409, "ページが他の人に更新されています。最新の内容を取得してからやり直してください"));
    expect(await restoreRevision(client, "p1", 2, 4)).toEqual({ kind: "conflict" });
  });

  it.each([
    [404, "この版は見つかりません。古い版は新しい 20 版を残して削除されます"],
    [500, "サーバーでエラーが発生しました"],
  ])("is an error with the API message on %i", async (code, message) => {
    const { client } = setup(apiError(code, message));
    expect(await restoreRevision(client, "p1", 2, 4)).toEqual({ kind: "error", message });
  });

  it("is an error with a fixed message when the error is not JSON", async () => {
    const { client } = setup(() => new Response("Bad Gateway", { status: 502 }));
    expect(await restoreRevision(client, "p1", 2, 4)).toEqual({
      kind: "error",
      message: "サーバーから予期しない応答がありました（HTTP 502）",
    });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await restoreRevision(client, "p1", 2, 4)).toEqual({ kind: "unknown" });
  });

  it("is unknown when the token refresh fails", async () => {
    const { client, redirectToLogin } = setup(apiError(401, "ログインしてください"), 500);
    expect(await restoreRevision(client, "p1", 2, 4)).toEqual({ kind: "unknown" });
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("is redirecting when login is required", async () => {
    const { client, redirectToLogin } = setup(apiError(401, "ログインしてください"));
    expect(await restoreRevision(client, "p1", 2, 4)).toEqual({ kind: "redirecting" });
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});

describe("trashPage", () => {
  const url = "/api/v1/pages/p1";

  it("sends DELETE and is ok on 204", async () => {
    const { client, fetch } = setup(() => new Response(null, { status: 204 }), 401, url);
    expect(await trashPage(client, "p1")).toEqual({ kind: "ok" });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "ページが見つかりません"), 401, url);
    expect(await trashPage(client, "p1")).toEqual({ kind: "notFound" });
  });

  it("is an error with the API message on 500", async () => {
    const { client } = setup(apiError(500, "サーバーでエラーが発生しました"), 401, url);
    expect(await trashPage(client, "p1")).toEqual({ kind: "error", message: "サーバーでエラーが発生しました" });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await trashPage(client, "p1")).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client, redirectToLogin } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await trashPage(client, "p1")).toEqual({ kind: "redirecting" });
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});

describe("restoreTrashedPage", () => {
  const url = "/api/v1/pages/p1/restore";

  it("sends POST and returns the page on 200", async () => {
    const { client, fetch } = setup(() => Response.json(PAGE), 401, url);
    expect(await restoreTrashedPage(client, "p1")).toEqual({ kind: "ok", page: PAGE });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("is a conflict on 409", async () => {
    const { client } = setup(apiError(409, "このページはゴミ箱にありません"), 401, url);
    expect(await restoreTrashedPage(client, "p1")).toEqual({ kind: "conflict" });
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "ページが見つかりません"), 401, url);
    expect(await restoreTrashedPage(client, "p1")).toEqual({ kind: "notFound" });
  });

  it("is an error with the API message on 500", async () => {
    const { client } = setup(apiError(500, "サーバーでエラーが発生しました"), 401, url);
    expect(await restoreTrashedPage(client, "p1")).toEqual({ kind: "error", message: "サーバーでエラーが発生しました" });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await restoreTrashedPage(client, "p1")).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await restoreTrashedPage(client, "p1")).toEqual({ kind: "redirecting" });
  });
});

describe("purgeTrashedPage", () => {
  const url = "/api/v1/pages/p1/permanent";

  it("sends DELETE and is ok on 204", async () => {
    const { client, fetch } = setup(() => new Response(null, { status: 204 }), 401, url);
    expect(await purgeTrashedPage(client, "p1")).toEqual({ kind: "ok" });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("is forbidden with the API message on 403", async () => {
    const message = "個人スペースのページは完全に削除できません。30 日たつと自動で削除されます";
    const { client } = setup(apiError(403, message), 401, url);
    expect(await purgeTrashedPage(client, "p1")).toEqual({ kind: "forbidden", message });
  });

  it("is a conflict on 409", async () => {
    const { client } = setup(apiError(409, "ゴミ箱にないページは完全に削除できません。先にゴミ箱へ移してください"), 401, url);
    expect(await purgeTrashedPage(client, "p1")).toEqual({ kind: "conflict" });
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "ページが見つかりません"), 401, url);
    expect(await purgeTrashedPage(client, "p1")).toEqual({ kind: "notFound" });
  });

  it("is an error with the API message on 500", async () => {
    const { client } = setup(apiError(500, "サーバーでエラーが発生しました"), 401, url);
    expect(await purgeTrashedPage(client, "p1")).toEqual({ kind: "error", message: "サーバーでエラーが発生しました" });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await purgeTrashedPage(client, "p1")).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await purgeTrashedPage(client, "p1")).toEqual({ kind: "redirecting" });
  });
});

describe("createPage", () => {
  const url = "/api/v1/spaces/s1/pages";
  const input = { title: " 手順 ", body: "# 手順", folderId: "f1" };

  it("sends the title as typed with the body and the folder, and returns the page on 201", async () => {
    const { client, fetch } = setup(() => Response.json(PAGE, { status: 201 }), 401, url);
    expect(await createPage(client, "s1", input)).toEqual({ kind: "ok", page: PAGE });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ title: " 手順 ", body: "# 手順", folder_id: "f1" });
  });

  it("sends a null folder for the top level", async () => {
    const { client, fetch } = setup(() => Response.json(PAGE, { status: 201 }), 401, url);
    await createPage(client, "s1", { ...input, folderId: null });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ folder_id: null });
  });

  it("is an error when the created page is not JSON", async () => {
    const { client } = setup(() => new Response("created", { status: 201 }), 401, url);
    expect(await createPage(client, "s1", input)).toEqual({
      kind: "error",
      message: "サーバーから予期しない応答がありました（HTTP 201）",
    });
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "スペースが見つかりません"), 401, url);
    expect(await createPage(client, "s1", input)).toEqual({ kind: "notFound" });
  });

  it.each([
    [400, "タイトルは1〜200文字で入力してください"],
    [400, "フォルダが見つかりません"],
    [500, "サーバーでエラーが発生しました"],
  ])("is an error with the API message on %i", async (code, message) => {
    const { client } = setup(apiError(code, message), 401, url);
    expect(await createPage(client, "s1", input)).toEqual({ kind: "error", message });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await createPage(client, "s1", input)).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client, redirectToLogin } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await createPage(client, "s1", input)).toEqual({ kind: "redirecting" });
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});

describe("updatePage", () => {
  const url = "/api/v1/pages/p1";

  it("sends the version with the changes and returns the page on 200", async () => {
    const { client, fetch } = setup(() => Response.json({ ...PAGE, version: 5 }), 401, url);
    expect(await updatePage(client, "p1", 4, { body: "# 新しい手順", folder_id: null })).toEqual({
      kind: "ok",
      page: { ...PAGE, version: 5 },
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ version: 4, body: "# 新しい手順", folder_id: null });
  });

  it("is a conflict on 409", async () => {
    const { client } = setup(apiError(409, "ページが他の人に更新されています"), 401, url);
    expect(await updatePage(client, "p1", 4, { title: "B" })).toEqual({ kind: "conflict" });
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "ページが見つかりません"), 401, url);
    expect(await updatePage(client, "p1", 4, { title: "B" })).toEqual({ kind: "notFound" });
  });

  it.each([
    [400, "本文が大きすぎます"],
    [500, "サーバーでエラーが発生しました"],
  ])("is an error with the API message on %i", async (code, message) => {
    const { client } = setup(apiError(code, message), 401, url);
    expect(await updatePage(client, "p1", 4, { title: "B" })).toEqual({ kind: "error", message });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await updatePage(client, "p1", 4, { title: "B" })).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await updatePage(client, "p1", 4, { title: "B" })).toEqual({ kind: "redirecting" });
  });
});

describe("createFolder", () => {
  const url = "/api/v1/spaces/s1/folders";

  it("sends the name and the parent and is ok on 201", async () => {
    const { client, fetch } = setup(() => Response.json({}, { status: 201 }), 401, url);
    expect(await createFolder(client, "s1", { name: "資料", parentId: "f1" })).toEqual({ kind: "ok" });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "資料", parent_id: "f1" });
  });

  it("sends a null parent for the top level", async () => {
    const { client, fetch } = setup(() => Response.json({}, { status: 201 }), 401, url);
    await createFolder(client, "s1", { name: "資料", parentId: null });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ name: "資料", parent_id: null });
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "スペースが見つかりません"), 401, url);
    expect(await createFolder(client, "s1", { name: "資料", parentId: null })).toEqual({ kind: "notFound" });
  });

  it.each([
    [400, "フォルダ名を入力してください"],
    [400, "親フォルダが見つかりません"],
  ])("is an error with the API message on %i", async (code, message) => {
    const { client } = setup(apiError(code, message), 401, url);
    expect(await createFolder(client, "s1", { name: "", parentId: null })).toEqual({ kind: "error", message });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await createFolder(client, "s1", { name: "資料", parentId: null })).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await createFolder(client, "s1", { name: "資料", parentId: null })).toEqual({ kind: "redirecting" });
  });
});

describe("updateFolder", () => {
  const url = "/api/v1/folders/f1";

  it("sends only the given fields and is ok on 200", async () => {
    const { client, fetch } = setup(() => Response.json({}), 401, url);
    expect(await updateFolder(client, "f1", { name: "新しい名前" })).toEqual({ kind: "ok" });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "新しい名前" });
  });

  it("sends a null parent to move the folder to the top level", async () => {
    const { client, fetch } = setup(() => Response.json({}), 401, url);
    expect(await updateFolder(client, "f1", { parent_id: null })).toEqual({ kind: "ok" });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ parent_id: null });
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "フォルダが見つかりません"), 401, url);
    expect(await updateFolder(client, "f1", { name: "a" })).toEqual({ kind: "notFound" });
  });

  it.each([
    [400, "移動先のフォルダが見つかりません"],
    [409, "フォルダをその中のフォルダへは移動できません"],
  ])("is an error with the API message on %i", async (code, message) => {
    const { client } = setup(apiError(code, message), 401, url);
    expect(await updateFolder(client, "f1", { parent_id: "f2" })).toEqual({ kind: "error", message });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await updateFolder(client, "f1", { name: "a" })).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await updateFolder(client, "f1", { name: "a" })).toEqual({ kind: "redirecting" });
  });
});

describe("deleteFolder", () => {
  const url = "/api/v1/folders/f1";

  it("sends DELETE and is ok on 204", async () => {
    const { client, fetch } = setup(() => new Response(null, { status: 204 }), 401, url);
    expect(await deleteFolder(client, "f1")).toEqual({ kind: "ok" });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("is not found on 404", async () => {
    const { client } = setup(apiError(404, "フォルダが見つかりません"), 401, url);
    expect(await deleteFolder(client, "f1")).toEqual({ kind: "notFound" });
  });

  it("is an error with the API message on 409", async () => {
    const message = "中にページやフォルダがあるフォルダは削除できません";
    const { client } = setup(apiError(409, message), 401, url);
    expect(await deleteFolder(client, "f1")).toEqual({ kind: "error", message });
  });

  it("is unknown when fetch rejects", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("Failed to fetch")), 401, url);
    expect(await deleteFolder(client, "f1")).toEqual({ kind: "unknown" });
  });

  it("is redirecting when login is required", async () => {
    const { client } = setup(apiError(401, "ログインしてください"), 401, url);
    expect(await deleteFolder(client, "f1")).toEqual({ kind: "redirecting" });
  });
});
