/** @jsxImportSource hono/jsx */
import { Layout } from "./layout";

export function LoggedOutPage() {
  return (
    <Layout title="ログアウト">
      <h1>ログアウトしました</h1>
      <p>
        <a href="/auth/login">ログイン</a>
      </p>
    </Layout>
  );
}
