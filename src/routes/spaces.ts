import { Hono } from "hono";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { CreateSpaceInput, CreateSpaceRequest, PageList, SpaceList, UpdateSpaceRequest } from "../api/types";
import { clock } from "../clock";
import { isForeignKeyViolation } from "../db/errors";
import { pages, spaces } from "../db/schema";
import type { AppEnv } from "../env";
import { apiError, requireAdmin, requireUser } from "../auth/middleware";
import { isUniqueViolation } from "../auth/users";
import { listPageSummaries } from "../pages/queries";
import { accessibleSpacesWhere, canAccessSpace } from "../spaces/access";
import { findSpaceById } from "../spaces/queries";
import { jsonBody, toApiPage, toApiPageSummary, toApiSpace } from "./api";
import { createPageBody } from "./pages";

const SPACE_NAME_MAX_LENGTH = 100;
const CONTROL_CHARACTER = /\p{Cc}/u;

const spaceNotFound = "スペースが見つかりません";
const invalidName = "スペースの名前は 1 文字以上 100 文字以下で、改行を含まない文字列にしてください";
const nameTaken = "この名前のスペースはすでにあります";

// Returns the trimmed name, or null if invalid. Length is counted in code points; no Unicode normalization.
function normalizeSpaceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  const length = [...name].length;
  if (length < 1 || length > SPACE_NAME_MAX_LENGTH || CONTROL_CHARACTER.test(name)) return null;
  return name;
}

function isCreatableKind(value: unknown): value is CreateSpaceInput["kind"] {
  return value === "everyone" || value === "admin";
}

const createSpaceBody = jsonBody<CreateSpaceRequest, CreateSpaceInput>((body, c) => {
  if (!isCreatableKind(body.kind)) {
    return apiError(c, 400, "invalid_kind", "スペースの種類は everyone または admin です");
  }
  const name = normalizeSpaceName(body.name);
  if (name === null) return apiError(c, 400, "invalid_name", invalidName);
  return { ok: true, value: { kind: body.kind, name } };
});

const updateSpaceBody = jsonBody<UpdateSpaceRequest, UpdateSpaceRequest>((body, c) => {
  const name = normalizeSpaceName(body.name);
  if (name === null) return apiError(c, 400, "invalid_name", invalidName);
  return { ok: true, value: { name } };
});

const spacesApi = new Hono<AppEnv>()
  .get("/", requireUser, async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(spaces)
      .where(accessibleSpacesWhere(c.get("user")))
      .orderBy(asc(spaces.createdAt), asc(spaces.id))
      .all();
    const body: SpaceList = { spaces: rows.map(toApiSpace) };
    return c.json(body, 200);
  })
  .get("/:id", requireUser, async (c) => {
    const space = await findSpaceById(c.get("db"), c.req.param("id"));
    // Spaces the user cannot access are reported as missing so that their existence is not revealed.
    if (!space || !canAccessSpace(c.get("user"), space)) return apiError(c, 404, "not_found", spaceNotFound);
    return c.json(toApiSpace(space), 200);
  })
  .post("/", requireUser, requireAdmin, createSpaceBody, async (c) => {
    const input = c.req.valid("json");
    const now = clock.now();
    let created;
    try {
      created = await c
        .get("db")
        .insert(spaces)
        .values({ id: crypto.randomUUID(), kind: input.kind, name: input.name, createdAt: now, updatedAt: now })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) return apiError(c, 409, "name_taken", nameTaken);
      throw error;
    }
    return c.json(toApiSpace(created), 201);
  })
  .patch("/:id", requireUser, requireAdmin, updateSpaceBody, async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const space = await findSpaceById(db, c.req.param("id"));
    if (!space || !canAccessSpace(c.get("user"), space)) return apiError(c, 404, "not_found", spaceNotFound);
    // Only the owner can see a personal space here, so there is nothing to hide: 403 rather than 404.
    if (space.kind === "personal") {
      return apiError(c, 403, "forbidden", "個人スペースの名前は変更できません");
    }
    if (space.name === input.name) return c.json(toApiSpace(space), 200);

    let updated;
    try {
      updated = await db
        .update(spaces)
        .set({ name: input.name, updatedAt: clock.now() })
        .where(eq(spaces.id, space.id))
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) return apiError(c, 409, "name_taken", nameTaken);
      throw error;
    }
    if (!updated) return apiError(c, 404, "not_found", spaceNotFound);
    return c.json(toApiSpace(updated), 200);
  })
  .delete("/:id", requireUser, requireAdmin, async (c) => {
    const db = c.get("db");
    const space = await findSpaceById(db, c.req.param("id"));
    if (!space || !canAccessSpace(c.get("user"), space)) return apiError(c, 404, "not_found", spaceNotFound);
    // Only the owner can see a personal space here, so there is nothing to hide: 403 rather than 404.
    if (space.kind === "personal") return apiError(c, 403, "forbidden", "個人スペースは削除できません");

    // One statement, so a page created after the check above keeps the space.
    // The foreign key from pages.space_id also rejects the delete.
    const result = await db
      .delete(spaces)
      .where(
        and(
          eq(spaces.id, space.id),
          ne(spaces.kind, "personal"),
          sql`NOT EXISTS (SELECT 1 FROM ${pages} WHERE ${pages.spaceId} = ${space.id})`,
        ),
      )
      .run();
    if (result.meta.changes === 1) return c.body(null, 204);
    if (!(await findSpaceById(db, space.id))) return apiError(c, 404, "not_found", spaceNotFound);
    return apiError(
      c,
      409,
      "space_not_empty",
      "ページが残っているスペースは削除できません。ページを移すか削除してから消してください",
    );
  })
  .get("/:id/pages", requireUser, async (c) => {
    const db = c.get("db");
    const space = await findSpaceById(db, c.req.param("id"));
    if (!space || !canAccessSpace(c.get("user"), space)) return apiError(c, 404, "not_found", spaceNotFound);
    const rows = await listPageSummaries(db, space.id);
    const body: PageList = { pages: rows.map(toApiPageSummary) };
    return c.json(body, 200);
  })
  .post("/:id/pages", requireUser, createPageBody, async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user");
    const space = await findSpaceById(db, c.req.param("id"));
    if (!space || !canAccessSpace(user, space)) return apiError(c, 404, "not_found", spaceNotFound);

    const now = clock.now();
    let created;
    try {
      created = await db
        .insert(pages)
        .values({
          id: crypto.randomUUID(),
          spaceId: space.id,
          title: input.title,
          body: input.body,
          version: 1,
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    } catch (error) {
      // The space was deleted after the check above (or the user, whose session ends with it).
      if (isForeignKeyViolation(error)) return apiError(c, 404, "not_found", spaceNotFound);
      throw error;
    }
    return c.json(toApiPage(created), 201);
  });

export default spacesApi;
