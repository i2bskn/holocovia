import { Hono, type Context } from "hono";
import { and, eq, sql } from "drizzle-orm";
import type { CreatePageInput, CreatePageRequest, UpdatePageInput, UpdatePageRequest } from "../api/types";
import { clock } from "../clock";
import { pages } from "../db/schema";
import type { AppEnv } from "../env";
import { apiError, requireUser } from "../auth/middleware";
import { findAccessiblePage, findPageById } from "../pages/queries";
import { jsonBody, toApiPage } from "./api";

const PAGE_TITLE_MAX_LENGTH = 200;
const PAGE_BODY_MAX_BYTES = 512 * 1024;
const CONTROL_CHARACTER = /\p{Cc}/u;
// With the u flag, \p{Cs} matches only unpaired surrogates, so this is the same as !isWellFormed()
// (not in the ES2022 lib). D1 would store them as U+FFFD, so the saved value would differ.
const LONE_SURROGATE = /\p{Cs}/u;

const pageNotFound = "ページが見つかりません";

// Returns the trimmed title, or null if invalid. Length is counted in code points; no Unicode normalization.
function normalizePageTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  const length = [...title].length;
  if (length < 1 || length > PAGE_TITLE_MAX_LENGTH) return null;
  if (CONTROL_CHARACTER.test(title) || LONE_SURROGATE.test(title)) return null;
  return title;
}

// The body is Markdown and kept as is, including leading and trailing whitespace.
function isValidPageBody(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.includes("\u0000") || LONE_SURROGATE.test(value)) return false;
  return new TextEncoder().encode(value).byteLength <= PAGE_BODY_MAX_BYTES;
}

function invalidTitle(c: Context<AppEnv>): Response {
  return apiError(
    c,
    400,
    "invalid_title",
    "タイトルは 1 文字以上 200 文字以下で、改行などの制御文字を含まない文字列にしてください",
  );
}

// Not invalid_body, which jsonBody returns when the JSON is not an object.
function invalidPageBody(c: Context<AppEnv>): Response {
  return apiError(c, 400, "invalid_page_body", "本文は 512KB 以下で、NUL 文字を含まない文字列にしてください");
}

export const createPageBody = jsonBody<CreatePageRequest, CreatePageInput>((body, c) => {
  const title = normalizePageTitle(body.title);
  if (title === null) return invalidTitle(c);
  if (!isValidPageBody(body.body)) return invalidPageBody(c);
  return { ok: true, value: { title, body: body.body } };
});

const updatePageBody = jsonBody<UpdatePageRequest, UpdatePageInput>((body, c) => {
  const version = body.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    return apiError(c, 400, "invalid_version", "version は 1 以上の整数で指定してください");
  }
  if (body.title === undefined && body.body === undefined) {
    return apiError(c, 400, "empty_update", "title か body のどちらかを指定してください");
  }
  const value: UpdatePageInput = { version };
  if (body.title !== undefined) {
    const title = normalizePageTitle(body.title);
    if (title === null) return invalidTitle(c);
    value.title = title;
  }
  if (body.body !== undefined) {
    if (!isValidPageBody(body.body)) return invalidPageBody(c);
    value.body = body.body;
  }
  return { ok: true, value };
});

const pagesApi = new Hono<AppEnv>()
  .get("/:id", requireUser, async (c) => {
    const page = await findAccessiblePage(c.get("db"), c.get("user"), c.req.param("id"));
    if (!page) return apiError(c, 404, "not_found", pageNotFound);
    return c.json(toApiPage(page), 200);
  })
  .patch("/:id", requireUser, updatePageBody, async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");
    const page = await findAccessiblePage(db, user, c.req.param("id"));
    if (!page) return apiError(c, 404, "not_found", pageNotFound);

    // space_id keeps the write inside the space whose access was just checked.
    // The version is incremented even if nothing changed.
    const updated = await db
      .update(pages)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.body !== undefined && { body: input.body }),
        version: sql`${pages.version} + 1`,
        updatedBy: user.id,
        updatedAt: clock.now(),
      })
      .where(and(eq(pages.id, page.id), eq(pages.spaceId, page.spaceId), eq(pages.version, input.version)))
      .returning()
      .get();
    if (updated) return c.json(toApiPage(updated), 200);

    // Access is not checked again: the page was visible just before.
    const current = await findPageById(db, page.id);
    if (!current || current.spaceId !== page.spaceId) return apiError(c, 404, "not_found", pageNotFound);
    return apiError(
      c,
      409,
      "version_conflict",
      "ページが他の人に更新されています。最新の内容を取得してからやり直してください",
    );
  })
  .delete("/:id", requireUser, async (c) => {
    const db = c.get("db");
    const page = await findAccessiblePage(db, c.get("user"), c.req.param("id"));
    if (!page) return apiError(c, 404, "not_found", pageNotFound);
    // There is no history yet, so this cannot be undone.
    const result = await db
      .delete(pages)
      .where(and(eq(pages.id, page.id), eq(pages.spaceId, page.spaceId)))
      .run();
    if (result.meta.changes === 0) return apiError(c, 404, "not_found", pageNotFound);
    return c.body(null, 204);
  });

export default pagesApi;
