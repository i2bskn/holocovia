import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getCurrentUser } from "../auth/middleware";
import { Layout } from "../views/layout";

const home = new Hono<AppEnv>();

// Placeholder page until the wiki UI exists.
home.get("/", async (c) => {
  const current = await getCurrentUser(c);
  if (!current) return c.redirect("/auth/login?next=/", 302);
  const { user } = current;
  return c.html(
    <Layout title="ホーム">
      <h1>holocovia</h1>
      <p>
        {user.email}（{user.role}）としてログインしています。
      </p>
      <form method="post" action="/auth/logout">
        <button type="submit">ログアウト</button>
      </form>
    </Layout>,
  );
});

export default home;
