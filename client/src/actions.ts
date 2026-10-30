import type { Page } from "../../src/api/types";
import { LoginRequiredError, responseErrorMessage, unexpectedResponseMessage } from "./api";
import type { ApiClient } from "./load";

// The outcomes shared by the actions below.
type SendFailure =
  | { kind: "error"; message: string }
  // The request did not get a response, so it may have succeeded on the server.
  | { kind: "unknown" }
  // Login is required and the move to the login page has started.
  | { kind: "redirecting" };

// Sends a request. A rejection becomes the failure to return; never rejects.
async function send<R>(call: () => Promise<R>): Promise<{ kind: "response"; res: R } | SendFailure> {
  try {
    return { kind: "response", res: await call() };
  } catch (error) {
    if (error instanceof LoginRequiredError) return { kind: "redirecting" };
    return { kind: "unknown" };
  }
}

export type RestoreRevisionResult =
  | { kind: "ok" }
  // Someone else updated the page after it was loaded.
  | { kind: "conflict" }
  | { kind: "error"; message: string }
  // The request did not get a response, so it may have succeeded on the server.
  | { kind: "unknown" }
  // Login is required and the move to the login page has started.
  | { kind: "redirecting" };

// Restores a revision of a page. currentVersion is the version of the page as loaded. Never rejects.
export async function restoreRevision(
  client: ApiClient,
  pageId: string,
  revisionVersion: number,
  currentVersion: number,
): Promise<RestoreRevisionResult> {
  let res;
  try {
    res = await client.api.v1.pages[":id"].revisions[":version"].restore.$post({
      param: { id: pageId, version: String(revisionVersion) },
      json: { version: currentVersion },
    });
  } catch (error) {
    if (error instanceof LoginRequiredError) return { kind: "redirecting" };
    return { kind: "unknown" };
  }
  if (res.ok) return { kind: "ok" };
  if (res.status === 409) return { kind: "conflict" };
  return { kind: "error", message: await responseErrorMessage(res) };
}

export type TrashPageResult =
  | { kind: "ok" }
  // The page is missing, already in the trash, or not accessible.
  | { kind: "notFound" }
  | SendFailure;

// Moves a page to the trash of its space. Never rejects.
export async function trashPage(client: ApiClient, pageId: string): Promise<TrashPageResult> {
  const sent = await send(() => client.api.v1.pages[":id"].$delete({ param: { id: pageId } }));
  if (sent.kind !== "response") return sent;
  const { res } = sent;
  if (res.ok) return { kind: "ok" };
  if (res.status === 404) return { kind: "notFound" };
  return { kind: "error", message: await responseErrorMessage(res) };
}

export type RestoreTrashedPageResult =
  | { kind: "ok"; page: Page }
  | { kind: "notFound" }
  // The page is not in the trash: someone else restored it first.
  | { kind: "conflict" }
  | SendFailure;

// Takes a page out of the trash. Never rejects.
export async function restoreTrashedPage(client: ApiClient, pageId: string): Promise<RestoreTrashedPageResult> {
  const sent = await send(() => client.api.v1.pages[":id"].restore.$post({ param: { id: pageId } }));
  if (sent.kind !== "response") return sent;
  const { res } = sent;
  if (res.ok) {
    try {
      return { kind: "ok", page: await res.json() };
    } catch {
      return { kind: "error", message: unexpectedResponseMessage(res.status) };
    }
  }
  if (res.status === 404) return { kind: "notFound" };
  if (res.status === 409) return { kind: "conflict" };
  return { kind: "error", message: await responseErrorMessage(res) };
}

export type PurgeTrashedPageResult =
  | { kind: "ok" }
  | { kind: "notFound" }
  // The page is not in the trash: someone else restored it first.
  | { kind: "conflict" }
  // Not an admin, or a page of a personal space. message is the server's.
  | { kind: "forbidden"; message: string }
  | SendFailure;

// Deletes a page in the trash with its revisions. Never rejects.
export async function purgeTrashedPage(client: ApiClient, pageId: string): Promise<PurgeTrashedPageResult> {
  const sent = await send(() => client.api.v1.pages[":id"].permanent.$delete({ param: { id: pageId } }));
  if (sent.kind !== "response") return sent;
  const { res } = sent;
  if (res.ok) return { kind: "ok" };
  if (res.status === 404) return { kind: "notFound" };
  if (res.status === 409) return { kind: "conflict" };
  if (res.status === 403) return { kind: "forbidden", message: await responseErrorMessage(res) };
  return { kind: "error", message: await responseErrorMessage(res) };
}
