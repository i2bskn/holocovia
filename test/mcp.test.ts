import { getOAuthApi, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, PageList, PageSummary, SearchResult, Space, SpaceList } from "../src/api/types";
import { safeNext } from "../src/auth/redirect";
import { issueSession } from "../src/auth/sessions";
import { base64UrlEncode, signAccessToken } from "../src/auth/tokens";
import { pages, spaces, users, type PageRow, type SpaceRow, type UserRow } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { mcpHandler } from "../src/mcp/handler";
import { buildOAuthProviderOptions } from "../src/mcp/provider";
import {
  countPages,
  createUser,
  db,
  insertPage,
  login,
  OIDC_ORIGIN,
  oidcEnv,
  ORIGIN,
  PASSWORD,
  resetDb,
  send,
  setCookies,
  type RequestOptions,
} from "./helpers";

const REDIRECT_URI = "https://client.example/cb";
const MCP_ACCEPT = "application/json, text/event-stream";

type Cookies = Record<string, string>;

type FlowOptions = {
  origin?: string;
  env?: Partial<Bindings>;
  sharedEnv?: Cloudflare.Env;
  redirectUri?: string;
  clientName?: string;
};

type TokenResponse = { access_token: string; refresh_token?: string; resource?: string; expires_in: number };

function withDefaults(options: FlowOptions): RequestOptions {
  return { env: options.env, sharedEnv: options.sharedEnv };
}

