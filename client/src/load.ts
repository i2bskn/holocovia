import { useEffect, useState } from "react";
import type { Page, PageSummary, SearchHit, Space, User } from "../../src/api/types";
import {
  LoginRequiredError,
  type createApiClient,
  responseErrorMessage,
  unexpectedResponseMessage,
} from "./api";
import { spaceDisplayName } from "./format";
import { isValidId } from "./router";

export type ApiClient = ReturnType<typeof createApiClient>;

// The state of a screen that loads its own data.
export type ViewState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  // The API answered 404. Spaces and pages the user cannot access are also 404.
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "redirecting" };

export type Loaded<T> = Exclude<ViewState<T>, { kind: "loading" }>;

export const CONNECTION_ERROR = "サーバーに接続できませんでした";

type Result<T> =
  | { kind: "ok"; value: T }
  | { kind: "notFound"; message: string }
  | { kind: "error"; message: string }
  | { kind: "redirecting" };

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

// The JSON body of the ok responses of an hc() call.
type OkJson<R> = R extends { ok: true; json(): Promise<infer T> } ? T : never;

// Reads the JSON body of an ok response. null if it is not JSON.
async function readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Calls the API and sorts the outcome. Never rejects.
async function request<R extends JsonResponse>(call: () => Promise<R>): Promise<Result<OkJson<R>>> {
  let res: R;
  try {
    res = await call();
  } catch (error) {
    if (error instanceof LoginRequiredError) return { kind: "redirecting" };
    return { kind: "error", message: CONNECTION_ERROR };
  }
  if (res.status === 404) return { kind: "notFound", message: await responseErrorMessage(res) };
  if (!res.ok) return { kind: "error", message: await responseErrorMessage(res) };
  const body = await readJson(res);
  if (body === null) return { kind: "error", message: unexpectedResponseMessage(res.status) };
  // res.ok is true here, so the body is one of the ok bodies.
  return { kind: "ok", value: body as OkJson<R> };
}

// Combines the results of the calls of one screen, at least one of which is not ok:
// redirecting > not found > error.
function failure(results: Result<unknown>[]): Loaded<never> {
  if (results.some((r) => r.kind === "redirecting")) return { kind: "redirecting" };
  if (results.some((r) => r.kind === "notFound")) return { kind: "notFound" };
  for (const r of results) {
    if (r.kind === "error") return { kind: "error", message: r.message };
  }
  throw new Error("failure() needs a result that is not ok");
}

export async function loadMe(client: ApiClient): Promise<Loaded<User>> {
  const me = await request(() => client.api.v1.me.$get());
  if (me.kind === "redirecting") return me;
  // There is no "not found" for the signed-in user; show it as an error.
  if (me.kind === "notFound" || me.kind === "error") return { kind: "error", message: me.message };
  return { kind: "ready", data: me.value };
}

export type HomeData = { spaces: Space[] };

export async function loadHomeView(client: ApiClient): Promise<Loaded<HomeData>> {
  const list = await request(() => client.api.v1.spaces.$get());
  if (list.kind === "redirecting") return list;
  // The list itself is never missing; a 404 here is an unexpected response.
  if (list.kind === "notFound" || list.kind === "error") return { kind: "error", message: list.message };
  return { kind: "ready", data: { spaces: list.value.spaces } };
}

export type SpaceData = { space: Space; pages: PageSummary[] };

export async function loadSpaceView(client: ApiClient, id: string): Promise<Loaded<SpaceData>> {
  if (!isValidId(id)) return { kind: "notFound" };
  const param = { param: { id } };
  const [space, pages] = await Promise.all([
    request(() => client.api.v1.spaces[":id"].$get(param)),
    request(() => client.api.v1.spaces[":id"].pages.$get(param)),
  ]);
  if (space.kind === "ok" && pages.kind === "ok") {
    return { kind: "ready", data: { space: space.value, pages: pages.value.pages } };
  }
  return failure([space, pages]);
}

// space is null when it could not be loaded; the page is shown anyway.
export type PageData = { page: Page; space: Space | null };

export async function loadPageView(client: ApiClient, id: string): Promise<Loaded<PageData>> {
  if (!isValidId(id)) return { kind: "notFound" };
  const page = await request(() => client.api.v1.pages[":id"].$get({ param: { id } }));
  if (page.kind !== "ok") return failure([page]);
  // The space needs space_id from the page, so it is loaded after it.
  const spaceId = page.value.space_id;
  if (!isValidId(spaceId)) return { kind: "ready", data: { page: page.value, space: null } };
  const space = await request(() => client.api.v1.spaces[":id"].$get({ param: { id: spaceId } }));
  if (space.kind === "redirecting") return space;
  return { kind: "ready", data: { page: page.value, space: space.kind === "ok" ? space.value : null } };
}

// query is trimmed. spaceNames maps space_id to the display name; it is empty when the spaces
// could not be loaded, and the results are shown anyway.
export type SearchData = { query: string; hits: SearchHit[]; hasMore: boolean; spaceNames: Map<string, string> };

export async function loadSearchView(client: ApiClient, query: string): Promise<Loaded<SearchData>> {
  const q = query.trim();
  // Only an empty query is checked here; the server checks the rest and its message is shown.
  if (q === "") return { kind: "ready", data: { query: "", hits: [], hasMore: false, spaceNames: new Map() } };
  const [result, list] = await Promise.all([
    request(() => client.api.v1.search.$get({ query: { q } })),
    request(() => client.api.v1.spaces.$get()),
  ]);
  if (result.kind === "redirecting") return result;
  // The search itself is never missing; a 404 here is an unexpected response.
  if (result.kind === "notFound" || result.kind === "error") return { kind: "error", message: result.message };
  if (list.kind === "redirecting") return list;
  const spaceNames = new Map(
    list.kind === "ok" ? list.value.spaces.map((space) => [space.id, spaceDisplayName(space)] as const) : [],
  );
  return { kind: "ready", data: { query: q, hits: result.value.hits, hasMore: result.value.has_more, spaceNames } };
}

// Loads a screen's data while the component is mounted, and again when key changes or reload is called.
// A result that arrives after key has changed is dropped, so a previous screen does not overwrite the state.
export function useView<T>(load: () => Promise<Loaded<T>>, key: string): [ViewState<T>, () => void] {
  const [state, setState] = useState<ViewState<T>>({ kind: "loading" });
  // Incremented by reload to load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
    // load is a new function on every render; key identifies what it loads.
  }, [key, attempt]);

  return [state, () => setAttempt((n) => n + 1)];
}
