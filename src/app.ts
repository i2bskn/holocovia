import { Hono } from "hono";
import type { AppEnv } from "./env";
import {
  apiError,
  describeError,
  isJsonPath,
  loadConfigMiddleware,
  sameOrigin,
  securityHeaders,
  unifyHost,
} from "./auth/middleware";
import auth from "./routes/auth";
import authorize from "./routes/authorize";
import home from "./routes/home";
import me from "./routes/me";
import pagesApi from "./routes/pages";
import spacesApi from "./routes/spaces";
import usersApi from "./routes/users";
import { ErrorPage } from "./views/error";

const app = new Hono<AppEnv>();

app.use("*", securityHeaders);
app.use("*", loadConfigMiddleware);
app.use("*", unifyHost);
// Cookie-authenticated routes only. /mcp and the OAuth endpoints served by OAuthProvider must not use sameOrigin.
app.use("/auth/*", sameOrigin);
app.use("/api/v1/*", sameOrigin);
app.use("/authorize", sameOrigin);

app.route("/", home);
app.route("/auth", auth);
app.route("/authorize", authorize);
const apiRoutes = app
  .route("/api/v1/me", me)
  .route("/api/v1/users", usersApi)
  .route("/api/v1/spaces", spacesApi)
  .route("/api/v1/pages", pagesApi);

// Types for hc<AppType>(). Only /api/v1/* is included.
export type AppType = typeof apiRoutes;

app.notFound((c) => {
  if (isJsonPath(c.req.path)) return apiError(c, 404, "not_found", "見つかりません");
  return c.html(ErrorPage({ message: "ページが見つかりません" }), 404);
});

app.onError((error, c) => {
  console.error("unhandled error", describeError(error));
  if (isJsonPath(c.req.path)) return apiError(c, 500, "internal_error", "サーバーでエラーが発生しました");
  return c.html(ErrorPage({ message: "サーバーでエラーが発生しました" }), 500);
});

export default app;
