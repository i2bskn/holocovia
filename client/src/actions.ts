import { LoginRequiredError, responseErrorMessage } from "./api";
import type { ApiClient } from "./load";

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
