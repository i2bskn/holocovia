import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { BacklinkList } from "../src/api/types";
import { pages, spaces, type PageRow, type SpaceRow, type UserRow } from "../src/db/schema";
import { BACKLINK_LIMIT } from "../src/pages/backlinks";
import { createUser, db, insertPage, login, resetDb, send, type SessionCookies } from "./helpers";

const T0 = Date.UTC(2026, 9, 1);

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

async function backlinks(cookies: SessionCookies, page: PageRow): Promise<BacklinkList> {
  const res = await send(`/api/v1/pages/${page.id}/backlinks`, { cookies });
  expect(res.status).toBe(200);
  return (await res.json()) as BacklinkList;
}

async function backlinkIds(cookies: SessionCookies, page: PageRow): Promise<string[]> {
  return (await backlinks(cookies, page)).pages.map((p) => p.id);
}

async function expectNotFound(cookies: SessionCookies, id: string): Promise<void> {
  const res = await send(`/api/v1/pages/${id}/backlinks`, { cookies });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: { code: "not_found", message: "ページが見つかりません" } });
}

let admin: UserRow;
let member: UserRow;
let adminCookies: SessionCookies;
let memberCookies: SessionCookies;
let everyone: SpaceRow;
let target: PageRow;

beforeEach(async () => {
  await resetDb();
  admin = await createUser({ email: "admin@example.com", role: "admin", createdAt: T0 });
  member = await createUser({ email: "member@example.com", role: "member", createdAt: T0 });
  adminCookies = await login(admin.email);
  memberCookies = await login(member.email);
  everyone = await insertSpace("everyone", "Everyone");
  target = await insertPage({ spaceId: everyone.id, title: "Target", body: "target", at: T0 });
});

describe("GET /api/v1/pages/:id/backlinks", () => {
  it("lists the pages whose body contains the path of the page, newest first, without bodies", async () => {
    const relative = await insertPage({
      spaceId: everyone.id,
      title: "Relative",
      body: `See [Target](/pages/${target.id}).`,
      at: T0 + 1,
    });
    const fullUrl = await insertPage({
      spaceId: everyone.id,
      title: "Full URL",
      body: `https://wiki.example.com/pages/${target.id}`,
      at: T0 + 3,
    });
    const history = await insertPage({
      spaceId: everyone.id,
      title: "History",
      body: `[history](/pages/${target.id}/history)`,
      at: T0 + 2,
    });
    await insertPage({ spaceId: everyone.id, title: "Unrelated", body: "nothing", at: T0 + 4 });

    const result = await backlinks(memberCookies, target);
    expect(result.has_more).toBe(false);
    expect(result.pages.map((p) => p.id)).toEqual([fullUrl.id, history.id, relative.id]);
    expect(result.pages[2]).toEqual({
      id: relative.id,
      space_id: everyone.id,
      folder_id: null,
      title: "Relative",
      version: 1,
      created_by: null,
      updated_by: null,
      created_at: T0 + 1,
      updated_at: T0 + 1,
    });
  });

  it("does not list pages the viewer cannot see, pages in the trash, the page itself or bare IDs", async () => {
    const link = `[Target](/pages/${target.id})`;
    const visible = await insertPage({ spaceId: everyone.id, title: "Visible", body: link, at: T0 + 1 });
    await insertPage({ spaceId: everyone.id, title: "Trashed", body: link, at: T0 + 2, deletedAt: T0 + 3 });
    const adminSpace = await insertSpace("admin", "Admins");
    const adminPage = await insertPage({ spaceId: adminSpace.id, title: "Admin", body: link, at: T0 + 4 });
    // Each personal space is visible only to its owner, not even to an admin.
    const memberOwn = await insertPage({
      spaceId: (await personalSpaceOf(member)).id,
      title: "Member's",
      body: link,
      at: T0 + 5,
    });
    const adminOwn = await insertPage({
      spaceId: (await personalSpaceOf(admin)).id,
      title: "Admin's",
      body: link,
      at: T0 + 7,
    });
    // The page itself links to itself.
    await db.update(pages).set({ body: link }).where(eq(pages.id, target.id));
    await insertPage({ spaceId: everyone.id, title: "Bare ID", body: `id: ${target.id}`, at: T0 + 6 });

    expect(await backlinkIds(memberCookies, target)).toEqual([memberOwn.id, visible.id]);
    expect(await backlinkIds(adminCookies, target)).toEqual([adminOwn.id, adminPage.id, visible.id]);
  });

  it("is 404 for a page that is missing, in the trash or not accessible", async () => {
    await expectNotFound(memberCookies, crypto.randomUUID());
    const trashed = await insertPage({ spaceId: everyone.id, title: "Trashed", deletedAt: T0 + 1 });
    await expectNotFound(memberCookies, trashed.id);
    const othersPage = await insertPage({ spaceId: (await personalSpaceOf(member)).id, title: "Member's" });
    await expectNotFound(adminCookies, othersPage.id);
    const adminSpace = await insertSpace("admin", "Admins");
    const adminPage = await insertPage({ spaceId: adminSpace.id, title: "Admin" });
    await expectNotFound(memberCookies, adminPage.id);
  });

  it("is 401 without a session", async () => {
    const res = await send(`/api/v1/pages/${target.id}/backlinks`);
    expect(res.status).toBe(401);
  });

  it("returns the newest 50 and has_more when more pages link to the page", async () => {
    const link = `[Target](/pages/${target.id})`;
    const linking: PageRow[] = [];
    for (let i = 0; i <= BACKLINK_LIMIT; i++) {
      linking.push(await insertPage({ spaceId: everyone.id, title: `Page ${i}`, body: link, at: T0 + 1 + i }));
    }
    const result = await backlinks(memberCookies, target);
    expect(result.has_more).toBe(true);
    expect(result.pages).toHaveLength(BACKLINK_LIMIT);
    // The oldest is the one left out.
    expect(result.pages.map((p) => p.id)).not.toContain(linking[0]?.id);
  });
});
