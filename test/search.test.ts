import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchResult } from "../src/api/types";
import { spaces, type SpaceRow, type UserRow } from "../src/db/schema";
import { createUser, db, insertPage, login, resetDb, send, type SessionCookies } from "./helpers";

const T0 = Date.UTC(2026, 9, 1);
const invalidQuery = "検索語は 1 文字以上 100 文字以下で、改行などの制御文字を含まない文字列にしてください";

async function insertSpace(kind: "everyone" | "admin", name: string): Promise<SpaceRow> {
  const [space] = await db
    .insert(spaces)
    .values({ id: crypto.randomUUID(), kind, name, createdAt: T0, updatedAt: T0 })
    .returning();
  if (!space) throw new Error("failed to create space");
  return space;
}

async function personalSpaceOf(user: UserRow): Promise<SpaceRow> {
  const space = await db.query.spaces.findFirst({ where: eq(spaces.ownerUserId, user.id) });
  if (!space) throw new Error("personal space not found");
  return space;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

function searchUrl(q: string, spaceId?: string): string {
  const params = new URLSearchParams({ q });
  if (spaceId !== undefined) params.set("space_id", spaceId);
  return `/api/v1/search?${params}`;
}

async function search(cookies: SessionCookies, q: string, spaceId?: string): Promise<SearchResult> {
  const res = await send(searchUrl(q, spaceId), { cookies });
  expect(res.status).toBe(200);
  return (await res.json()) as SearchResult;
}

async function searchIds(cookies: SessionCookies, q: string, spaceId?: string): Promise<string[]> {
  return (await search(cookies, q, spaceId)).hits.map((hit) => hit.id);
}

let admin: UserRow;
let member: UserRow;
let adminCookies: SessionCookies;
let memberCookies: SessionCookies;
let everyone: SpaceRow;

beforeEach(async () => {
  await resetDb();
  admin = await createUser({ email: "admin@example.com", role: "admin", createdAt: T0 });
  member = await createUser({ email: "member@example.com", role: "member", createdAt: T0 });
  adminCookies = await login(admin.email);
  memberCookies = await login(member.email);
  everyone = await insertSpace("everyone", "Everyone");
});

describe("GET /api/v1/search", () => {
  it("finds pages by title and by body without returning bodies", async () => {
    const byTitle = await insertPage({ spaceId: everyone.id, title: "Deploy guide", body: "nothing here", at: T0 });
    const byBody = await insertPage({ spaceId: everyone.id, title: "Notes", body: "how to deploy the app", at: T0 + 1 });
    await insertPage({ spaceId: everyone.id, title: "Other", body: "unrelated", at: T0 + 2 });

    const result = await search(memberCookies, "deploy");
    expect(result.has_more).toBe(false);
    expect(result.hits.map((hit) => hit.id)).toEqual([byTitle.id, byBody.id]);
    expect(result.hits[0]).toEqual({
      id: byTitle.id,
      space_id: everyone.id,
      folder_id: null,
      title: "Deploy guide",
      version: 1,
      created_by: null,
      updated_by: null,
      created_at: T0,
      updated_at: T0,
      snippet: null,
    });
    expect(result.hits[1]?.snippet).toBe("how to deploy the app");
    for (const hit of result.hits) expect(hit).not.toHaveProperty("body");
  });

  it("returns an empty list when nothing matches", async () => {
    await insertPage({ spaceId: everyone.id, title: "Page", body: "body" });
    expect(await search(memberCookies, "missing")).toEqual({ hits: [], has_more: false });
  });

  it("orders title matches first, then by updated_at descending, then by id", async () => {
    const bodyNew = await insertPage({ spaceId: everyone.id, title: "B", body: "key", at: T0 + 30 });
    const bodyOld = await insertPage({ spaceId: everyone.id, title: "B", body: "key", at: T0 + 10 });
    const titleOld = await insertPage({ spaceId: everyone.id, title: "key old", body: "", at: T0 + 5 });
    const titleNew = await insertPage({ spaceId: everyone.id, title: "key new", body: "", at: T0 + 20 });
    const sameB = await insertPage({ id: "bbbb", spaceId: everyone.id, title: "key same", body: "", at: T0 + 1 });
    const sameA = await insertPage({ id: "aaaa", spaceId: everyone.id, title: "key same", body: "", at: T0 + 1 });
    expect(await searchIds(memberCookies, "key")).toEqual([
      titleNew.id,
      titleOld.id,
      sameA.id,
      sameB.id,
      bodyNew.id,
      bodyOld.id,
    ]);
  });

  it("puts a page matching both title and body among the title matches, with a snippet", async () => {
    const bodyOnly = await insertPage({ spaceId: everyone.id, title: "Other", body: "plan", at: T0 + 10 });
    const both = await insertPage({ spaceId: everyone.id, title: "Plan", body: "the plan is", at: T0 });
    const result = await search(memberCookies, "plan");
    expect(result.hits.map((hit) => hit.id)).toEqual([both.id, bodyOnly.id]);
    expect(result.hits[0]?.snippet).toBe("the plan is");
  });

  it("ignores the case of ASCII letters only", async () => {
    const page = await insertPage({ spaceId: everyone.id, title: "x", body: "say hello" });
    await insertPage({ spaceId: everyone.id, title: "y", body: "café" });
    const result = await search(memberCookies, "Hello");
    expect(result.hits.map((hit) => hit.id)).toEqual([page.id]);
    expect(result.hits[0]?.snippet).toBe("say hello");
    // D1 has no ICU: lower() folds ASCII only.
    expect(await searchIds(memberCookies, "É")).toEqual([]);
  });

  it("matches the whole query including spaces as one string", async () => {
    const page = await insertPage({ spaceId: everyone.id, title: "x", body: "設計 方針" });
    await insertPage({ spaceId: everyone.id, title: "y", body: "設計と方針" });
    expect(await searchIds(memberCookies, "設計 方針")).toEqual([page.id]);
  });

  it.each([
    ["100%", "100% done", "100 円"],
    ["a_b", "a_b", "axb"],
    ["a\\b", "a\\b", "ab"],
    ["a\\", "a\\", "ab"],
  ])("matches %s as plain text", async (query, matching, other) => {
    const page = await insertPage({ spaceId: everyone.id, title: "x", body: matching });
    await insertPage({ spaceId: everyone.id, title: "y", body: other });
    const result = await search(memberCookies, query);
    expect(result.hits.map((hit) => hit.id)).toEqual([page.id]);
    expect(result.hits[0]?.snippet).toBe(matching);
  });

  describe("snippets", () => {
    it("cuts 40 characters before and after the match", async () => {
      const before = "あ".repeat(100);
      const after = "い".repeat(100);
      await insertPage({ spaceId: everyone.id, title: "x", body: `${before}検索語${after}` });
      const [hit] = (await search(memberCookies, "検索語")).hits;
      expect(hit?.snippet).toBe(`${"あ".repeat(40)}検索語${"い".repeat(40)}`);
    });

    it("cuts a match near the start of the body", async () => {
      await insertPage({ spaceId: everyone.id, title: "x", body: `ab検索語${"い".repeat(100)}` });
      const [hit] = (await search(memberCookies, "検索語")).hits;
      const snippet = hit?.snippet ?? "";
      expect(snippet.startsWith("ab検索語")).toBe(true);
      expect([...snippet].length).toBeLessThanOrEqual(80 + [..."検索語"].length);
    });

    it("counts characters, not bytes, and keeps the whole match", async () => {
      const query = "Mixed 😀 Query";
      await insertPage({
        spaceId: everyone.id,
        title: "x",
        body: `${"😀日本".repeat(30)}mixed 😀 query${"本日😀".repeat(30)}`,
      });
      const [hit] = (await search(memberCookies, query)).hits;
      const snippet = hit?.snippet ?? "";
      expect([...snippet].length).toBeLessThanOrEqual(80 + [...query].length);
      expect(snippet.toLowerCase()).toContain(query.toLowerCase());
      // No broken surrogate pairs.
      expect(/\p{Cs}/u.test(snippet)).toBe(false);
    });
  });

  describe("access", () => {
    // In each space: one page that matches only by title and one that matches only by body.
    async function insertMatches(spaceId: string): Promise<string[]> {
      const byTitle = await insertPage({ spaceId, title: "secret plan", body: "nothing" });
      const byBody = await insertPage({ spaceId, title: "notes", body: "the secret is here" });
      return [byTitle.id, byBody.id];
    }

    it("does not show pages in admin spaces to a member", async () => {
      const adminSpace = await insertSpace("admin", "Admins");
      const hidden = await insertMatches(adminSpace.id);
      const visible = await insertMatches(everyone.id);
      const ids = await searchIds(memberCookies, "secret");
      expect(ids.sort()).toEqual([...visible].sort());
      for (const id of hidden) expect(ids).not.toContain(id);
    });

    it("shows pages in admin spaces to an admin", async () => {
      const adminSpace = await insertSpace("admin", "Admins");
      const adminPages = await insertMatches(adminSpace.id);
      const ids = await searchIds(adminCookies, "secret");
      expect(ids.sort()).toEqual([...adminPages].sort());
    });

    it("does not show pages in another user's personal space", async () => {
      const hidden = await insertMatches((await personalSpaceOf(admin)).id);
      const own = await insertMatches((await personalSpaceOf(member)).id);
      const ids = await searchIds(memberCookies, "secret");
      expect(ids.sort()).toEqual([...own].sort());
      for (const id of hidden) expect(ids).not.toContain(id);
    });

    it("limits the search to space_id", async () => {
      const other = await insertSpace("everyone", "Other");
      const outside = await insertMatches(other.id);
      const inside = await insertMatches(everyone.id);
      const ids = await searchIds(memberCookies, "secret", everyone.id);
      expect(ids.sort()).toEqual([...inside].sort());
      for (const id of outside) expect(ids).not.toContain(id);
    });

    it("searches all spaces when space_id is empty", async () => {
      const other = await insertSpace("everyone", "Other");
      const pages = [...(await insertMatches(everyone.id)), ...(await insertMatches(other.id))];
      expect((await searchIds(memberCookies, "secret", "")).sort()).toEqual(pages.sort());
    });

    it.each(["admin", "personal", "missing"] as const)(
      "answers 404 for a space_id the user cannot access (%s)",
      async (kind) => {
        let spaceId = "missing";
        if (kind === "admin") spaceId = (await insertSpace("admin", "Admins")).id;
        if (kind === "personal") spaceId = (await personalSpaceOf(admin)).id;
        await insertMatches(spaceId === "missing" ? everyone.id : spaceId);
        const res = await send(searchUrl("secret", spaceId), { cookies: memberCookies });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: { code: "not_found", message: "スペースが見つかりません" } });
      },
    );

    it("requires login", async () => {
      const res = await send(searchUrl("secret"));
      expect(res.status).toBe(401);
    });
  });

  describe("query validation", () => {
    it.each([
      ["missing", "/api/v1/search"],
      ["blank", searchUrl("   ")],
      ["101 characters", searchUrl("あ".repeat(101))],
      ["a line break", searchUrl("a\nb")],
    ])("answers 400 for a query that is %s", async (_, url) => {
      const res = await send(url, { cookies: memberCookies });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "invalid_query", message: invalidQuery } });
    });

    it("accepts 100 characters", async () => {
      const query = "あ".repeat(100);
      const page = await insertPage({ spaceId: everyone.id, title: "x", body: query });
      expect(await searchIds(memberCookies, query)).toEqual([page.id]);
    });

    it("trims the query", async () => {
      const page = await insertPage({ spaceId: everyone.id, title: "x", body: "a key b" });
      expect(await searchIds(memberCookies, "  key  ")).toEqual([page.id]);
    });

    it("uses the first value of a repeated q", async () => {
      const a = await insertPage({ spaceId: everyone.id, title: "alpha", body: "" });
      await insertPage({ spaceId: everyone.id, title: "beta", body: "" });
      const res = await send("/api/v1/search?q=alpha&q=beta", { cookies: memberCookies });
      expect(res.status).toBe(200);
      expect(((await res.json()) as SearchResult).hits.map((hit) => hit.id)).toEqual([a.id]);
    });

    it("rejects a query with an invalid space_id before checking the space", async () => {
      const res = await send(searchUrl("", "missing"), { cookies: memberCookies });
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("invalid_query");
    });
  });

  describe("limit", () => {
    async function insertMany(count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        await insertPage({ spaceId: everyone.id, title: `match ${i}`, body: "", at: T0 + i });
      }
    }

    it("returns 50 pages and has_more when 51 match", async () => {
      await insertMany(51);
      const result = await search(memberCookies, "match");
      expect(result.hits).toHaveLength(50);
      expect(result.has_more).toBe(true);
      expect(result.hits[0]?.title).toBe("match 50");
    });

    it("does not set has_more when exactly 50 match", async () => {
      await insertMany(50);
      const result = await search(memberCookies, "match");
      expect(result.hits).toHaveLength(50);
      expect(result.has_more).toBe(false);
    });
  });
});
