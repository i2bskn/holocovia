# Holocovia

Holocoviaは、MCPで読み書きでき、Webでも閲覧できるチーム向けのwiki兼ポータルです。Cloudflare Workers、D1、R2の上で動き、Cloudflareを使っている小さなチームが自分たちのアカウントで動かすことを想定しています。

現在実装しているのは、認証（パスワード認証とOIDC認証）、スペースとページとフォルダのAPI、MCPでの読み書き、ページの検索（API・MCP・Web）、編集履歴（ページごとに新しい20版）と復元、ページのゴミ箱（30日で自動削除）、Webでスペースとフォルダとページを読む画面、Webでのページの作成・編集とフォルダの操作です。ポータルは**まだ実装していません**。

Web画面でページの本文（Markdown）を表示するとき、本文中のHTMLはタグとして解釈せず書いたとおりの文字として表示し、外部の画像は表示しません。

Webでページを作成・編集している間、入力中の内容はブラウザ（localStorage）に下書きとして保存されます。ログアウトしても消えず、同じブラウザでログインした人に見える可能性があり、同じページを複数のタブで編集すると下書きは互いに上書きされるため、共有PCでは使わないでください。

## デプロイする

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/i2bskn/holocovia)

ボタンを押すと、次のことが行われます。

1. このリポジトリが、あなたのGitHubに新しいリポジトリとしてコピーされます（forkではありません）。
2. あなたのCloudflareアカウントにD1データベースと、MCPの接続情報を保存するKVネームスペースが1つずつ作られ、Workerに紐付きます。
3. Workers Buildsが設定され、マイグレーションの適用とデプロイが行われます。以降はコピーされたリポジトリへpushするたびにデプロイされます。

Web画面（React）は`wrangler.jsonc`の`build.command`により`wrangler deploy`の前に自動でビルドされるため、Workers Buildsのビルドコマンドの設定は要りません。

セットアップ画面では`JWT_SECRET`を入力します。`openssl rand -hex 32`で生成した値を使ってください。変更すると全員がログアウトします。

デプロイ直後はパスワード認証で動きます。表示されたURLを開くと初期設定画面になり、**最初に登録した人が管理者になります**。URLを知った他人に先に登録されないよう、デプロイしたらすぐに登録してください。

### 動作環境

- Workersの無料プランで動きます。ただしパスワードのハッシュ（PBKDF2を10万回）にCPU時間を1回16〜32ms使うため、無料プランの上限（1リクエスト10ms）を超えます。ログインがCPU時間の上限で失敗する場合は、Workers Paidを使ってください。
- ゴミ箱に30日あったページを消すため、Cron Triggerを1日1回使います。Workersの無料プランでも使えますが、アカウントあたりのCron Triggerの上限のうち1つを使います。
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

## MCPで接続する

生成AIのアプリから、MCPでスペースとページを読み、ページを作成・更新できます。ページのタイトルと本文を文字列で検索することもできます。接続はログインしたユーザー本人として行われ、Webと同じく、そのユーザーがアクセスできるスペースだけが見えます。

フォルダの作成・名前変更・移動（同じスペースの中だけ）・削除もMCPからできます。削除できるのは、中にフォルダと（ゴミ箱以外の）ページがないフォルダだけです。

MCPからページを削除するとゴミ箱に移り、30日のあいだは元に戻せます。完全な削除は Web のゴミ箱から管理者だけができます。また、上書きする前の内容は編集履歴として新しい20版まで残り、そこから戻せます。ゴミ箱から完全に削除したページと、30日たって自動で削除されたページは、履歴ごと消えるため戻せません。

接続先のURLは`<URL>/mcp`です（OIDC認証では`<APP_ORIGIN>/mcp`）。Claudeのカスタムコネクタで追加する場合は、次の手順で行います。

1. Claudeの「設定」→「コネクタ」で、カスタムコネクタを追加する。
2. URLに`<URL>/mcp`を入れて、接続する。
3. 開いたブラウザでholocoviaにログインし、接続を許可する。

Claude Codeで追加する場合は、次の手順で行います。`<URL>/mcp`は上と同じく、OIDC認証では`<APP_ORIGIN>/mcp`です。

1. `claude mcp add --transport http holocovia <URL>/mcp`を実行する。
2. Claude Codeで`/mcp`を開き、holocoviaを選んで認証する。
3. 開いたブラウザでholocoviaにログインし、接続を許可する。

許可の画面は接続のたびに表示されます。接続の有効期限は、OIDC認証では24時間、パスワード認証では30日です。期限が切れたら、もう一度接続してください。

管理者がユーザーのセッションを失効させたとき、管理者がパスワードを再設定したとき、本人がパスワードを変更したときは、そのユーザーのMCPの接続もすべて切れます。ただし接続情報はKVに保存されていて、KVは別の拠点への反映が遅れるため、失効の直前（最大60秒ほど）に作られた接続は切れずに残ることがあります。その場合はもう一度失効させてください。Webからのログアウトでは、MCPの接続は切れません。

デプロイすると、MCPの接続情報を保存するKVネームスペースが1つ作られます。

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

`pnpm dev`はWeb画面（`client/`）をビルドしてから`wrangler dev`を起動します。`client/`のファイルを変えると自動で再ビルドされますが、HMRは無いのでブラウザの再読み込みが必要です。

CookieにSecure属性と`__Host-`接頭辞を使っているため、`http://localhost`ではSafariでログインできません。ChromeかFirefoxを使ってください。

| コマンド | 内容 |
| --- | --- |
| `pnpm test` | テスト |
| `pnpm typecheck` | 型チェック（サーバーとWeb画面） |
| `pnpm build:client` | Web画面を`dist/client`にビルドする |
| `pnpm db:generate` | スキーマからマイグレーションを作る |
| `pnpm run deploy` | 本番のD1にマイグレーションを適用してデプロイする（`pnpm deploy`はpnpm自体のコマンドなので`run`を付けてください） |
