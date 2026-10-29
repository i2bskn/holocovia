import { env } from "cloudflare:workers";
import { hashPassword } from "../src/auth/password";
import { createDb } from "../src/db/client";
import { pages, users, type PageRow, type UserRow } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { insertPersonalSpaceStatement } from "../src/spaces/queries";
import app from "../src/index";

export const ORIGIN = "https://holocovia.test";
export const OIDC_ORIGIN = "https://wiki.example.com";
export const PASSWORD = "correct horse battery";

export const db = createDb(env.DB);

export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM pages"),
    env.DB.prepare("DELETE FROM spaces"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

export const oidcEnv: Partial<Bindings> = {
  AUTH_MODE: "oidc",
  APP_ORIGIN: OIDC_ORIGIN,
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_CLIENT_ID: "holocovia-client",
  OIDC_CLIENT_SECRET: "client-secret",
};

export type RequestOptions = {
  method?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  form?: Record<string, string>;
  json?: unknown;
  env?: Partial<Bindings>;
  // Origin header for non-GET requests. Defaults to the request origin; null omits it.
  origin?: string | null;
};

export async function send(url: string, options: RequestOptions = {}): Promise<Response> {
  const fullUrl = new URL(url, ORIGIN);
  const method = options.method ?? (options.form || options.json !== undefined ? "POST" : "GET");
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? fullUrl.origin : options.origin;
  if (method !== "GET" && method !== "HEAD" && origin !== null) {
    headers.set("Origin", origin);
  }
  if (options.cookies) {
    headers.set(
      "Cookie",
      Object.entries(options.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    );
  }
  let body: BodyInit | undefined;
  if (options.form) {
    body = new URLSearchParams(options.form);
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  } else if (options.json !== undefined) {
    body = typeof options.json === "string" ? options.json : JSON.stringify(options.json);
    headers.set("Content-Type", "application/json");
  }
  const request = new Request(fullUrl, { method, headers, body, redirect: "manual" });
  return app.fetch(request, { ...env, ...options.env });
}

export type SetCookie = { value: string; maxAge: number | null; raw: string };

export function setCookies(res: Response): Record<string, SetCookie> {
  const result: Record<string, SetCookie> = {};
  for (const raw of res.headers.getSetCookie()) {
    const [pair = "", ...attributes] = raw.split(";").map((s) => s.trim());
    const index = pair.indexOf("=");
    const maxAge = attributes.find((a) => a.toLowerCase().startsWith("max-age="));
    result[pair.slice(0, index)] = {
      value: pair.slice(index + 1),
      maxAge: maxAge ? Number(maxAge.split("=")[1]) : null,
      raw,
    };
  }
  return result;
}

export type SessionCookies = { "__Host-holocovia_at": string; "__Host-holocovia_rt": string };

export function sessionCookies(res: Response): SessionCookies {
  const cookies = setCookies(res);
  const at = cookies["__Host-holocovia_at"]?.value;
  const rt = cookies["__Host-holocovia_rt"]?.value;
  if (!at || !rt) throw new Error(`session cookies are missing: ${res.headers.getSetCookie().join(" | ")}`);
  return { "__Host-holocovia_at": at, "__Host-holocovia_rt": rt };
}

export async function createUser(params: {
  email: string;
  role?: "admin" | "member";
  password?: string | null;
  createdAt?: number;
}): Promise<UserRow> {
  const now = params.createdAt ?? Date.now();
  const password = params.password === undefined ? PASSWORD : params.password;
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: params.email,
      role: params.role ?? "member",
      passwordHash: password === null ? null : await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!user) throw new Error("failed to create user");
  await insertPersonalSpaceStatement(env.DB, user.id, now).run();
  return user;
}

export async function login(email: string, password = PASSWORD): Promise<SessionCookies> {
  const res = await send("/auth/login", { form: { email, password, next: "/" } });
  if (res.status !== 303) throw new Error(`login failed: ${res.status}`);
  return sessionCookies(res);
}

export async function countSpaces(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM spaces").first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countPersonalSpaces(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM spaces WHERE kind = 'personal' AND owner_user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// Inserts a user without a personal space, like one created by code older than the spaces migration.
export async function createUserWithoutSpace(params: {
  email: string;
  role?: "admin" | "member";
  createdAt?: number;
  oidc?: { issuer: string; subject: string };
}): Promise<UserRow> {
  const now = params.createdAt ?? Date.now();
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: params.email,
      role: params.role ?? "member",
      passwordHash: params.oidc ? null : await hashPassword(PASSWORD),
      oidcIssuer: params.oidc?.issuer ?? null,
      oidcSubject: params.oidc?.subject ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!user) throw new Error("failed to create user");
  return user;
}

// Inserts a page directly, bypassing the API and its access checks.
export async function insertPage(params: {
  spaceId: string;
  title?: string;
  body?: string;
  createdBy?: string | null;
  at?: number;
  id?: string;
}): Promise<PageRow> {
  const at = params.at ?? Date.now();
  const createdBy = params.createdBy ?? null;
  const [page] = await db
    .insert(pages)
    .values({
      id: params.id ?? crypto.randomUUID(),
      spaceId: params.spaceId,
      title: params.title ?? "Page",
      body: params.body ?? "",
      version: 1,
      createdBy,
      updatedBy: createdBy,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  if (!page) throw new Error("failed to create page");
  return page;
}

export async function countPages(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM pages").first<{ count: number }>();
  return row?.count ?? 0;
}