async function registerClient(options: FlowOptions = {}): Promise<string> {
  const origin = options.origin ?? ORIGIN;
  const res = await send(`${origin}/oauth/register`, {
    ...withDefaults(options),
    json: {
      redirect_uris: [options.redirectUri ?? REDIRECT_URI],
      token_endpoint_auth_method: "none",
      client_name: options.clientName ?? "Test client",
    },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

function authorizeUrl(origin: string, clientId: string, challenge: string, redirectUri = REDIRECT_URI): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "mcp",
    state: "state-123",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${origin}/mcp`,
  });
  return `${origin}/authorize?${params}`;
}

type Consent = { html: string; handle: string; cookies: Cookies };

async function openConsent(
  sessionCookies: Cookies,
  options: FlowOptions = {},
): Promise<Consent & { clientId: string; verifier: string }> {
  const origin = options.origin ?? ORIGIN;
  const clientId = await registerClient(options);
  const { verifier, challenge } = await pkce();
  const res = await send(authorizeUrl(origin, clientId, challenge, options.redirectUri), {
    ...withDefaults(options),
    cookies: sessionCookies,
  });
  expect(res.status).toBe(200);
  const html = await res.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  if (!handle) throw new Error(`handle not found: ${html}`);
  const cookies: Cookies = { ...sessionCookies };
  for (const [name, cookie] of Object.entries(setCookies(res))) cookies[name] = cookie.value;
  return { html, handle, cookies, clientId, verifier };
}

// Runs DCR, PKCE, the consent page and the token request, and returns the token response.
async function authorizeClient(sessionCookies: Cookies, options: FlowOptions = {}): Promise<TokenResponse> {
  const origin = options.origin ?? ORIGIN;
  const consent = await openConsent(sessionCookies, options);
  const approved = await send(`${origin}/authorize`, {
    ...withDefaults(options),
    cookies: consent.cookies,
    form: { handle: consent.handle, decision: "approve" },
  });
  expect(approved.status).toBe(302);
  const location = new URL(approved.headers.get("Location") ?? "");
  const code = location.searchParams.get("code");
  if (!code) throw new Error(`code not found: ${location.href}`);

  const res = await send(`${origin}/oauth/token`, {
    ...withDefaults(options),
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: options.redirectUri ?? REDIRECT_URI,
      client_id: consent.clientId,
      code_verifier: consent.verifier,
    },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as TokenResponse;
}

async function mcpRequest(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  options: { origin?: string; env?: Partial<Bindings>; sharedEnv?: Cloudflare.Env } = {},
): Promise<Response> {
  return send(`${options.origin ?? ORIGIN}/mcp`, {
    env: options.env,
    sharedEnv: options.sharedEnv,
    headers: { Authorization: `Bearer ${token}`, Accept: MCP_ACCEPT },
    json: { jsonrpc: "2.0", id: 1, method, params },
  });
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: unknown };

async function callTool(token: string, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const res = await mcpRequest(token, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: ToolResult; error?: unknown };
  if (!body.result) throw new Error(`no result: ${JSON.stringify(body)}`);
  return body.result;
}

function toolJson<T>(result: ToolResult): T {
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "") as T;
}

function expectToolError(result: ToolResult, message: string) {
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: message }]);
}

async function insertSpace(kind: "everyone" | "admin", name: string): Promise<SpaceRow> {
  const now = Date.now();
  const [space] = await db
    .insert(spaces)
    .values({ id: crypto.randomUUID(), kind, name, createdAt: now, updatedAt: now })
    .returning();
  if (!space) throw new Error("failed to create space");
  return space;
}

async function personalSpaceOf(user: UserRow): Promise<SpaceRow> {
  const space = await db.query.spaces.findFirst({ where: eq(spaces.ownerUserId, user.id) });
  if (!space) throw new Error("personal space not found");
  return space;
}

async function oidcSessionCookies(user: UserRow): Promise<Cookies> {
  const now = Date.now();
  const session = await issueSession(db, user.id, "oidc", now);
  const at = await signAccessToken({ sub: user.id, sid: session.sessionId }, env.JWT_SECRET ?? "", now);
  return { "__Host-holocovia_at": at, "__Host-holocovia_rt": session.refreshToken };
}

function oauthApi(origin: string, overrides: Partial<Bindings> = {}) {
  return getOAuthApi(buildOAuthProviderOptions(origin), { ...env, ...overrides });
}

let admin: UserRow;
let member: UserRow;
let adminCookies: Cookies;
let memberCookies: Cookies;

beforeEach(async () => {
  await resetDb();
  admin = await createUser({ email: "admin@example.com", role: "admin" });
  member = await createUser({ email: "member@example.com" });
  adminCookies = await login(admin.email);
  memberCookies = await login(member.email);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("discovery", () => {
  it("answers /mcp without a token with 401 and a challenge", async () => {
    const res = await send("/mcp", { json: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("publishes the protected resource metadata", async () => {
    const res = await send("/.well-known/oauth-protected-resource/mcp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe(`${ORIGIN}/mcp`);
    expect(body.authorization_servers).toEqual([ORIGIN]);
    expect(body.scopes_supported).toEqual(["mcp"]);
  });

  it("publishes the authorization server metadata", async () => {
    const res = await send("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe(ORIGIN);
    expect(body.authorization_endpoint).toBe(`${ORIGIN}/authorize`);
    expect(body.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(body.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(body.scopes_supported).toEqual(["mcp"]);
    expect(body.protected_resources).toEqual([`${ORIGIN}/mcp`]);
    expect(body.resource).toBeUndefined();
  });
});

describe("GET /authorize", () => {
  it("sends a signed-out user to the login page and back", async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const url = new URL(authorizeUrl(ORIGIN, clientId, challenge));
    const res = await send(url.href);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "", ORIGIN);
    expect(location.pathname).toBe("/auth/login");
    const next = location.searchParams.get("next");
    expect(next).toBe(`${url.pathname}${url.search}`);
    expect(safeNext(next, ORIGIN)).toBe(`${url.pathname}${url.search}`);

    // With a refresh token, GET /auth/login renews the session and returns to the same URL.
    const back = await send(`${location.pathname}${location.search}`, {
      cookies: { "__Host-holocovia_rt": memberCookies["__Host-holocovia_rt"] ?? "" },
    });
    expect(back.status).toBe(302);
    expect(back.headers.get("Location")).toBe(`${url.pathname}${url.search}`);
  });

  it("renders an invalid request locally without a redirect", async () => {
    const res = await send("/authorize?response_type=code&client_id=missing", { cookies: memberCookies });
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("answers HEAD and prefetches with 204 before reading the request", async () => {
    const clientId = await registerClient();
    const { challenge } = await pkce();
    const url = authorizeUrl(ORIGIN, clientId, challenge);
    const head = await send(url, { method: "HEAD", cookies: memberCookies });
    expect(head.status).toBe(204);
    expect(head.headers.getSetCookie()).toEqual([]);
    const prefetch = await send(url, { cookies: memberCookies, headers: { "Sec-Purpose": "prefetch" } });
    expect(prefetch.status).toBe(204);
  });

  it("shows the client, the redirect host and the user, escaped and not frameable", async () => {
    const consent = await openConsent(memberCookies, { clientName: "<script>alert(1)</script>" });
    expect(consent.html).not.toContain("<script>alert(1)</script>");
    expect(consent.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(consent.html).toContain("このアプリの名前は確認されていません");
    expect(consent.html).toContain("client.example");
    expect(consent.html).toContain(member.email);
    expect(consent.html).not.toContain("このパソコン上のアプリ");
    const res = await send(authorizeUrl(ORIGIN, consent.clientId, (await pkce()).challenge), {
      cookies: memberCookies,
    });
    expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("warns when the redirect goes to a loopback address", async () => {
    const consent = await openConsent(memberCookies, { redirectUri: "http://127.0.0.1:33418/callback" });
    expect(consent.html).toContain("127.0.0.1");
    expect(consent.html).toContain("このパソコン上のアプリに接続を渡します");
  });
});

describe("POST /authorize", () => {
  it("redirects with access_denied when the user declines", async () => {
    const consent = await openConsent(memberCookies);
    const res = await send("/authorize", {
      cookies: consent.cookies,
      form: { handle: consent.handle, decision: "deny" },
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("state-123");
    expect(await oauthApi(ORIGIN).listUserGrants(member.id)).toMatchObject({ items: [] });
  });

  it("rejects a handle without the consent cookie", async () => {
    const consent = await openConsent(memberCookies);
    const res = await send("/authorize", {
      cookies: memberCookies,
      form: { handle: consent.handle, decision: "approve" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("画面の有効期限が切れたか");
  });

  it("requires the web session", async () => {
    const consent = await openConsent(memberCookies);
    const { "__Host-holocovia_at": _at, ...withoutSession } = consent.cookies;
    const res = await send("/authorize", { cookies: withoutSession, form: { handle: consent.handle, decision: "approve" } });
    expect(res.status).toBe(401);
  });

  it("rejects a cross-site form post", async () => {
    const consent = await openConsent(memberCookies);
    const res = await send("/authorize", {
      cookies: consent.cookies,
      form: { handle: consent.handle, decision: "approve" },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });
});

describe("MCP", () => {
  it("initializes and lists the six tools with their annotations", async () => {
    const { access_token } = await authorizeClient(memberCookies);
    const init = await mcpRequest(access_token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(initBody.result.serverInfo.name).toBe("holocovia");

    const list = await mcpRequest(access_token, "tools/list");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      result: { tools: { name: string; outputSchema?: unknown; annotations?: unknown }[] };
    };
    expect(listBody.result.tools.map((t) => t.name).sort()).toEqual([
      "create_page",
      "get_page",
      "list_pages",
      "list_spaces",
      "search_pages",
      "update_page",
    ]);
    expect(listBody.result.tools.every((t) => t.outputSchema === undefined)).toBe(true);
    const annotations = Object.fromEntries(listBody.result.tools.map((t) => [t.name, t.annotations]));
    const readOnly = { readOnlyHint: true, openWorldHint: false };
    expect(annotations).toEqual({
      list_spaces: readOnly,
      list_pages: readOnly,
      get_page: readOnly,
      search_pages: readOnly,
      create_page: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      update_page: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    });
  });

  it("returns the same spaces as the REST API for a member and an admin", async () => {
    await insertSpace("everyone", "Everyone");
    await insertSpace("admin", "Admins");
    for (const cookies of [memberCookies, adminCookies]) {
      const { access_token } = await authorizeClient(cookies);
      const rest = (await (await send("/api/v1/spaces", { cookies })).json()) as SpaceList;
      const result = toolJson<SpaceList>(await callTool(access_token, "list_spaces"));
      expect(result).toEqual(rest);
    }
  });

  it("does not show admin spaces to a member", async () => {
    const adminSpace = await insertSpace("admin", "Admins");
    const { access_token } = await authorizeClient(memberCookies);
    const result = toolJson<SpaceList>(await callTool(access_token, "list_spaces"));
    expect(result.spaces.map((s: Space) => s.id)).not.toContain(adminSpace.id);
    expect(result.spaces.map((s: Space) => s.kind).sort()).toEqual(["personal"]);
  });

  it("lists and reads pages only in accessible spaces", async () => {
    const everyone = await insertSpace("everyone", "Everyone");
    const adminSpace = await insertSpace("admin", "Admins");
    const visible = await insertPage({ spaceId: everyone.id, title: "Visible", body: "# Hello" });
    const adminPage = await insertPage({ spaceId: adminSpace.id, title: "Secret" });
    const othersPage = await insertPage({ spaceId: (await personalSpaceOf(admin)).id, title: "Admin's own" });
    const ownPage = await insertPage({ spaceId: (await personalSpaceOf(member)).id, title: "Mine" });
    const { access_token } = await authorizeClient(memberCookies);

    const pageList = toolJson<PageList>(await callTool(access_token, "list_pages", { space_id: everyone.id }));
    expect(pageList.pages.map((p) => p.id)).toEqual([visible.id]);
    expect(pageList.pages[0]).not.toHaveProperty("body");
    const page = toolJson<Page>(await callTool(access_token, "get_page", { page_id: visible.id }));
    expect(page).toMatchObject({ id: visible.id, title: "Visible", body: "# Hello", version: 1 });
    expect(toolJson<Page>(await callTool(access_token, "get_page", { page_id: ownPage.id })).id).toBe(ownPage.id);

    expectToolError(await callTool(access_token, "list_pages", { space_id: adminSpace.id }), "スペースが見つかりません");
    expectToolError(
      await callTool(access_token, "list_pages", { space_id: (await personalSpaceOf(admin)).id }),
      "スペースが見つかりません",
    );
    expectToolError(await callTool(access_token, "list_pages", { space_id: "missing" }), "スペースが見つかりません");
    expectToolError(await callTool(access_token, "get_page", { page_id: adminPage.id }), "ページが見つかりません");
    expectToolError(await callTool(access_token, "get_page", { page_id: othersPage.id }), "ページが見つかりません");
    expectToolError(await callTool(access_token, "get_page", { page_id: "missing" }), "ページが見つかりません");
  });

  it("hides admin spaces as soon as the user is no longer an admin", async () => {
    const adminSpace = await insertSpace("admin", "Admins");
    const { access_token } = await authorizeClient(adminCookies);
    const before = toolJson<SpaceList>(await callTool(access_token, "list_spaces"));
    expect(before.spaces.map((s) => s.id)).toContain(adminSpace.id);

    await db.update(users).set({ role: "member" }).where(eq(users.id, admin.id));
    const after = toolJson<SpaceList>(await callTool(access_token, "list_spaces"));
    expect(after.spaces.map((s) => s.id)).not.toContain(adminSpace.id);
  });

  it("returns 401 once the user is deleted", async () => {
    const { access_token } = await authorizeClient(memberCookies);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(member.id),
      env.DB.prepare("DELETE FROM spaces WHERE owner_user_id = ?").bind(member.id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(member.id),
    ]);
    const res = await mcpRequest(access_token, "tools/list");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("answers GET and DELETE with 405", async () => {
    const { access_token } = await authorizeClient(memberCookies);
    for (const method of ["GET", "DELETE"]) {
      const res = await send("/mcp", {
        method,
        headers: { Authorization: `Bearer ${access_token}`, Accept: MCP_ACCEPT },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    }
  });

  it("answers a token without the mcp scope with 403", async () => {
    // Clients cannot get such a token from this server (consent always grants mcp), so the
    // handler is called directly with the context OAuthProvider would pass.
    const ctx = Object.assign(createExecutionContext(), {
      props: { userId: member.id, authMode: "password" },
      auth: { token: "t", audience: `${ORIGIN}/mcp`, scope: [] },
    }) as unknown as OAuthResourceContext<unknown>;
    const request = new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { Accept: MCP_ACCEPT, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await mcpHandler.fetch(request, env, ctx);
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
  });

  it("reports unexpected errors in tools with a fixed message", async () => {
    const everyone = await insertSpace("everyone", "Everyone");
    const page = await insertPage({ spaceId: everyone.id });
    const { access_token } = await authorizeClient(memberCookies);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.DB.exec("ALTER TABLE pages RENAME TO pages_unavailable");
    let result: ToolResult;
    try {
      result = await callTool(access_token, "get_page", { page_id: page.id });
    } finally {
      await env.DB.exec("ALTER TABLE pages_unavailable RENAME TO pages");
    }
    expectToolError(result, "サーバーでエラーが発生しました");
    expect(JSON.stringify(result)).not.toContain("pages");
    expect(errorLog).toHaveBeenCalledWith("mcp tool failed", expect.objectContaining({ tool: "get_page" }));
  });
});

describe("search_pages", () => {
  const invalidQuery = "検索語は 1 文字以上 100 文字以下で、改行などの制御文字を含まない文字列にしてください";

  let token: string;
  let everyone: SpaceRow;

  beforeEach(async () => {
    token = (await authorizeClient(memberCookies)).access_token;
    everyone = await insertSpace("everyone", "Everyone");
  });

  it("returns the same result as the REST API", async () => {
    const page = await insertPage({ spaceId: everyone.id, title: "Notes", body: "how to deploy" });
    const result = toolJson<SearchResult>(await callTool(token, "search_pages", { query: "deploy" }));
    expect(result.hits.map((hit) => hit.id)).toEqual([page.id]);
    expect(result.hits[0]?.snippet).toBe("how to deploy");
    expect(result.hits[0]).not.toHaveProperty("body");
    expect(result.has_more).toBe(false);
    const rest = (await (await send("/api/v1/search?q=deploy", { cookies: memberCookies })).json()) as SearchResult;
    expect(result).toEqual(rest);
  });

  it("does not return pages the user cannot access, even when only the body matches", async () => {
    const adminSpace = await insertSpace("admin", "Admins");
    await insertPage({ spaceId: adminSpace.id, title: "notes", body: "the secret is here" });
    await insertPage({ spaceId: (await personalSpaceOf(admin)).id, title: "notes", body: "the secret is here" });
    const visible = await insertPage({ spaceId: everyone.id, title: "notes", body: "the secret is here" });
    const result = toolJson<SearchResult>(await callTool(token, "search_pages", { query: "secret" }));
    expect(result.hits.map((hit) => hit.id)).toEqual([visible.id]);
  });

  it("searches all spaces when space_id is empty", async () => {
    const other = await insertSpace("everyone", "Other");
    const a = await insertPage({ spaceId: everyone.id, title: "key a", body: "", at: 2 });
    const b = await insertPage({ spaceId: other.id, title: "key b", body: "", at: 1 });
    const all = toolJson<SearchResult>(await callTool(token, "search_pages", { query: "key", space_id: "" }));
    expect(all.hits.map((hit) => hit.id)).toEqual([a.id, b.id]);
    const one = toolJson<SearchResult>(await callTool(token, "search_pages", { query: "key", space_id: other.id }));
    expect(one.hits.map((hit) => hit.id)).toEqual([b.id]);
  });

  it("reports an invalid query", async () => {
    expectToolError(await callTool(token, "search_pages", { query: "  " }), invalidQuery);
    expectToolError(await callTool(token, "search_pages", { query: "a".repeat(101) }), invalidQuery);
    expectToolError(await callTool(token, "search_pages", { query: "a\nb", space_id: "missing" }), invalidQuery);
  });

  it("reports a space the user cannot access as missing", async () => {
    const adminSpace = await insertSpace("admin", "Admins");
    for (const spaceId of [adminSpace.id, (await personalSpaceOf(admin)).id, "missing"]) {
      expectToolError(
        await callTool(token, "search_pages", { query: "key", space_id: spaceId }),
        "スペースが見つかりません",
      );
    }
  });
});

describe("MCP write tools", () => {
  const BODY_MAX_BYTES = 524_288;
  const invalidTitle = "タイトルは 1 文字以上 200 文字以下で、改行などの制御文字を含まない文字列にしてください";
  const invalidPageBody = "本文は 512KB 以下で、NUL 文字を含まない文字列にしてください";
  const invalidVersion = "version は 1 以上の整数で指定してください";
  const emptyUpdate = "title か body のどちらかを指定してください";
  const pageNotFound = "ページが見つかりません";
  const spaceNotFound = "スペースが見つかりません";

  let token: string;

  beforeEach(async () => {
    token = (await authorizeClient(memberCookies)).access_token;
  });

  async function readPage(id: string): Promise<PageRow | undefined> {
    return db.query.pages.findFirst({ where: eq(pages.id, id) });
  }

  describe("create_page", () => {
    it("creates a page in an everyone space and returns it without the body", async () => {
      const everyone = await insertSpace("everyone", "Everyone");
      const result = toolJson<PageSummary>(
        await callTool(token, "create_page", { space_id: everyone.id, title: "  Hello  ", body: "# Hi\n" }),
      );
      expect(result).not.toHaveProperty("body");
      expect(result).toMatchObject({
        space_id: everyone.id,
        title: "Hello",
        version: 1,
        created_by: member.id,
        updated_by: member.id,
      });
      const res = await send(`/api/v1/pages/${result.id}`, { cookies: memberCookies });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...result, body: "# Hi\n" });
    });

    it("creates a page in the user's personal space", async () => {
      const personal = await personalSpaceOf(member);
      const result = toolJson<PageSummary>(
        await callTool(token, "create_page", { space_id: personal.id, title: "Mine", body: "" }),
      );
      expect(result).toMatchObject({ space_id: personal.id, title: "Mine", version: 1 });
      expect(await countPages()).toBe(1);
    });

    it("reports inaccessible and unknown spaces as missing", async () => {
      const adminSpace = await insertSpace("admin", "Admins");
      for (const spaceId of [adminSpace.id, (await personalSpaceOf(admin)).id, "missing"]) {
        const result = await callTool(token, "create_page", { space_id: spaceId, title: "T", body: "" });
        expectToolError(result, spaceNotFound);
      }
      expect(await countPages()).toBe(0);
    });

    it("rejects an invalid title", async () => {
      const everyone = await insertSpace("everyone", "Everyone");
      expectToolError(
        await callTool(token, "create_page", { space_id: everyone.id, title: "   ", body: "" }),
        invalidTitle,
      );
      expect(await countPages()).toBe(0);
    });

    it("accepts a body of exactly 512KB and rejects one byte more", async () => {
      const everyone = await insertSpace("everyone", "Everyone");
      const tooLong = "a".repeat(BODY_MAX_BYTES - 2) + "あ";
      expect(new TextEncoder().encode(tooLong).byteLength).toBe(BODY_MAX_BYTES + 1);
      expectToolError(
        await callTool(token, "create_page", { space_id: everyone.id, title: "T", body: tooLong }),
        invalidPageBody,
      );
      expect(await countPages()).toBe(0);

      const exact = "a".repeat(BODY_MAX_BYTES - 3) + "あ";
      expect(new TextEncoder().encode(exact).byteLength).toBe(BODY_MAX_BYTES);
      const result = toolJson<PageSummary>(
        await callTool(token, "create_page", { space_id: everyone.id, title: "T", body: exact }),
      );
      expect((await readPage(result.id))?.body).toBe(exact);
    });

    it("reports unexpected errors with a fixed message", async () => {
      const everyone = await insertSpace("everyone", "Everyone");
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      await env.DB.exec("ALTER TABLE pages RENAME TO pages_unavailable");
      let result: ToolResult;
      try {
        result = await callTool(token, "create_page", { space_id: everyone.id, title: "T", body: "" });
      } finally {
        await env.DB.exec("ALTER TABLE pages_unavailable RENAME TO pages");
      }
      expectToolError(result, "サーバーでエラーが発生しました");
      expect(JSON.stringify(result)).not.toContain("pages");
      expect(errorLog).toHaveBeenCalledWith("mcp tool failed", expect.objectContaining({ tool: "create_page" }));
      expect(await countPages()).toBe(0);
    });
  });

  describe("update_page", () => {
    let everyone: SpaceRow;
    let page: PageRow;

    beforeEach(async () => {
      everyone = await insertSpace("everyone", "Everyone");
      page = await insertPage({ spaceId: everyone.id, title: "Title", body: "Body", createdBy: admin.id });
    });

    it("updates only the title and returns the page without the body", async () => {
      const result = toolJson<PageSummary>(
        await callTool(token, "update_page", { page_id: page.id, version: 1, title: "  New  " }),
      );
      expect(result).not.toHaveProperty("body");
      expect(result).toMatchObject({
        id: page.id,
        title: "New",
        version: 2,
        created_by: admin.id,
        updated_by: member.id,
      });
      expect(await readPage(page.id)).toMatchObject({ title: "New", body: "Body", version: 2, updatedBy: member.id });
    });

    it("updates only the body", async () => {
      const result = toolJson<PageSummary>(
        await callTool(token, "update_page", { page_id: page.id, version: 1, body: "New body" }),
      );
      expect(result.version).toBe(2);
      expect(await readPage(page.id)).toMatchObject({ title: "Title", body: "New body", version: 2 });
    });

    it("reports a stale version with guidance and changes nothing", async () => {
      const first = await callTool(token, "update_page", { page_id: page.id, version: 1, body: "first" });
      expect(toolJson<PageSummary>(first).version).toBe(2);
      const before = await readPage(page.id);
      expectToolError(
        await callTool(token, "update_page", { page_id: page.id, version: 1, body: "second" }),
        "ページが他の人に更新されています。最新の内容を取得してからやり直してください。get_page で最新の version と本文を取得し、変更を反映し直してから update_page を呼んでください",
      );
      expect(await readPage(page.id)).toEqual(before);
    });

    it("requires a title or a body", async () => {
      expectToolError(await callTool(token, "update_page", { page_id: page.id, version: 1 }), emptyUpdate);
      expect(await readPage(page.id)).toEqual(page);
    });

    it.each([0, -1, 1.5, 2 ** 53])("rejects version %s", async (version) => {
      expectToolError(await callTool(token, "update_page", { page_id: page.id, version, title: "T" }), invalidVersion);
      expect(await readPage(page.id)).toEqual(page);
    });

    it("checks the version before the empty update", async () => {
      expectToolError(await callTool(token, "update_page", { page_id: page.id, version: 0 }), invalidVersion);
    });

    it("rejects an invalid title", async () => {
      expectToolError(
        await callTool(token, "update_page", { page_id: page.id, version: 1, title: "   " }),
        invalidTitle,
      );
      expect(await readPage(page.id)).toEqual(page);
    });

    it("rejects a body over 512KB", async () => {
      const tooLong = "a".repeat(BODY_MAX_BYTES - 2) + "あ";
      expectToolError(
        await callTool(token, "update_page", { page_id: page.id, version: 1, body: tooLong }),
        invalidPageBody,
      );
      expect(await readPage(page.id)).toEqual(page);
    });

    it("reports pages in inaccessible spaces and unknown pages as missing", async () => {
      const adminSpace = await insertSpace("admin", "Admins");
      const adminPage = await insertPage({ spaceId: adminSpace.id, title: "Secret", body: "Secret" });
      const othersPage = await insertPage({ spaceId: (await personalSpaceOf(admin)).id, title: "Own", body: "Own" });
      for (const target of [adminPage, othersPage]) {
        expectToolError(
          await callTool(token, "update_page", { page_id: target.id, version: 1, body: "changed" }),
          pageNotFound,
        );
        expect(await readPage(target.id)).toEqual(target);
      }
      expectToolError(
        await callTool(token, "update_page", { page_id: "missing", version: 1, body: "x" }),
        pageNotFound,
      );
    });
  });
});

describe("revoking sessions", () => {
  async function expectRevoked(token: string, userId: string) {
    expect((await mcpRequest(token, "tools/list")).status).toBe(401);
    expect((await oauthApi(ORIGIN).listUserGrants(userId)).items).toEqual([]);
  }

  it("revokes MCP grants with POST /api/v1/users/:id/revoke-sessions", async () => {
    const { access_token } = await authorizeClient(memberCookies);
    expect((await mcpRequest(access_token, "tools/list")).status).toBe(200);
    const res = await send(`/api/v1/users/${member.id}/revoke-sessions`, { method: "POST", cookies: adminCookies });
    expect(res.status).toBe(204);
    await expectRevoked(access_token, member.id);
  });

  it("revokes MCP grants when an admin resets the password", async () => {
    const { access_token } = await authorizeClient(memberCookies);
    const res = await send(`/api/v1/users/${member.id}/password`, {
      cookies: adminCookies,
      json: { password: "a brand new password" },
    });
    expect(res.status).toBe(204);
    await expectRevoked(access_token, member.id);
  });

  it("revokes MCP grants when the user changes the password", async () => {
    const { access_token } = await authorizeClient(memberCookies);
    const res = await send("/api/v1/me/password", {
      cookies: memberCookies,
      json: { current_password: PASSWORD, new_password: "a brand new password" },
    });
    expect(res.status).toBe(204);
    await expectRevoked(access_token, member.id);
  });

  it("keeps MCP grants when the web session logs out", async () => {
    const { access_token } = await authorizeClient(memberCookies);
    expect((await send("/auth/logout", { method: "POST", cookies: memberCookies })).status).toBe(200);
    expect((await mcpRequest(access_token, "tools/list")).status).toBe(200);
  });
});

describe("grant lifetime", () => {
  it("is 30 days in password mode", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await authorizeClient(memberCookies);
    const after = Math.floor(Date.now() / 1000);
    expect(token.refresh_token).toBeDefined();
    const { items } = await oauthApi(ORIGIN).listUserGrants(member.id);
    expect(items).toHaveLength(1);
    const expiresAt = items[0]?.expiresAt ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 2_592_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 2_592_000);
  });

  it("is 24 hours in oidc mode", async () => {
    const cookies = await oidcSessionCookies(member);
    const before = Math.floor(Date.now() / 1000);
    await authorizeClient(cookies, { origin: OIDC_ORIGIN, env: oidcEnv });
    const after = Math.floor(Date.now() / 1000);
    const { items } = await oauthApi(OIDC_ORIGIN, oidcEnv).listUserGrants(member.id);
    expect(items).toHaveLength(1);
    const expiresAt = items[0]?.expiresAt ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 86_400);
    expect(expiresAt).toBeLessThanOrEqual(after + 86_400);
  });
});

describe("origins and configuration", () => {
  it("returns 401 for a token issued in another AUTH_MODE", async () => {
    // Password mode on the host that later becomes APP_ORIGIN.
    const { access_token } = await authorizeClient(memberCookies, { origin: OIDC_ORIGIN });
    expect((await mcpRequest(access_token, "tools/list", {}, { origin: OIDC_ORIGIN })).status).toBe(200);
    const res = await mcpRequest(access_token, "tools/list", {}, { origin: OIDC_ORIGIN, env: oidcEnv });
    expect(res.status).toBe(401);
  });

  it("returns 404 for OAuth paths on hosts other than APP_ORIGIN in oidc mode", async () => {
    for (const path of ["/mcp", "/authorize", "/oauth/token", "/.well-known/oauth-authorization-server"]) {
      const res = await send(`https://other.example.com${path}`, { env: oidcEnv });
      expect(res.status).toBe(404);
    }
    const metadata = await send(`${OIDC_ORIGIN}/.well-known/oauth-authorization-server`, { env: oidcEnv });
    expect(metadata.status).toBe(200);
    // Pages still go through unifyHost.
    const page = await send("https://other.example.com/auth/setup", { env: oidcEnv });
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe(`${OIDC_ORIGIN}/auth/setup`);
  });

  it("serves pages but not OAuth on a plain http host that is not loopback", async () => {
    const me = await send("http://wiki.example.com/api/v1/me", { cookies: memberCookies });
    expect(me.status).toBe(200);
    expect(await me.text()).toContain(member.email);
    expect((await send("http://wiki.example.com/mcp", { json: {} })).status).toBe(404);
    expect((await send("http://wiki.example.com/authorize")).status).toBe(404);
  });

  it("serves OAuth on loopback http", async () => {
    const res = await send("http://localhost:8787/.well-known/oauth-protected-resource/mcp");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resource: string }).resource).toBe("http://localhost:8787/mcp");
  });

  it("returns 500 for every path when the configuration is invalid", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const path of ["/mcp", "/.well-known/oauth-authorization-server", "/oauth/token", "/authorize"]) {
      const res = await send(path, { env: { JWT_SECRET: "short" } });
      expect(res.status).toBe(500);
    }
    expect(errorLog).toHaveBeenCalledWith("invalid configuration", { invalid: ["JWT_SECRET"] });
  });

  it("uses the helpers of the request's origin when the env object is reused", async () => {
    const shared: Cloudflare.Env = { ...env };
    const other = "https://second.holocovia.test";
    const first = await authorizeClient(memberCookies, { sharedEnv: shared });
    const second = await authorizeClient(memberCookies, { origin: other, sharedEnv: shared });
    expect(first.resource).toBe(`${ORIGIN}/mcp`);
    expect(second.resource).toBe(`${other}/mcp`);
    expect(shared.OAUTH_PROVIDER).toBeUndefined();
    expect((await mcpRequest(second.access_token, "tools/list", {}, { origin: other, sharedEnv: shared })).status).toBe(
      200,
    );
    // Tokens are bound to their origin's resource.
    expect((await mcpRequest(first.access_token, "tools/list", {}, { origin: other, sharedEnv: shared })).status).toBe(
      401,
    );
  });
});
