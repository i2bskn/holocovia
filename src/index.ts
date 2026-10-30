import app from "./app";
import { sweepOrphanAttachments } from "./attachments/sweep";
import { describeError } from "./auth/middleware";
import { clock } from "./clock";
import { createDb } from "./db/client";
import { loadConfig, type Bindings, type Config } from "./env";
import { getOAuthProvider } from "./mcp/provider";
import { purgeExpiredTrash } from "./pages/trash";

export type { AppType } from "./app";

// Paths served by OAuthProvider or the authorization page. They are never forwarded to another host.
// When adding a top-level path here, add it to run_worker_first in wrangler.jsonc as well.
function isOAuthPath(path: string): boolean {
  return (
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path.startsWith("/oauth/") ||
    path.startsWith("/.well-known/") ||
    path === "/authorize"
  );
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

// The origin that hosts OAuth and MCP for this request, or null if the request cannot use them.
function resolveOrigin(config: Config, url: URL): string | null {
  if (config.oidc) return url.origin === config.oidc.appOrigin ? url.origin : null;
  // OAuth requires https, except on loopback hosts for local development.
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    return url.origin;
  }
  return null;
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const result = loadConfig(env);
    // The app answers with the same 500 as for any other path (loadConfigMiddleware).
    if (!result.ok) return app.fetch(request, env, ctx);

    const url = new URL(request.url);
    const origin = resolveOrigin(result.config, url);
    if (origin === null) {
      if (isOAuthPath(url.pathname)) return new Response(null, { status: 404 });
      // In oidc mode, unifyHost redirects pages to APP_ORIGIN.
      return app.fetch(request, env, ctx);
    }
    // A shallow copy per request: OAuthProvider sets env.OAUTH_PROVIDER only when it is missing,
    // so a shared env would keep the helpers of the first origin.
    return getOAuthProvider(origin).fetch(request, { ...env }, ctx);
  },

  // Daily (triggers.crons in wrangler.jsonc): deletes the pages that have been in the trash for 30 days, then
  // the attachment objects in R2 that no longer have a row. Uses the DB and R2 only, so it runs even when the
  // configuration is invalid. Awaited rather than passed to ctx.waitUntil, so that a failure is recorded as a
  // failed Cron run. Each step runs even if the other fails, and the first failure is thrown afterwards.
  async scheduled(_controller: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const db = createDb(env.DB);
    const now = clock.now();
    const errors: unknown[] = [];
    try {
      const count = await purgeExpiredTrash(db, now);
      console.log("purged trash", { count });
    } catch (error) {
      console.error("purge trash failed", describeError(error));
      errors.push(error);
    }
    // After the purge, so that the objects of the pages it deleted go in the same run.
    try {
      const count = await sweepOrphanAttachments(db, env.ATTACHMENTS, now);
      console.log("swept attachments", { count });
    } catch (error) {
      console.error("sweep attachments failed", describeError(error));
      errors.push(error);
    }
    if (errors.length > 0) throw errors[0];
  },
} satisfies ExportedHandler<Bindings>;
