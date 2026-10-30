import { describe, expect, it, vi } from "vitest";
import type { Page } from "../../src/api/types";
import { restoreRevision } from "./actions";
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

// fetch that answers the restore URL with reply. /auth/refresh answers 401 unless given, so a 401 ends
// at the login page.
function setup(reply: () => Response | Promise<Response>, refreshStatus = 401) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url === "/auth/refresh") return new Response(null, { status: refreshStatus });
    if (url !== RESTORE_URL) throw new Error(`unexpected fetch: ${url}`);
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
