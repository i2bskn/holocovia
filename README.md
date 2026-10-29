# Holocovia

Holocoviaは、MCPで読み書きでき、Webでも閲覧できるチーム向けのwiki兼ポータルです。Cloudflare Workers、D1、R2の上で動き、Cloudflareを使っている小さなチームが自分たちのアカウントで動かすことを想定しています。

現在は認証（パスワード認証とOIDC認証）の基盤だけを実装しています。wiki、ポータル、MCPは**まだ実装していません**。

## デプロイする

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/i2bskn/holocovia)

ボタンを押すと、次のことが行われます。

1. このリポジトリが、あなたのGitHubに新しいリポジトリとしてコピーされます（forkではありません）。
2. あなたのCloudflareアカウントにD1データベースが作られ、Workerに紐付きます。
3. Workers Buildsが設定され、マイグレーションの適用とデプロイが行われます。以降はコピーされたリポジトリへpushするたびにデプロイされます。

セットアップ画面では`JWT_SECRET`を入力します。`openssl rand -hex 32`で生成した値を使ってください。変更すると全員がログアウトします。

デプロイ直後はパスワード認証で動きます。表示されたURLを開くと初期設定画面になり、**最初に登録した人が管理者になります**。URLを知った他人に先に登録されないよう、デプロイしたらすぐに登録してください。

### 動作環境

- Workersの無料プランで動きます。ただしパスワードのハッシュ（PBKDF2を10万回）にCPU時間を1回16〜32ms使うため、無料プランの上限（1リクエスト10ms）を超えます。ログインがCPU時間の上限で失敗する場合は、Workers Paidを使ってください。
- プレビューURLは無効にしています。マイグレーションを適用していないコードが本番のD1に触れるのを防ぐためです。

## 設定

設定は、Cloudflareのダッシュボードの「設定」→「変数とシークレット」で行います。`wrangler.jsonc`には`keep_vars: true`を指定しているため、ダッシュボードで設定した値は再デプロイしても消えません。変数は「テキスト」の型で設定してください。

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `JWT_SECRET` | シークレット | 必須。32文字以上 |
| `AUTH_MODE` | 変数 | `password`（既定）または`oidc` |
| `APP_ORIGIN` | 変数 | `oidc`のとき必須。ブラウザで開くOrigin（例: `https://wiki.example.com`） |
| `OIDC_ISSUER` | 変数 | `oidc`のとき必須。IdPのissuer |
| `OIDC_CLIENT_ID` | 変数 | `oidc`のとき必須 |
| `OIDC_CLIENT_SECRET` | シークレット | `oidc`のとき必須 |
| `ALLOWED_EMAILS` | 変数 | 任意。ログインを許可するメールのドメインと個別のメールアドレス（カンマ区切り） |
| `OIDC_REQUIRE_EMAIL_VERIFIED` | 変数 | 任意。`false`にすると、IDトークンに`email_verified`が含まれない場合に限ってログインを通します |

設定に誤りがあると、すべてのリクエストが500になります。

### OIDC認証にする

OIDC認証では、初回ログイン時にユーザーが自動で作られます。誰がログインできるかはIdP側で絞ってください。IdPのアカウントを持つ人なら誰でもログインできる構成（Googleの同意画面を「外部」で作った場合など）では、`ALLOWED_EMAILS`を必ず設定してください。

IdPには、リダイレクトURLとして`<APP_ORIGIN>/auth/oidc/callback`を、スコープとして`openid`、`email`、`profile`を設定します。

Cloudflare Accessを使う場合は、Access for SaaSのOIDCアプリとして登録します（Accessをアプリの前に置く構成には対応していません）。AccessのIDトークンには`email_verified`が含まれないため、`OIDC_REQUIRE_EMAIL_VERIFIED`を`false`にしてください。この設定は、Accessのログイン方法がすべてメールを検証済みのIdP（Googleなど）である場合だけ使ってください。既存のユーザーとはメールアドレスで紐付くため、メールを検証しないログイン方法があると、他人のアカウントに入れてしまいます。

## 更新する

ボタンで作ったリポジトリには、このリポジトリの更新が自動では届きません。次の手順で取り込んでください。pushするとWorkers Buildsがマイグレーションを適用してからデプロイします。

```sh
git remote add upstream https://github.com/i2bskn/holocovia.git  # 初回だけ
git fetch upstream
git merge upstream/main
git push
```

`wrangler.jsonc`を自分で変更している場合は、マージで競合することがあります。

## バックアップ

バックアップは各自で行ってください。D1はTime Travelで過去の時点に戻せます。`wrangler d1 export`でSQLとして書き出すこともできます。

## ローカルで開発する

Node.jsとpnpmが必要です。

```sh
pnpm install
cp .dev.vars.example .dev.vars   # JWT_SECRET を設定する
pnpm db:migrate:local
pnpm dev
```

CookieにSecure属性と`__Host-`接頭辞を使っているため、`http://localhost`ではSafariでログインできません。ChromeかFirefoxを使ってください。

| コマンド | 内容 |
| --- | --- |
| `pnpm test` | テスト |
| `pnpm typecheck` | 型チェック |
| `pnpm db:generate` | スキーマからマイグレーションを作る |
| `pnpm run deploy` | 本番のD1にマイグレーションを適用してデプロイする（`pnpm deploy`はpnpm自体のコマンドなので`run`を付けてください） |
