# エージェントに任せる Gmail・Google Cloud セットアップ

[English](agent-setup-gmail.md) | **日本語** · [README](../README.ja.md) · [Gmail CLI](gmail-cli.ja.md)

セルフホスト版は、自分の Google Cloud プロジェクトと OAuth クライアントを使う方式をサポートします。Google Cloud の設定を自分で調べる代わりに、以下のプロンプトをブラウザーとターミナルを操作できるエージェントへ渡せます。エージェントに任せられる範囲は、その実行環境の機能・アカウントアクセス・承認ルールによります。Google の本人確認や最終的なアクセス許可は本人が行う場合があります。

## 最初に渡すプロンプト

```text
redpixels のセルフホスト版で、私の Gmail に追跡付きの未送信下書きを
作れるところまでセットアップしてください。
https://github.com/arkorlab/redpixels の README.ja.md、
docs/agent-setup.ja.md、docs/agent-setup-gmail.ja.md、
docs/gmail-cli.ja.md と実際の CLI を確認して進めてください。

自分の Google Cloud プロジェクトと Desktop OAuth クライアントを使う
方式を選びます。既存の認証・redpixels 設定があれば再利用してください。
なければ、利用できるブラウザー操作で Google Cloud の設定を進めてください。
別のアプリの設定は上書きせず、必要なら redpixels 専用プロジェクトを作ってください。
Gmail API と最小限の gmail.compose だけを有効にし、課金・カード登録・
無料トライアル・Compute・Pub/Sub・割当増加は追加しないでください。

OAuth の JSON とトークンはチャットや Git に出さず、安全なローカル保存先と
OS の認証情報ストアを使ってください。本人確認・Google の規約への同意・
Gmail のアクセス許可など、本人の操作が必要な場面だけ、対象画面と理由を
示して引き継いでください。未確認アプリの警告を自動で回避しないでください。

Cloudflare が未設定なら cf または Wrangler の対応ガイドに従いデプロイし、
Gmail の許可待ちの間も独立して進められる作業を続けてください。
認証後、用途を明記したテスト下書きを 1 通作り、保存済み MIME に画像が
残ることを確認してください。宛先の指定がなければ自分宛てにしてください。
送信は私が Gmail で行うので、自動送信しないでください。

今後「追跡付きの下書きを作って」と頼んだときの操作も永続設定に保存し、
設定場所、確認できたこと、未確認のこと、費用と再認証の条件を報告してください。
通常の Gmail 画面で一から書いたメールの自動追跡や、送信済みの自動検知が
実装されているとは説明しないでください。
```

すでに Cloudflare をデプロイしている場合は、その Worker URL と既存のシークレットの**保存場所**を追加してください。値そのものをプロンプトに貼る必要はありません。

## 手間と費用

初回は、Google Cloud のプロジェクト、Gmail API、同意画面、Desktop クライアント、ローカル認証を設定します。ブラウザー操作をエージェントに任せても、本人確認や許可には利用者の操作が残ります。目安として 10〜30 分ほどを見込むのが現実的ですが、これは見積もりで、組織ポリシーや権限不足による待ち時間は含みません。既存設定を再利用できれば短くなります。

**2026-10-16 時点**の Google の説明では、Gmail API の標準利用に追加料金はありません。現在の CLI に必要なのは API・OAuth の設定であり、GCP の有料サーバーや課金アカウントではありません。[Gmail API の料金・割当](https://developers.google.com/workspace/gmail/api/reference/quota)、[プロジェクト作成手順の任意の課金設定](https://developers.google.com/workspace/guides/create-project#optional-enable-billing-for-your-cloud-project)

通常の新規下書き 1 通は、`getProfile` 1 + `drafts.create` 10 + `drafts.get` 20 = **31 quota units**。1 日 100 通なら **3,100 units** で、ログイン時の確認、追加の `verify`、再試行などは別です。quota units はドルではありません。現行の日次課金しきい値はプロジェクトあたり **80,000,000 units** です。Google は 2026 年後半の標準日次しきい値超過の課金を、少なくとも 90 日前に通知するとしています。永久無料とは約束できないため、導入時には公式ページを再確認してください。[割当の表](https://developers.google.com/workspace/gmail/api/reference/quota)、[変更予定](https://developers.google.com/workspace/tools-safety)

Cloudflare のプラン・使用量、Google Workspace を使う場合の契約、エージェントの利用料、Webhook 受信先の費用は別です。既存の Google アカウントを使えます。redpixels のために Workspace や GCP の無料トライアルを購入・開始する手順ではありません。

## 今の機能の範囲

この設定でできるのは、**エージェントが CLI でピクセル入り下書きを作り、人が Gmail の Web・スマホアプリから編集・送信すること**です。GCP を設定しても、Gmail の作成画面で一から書いたすべてのメールに画像が自動で入るわけではありません。Chrome 拡張、Gmail UI 内の既読チェック、送信ゲートウェイ、Sent の自動監視は追加しません。

現在の CLI は既定で `armed:false` です。人が送信したとの申告後、`arm --confirm-sent` で通知対象にします。毎回の送信報告をなくす仕組みは未実装です。`--armed` で即時追跡を選べますが、下書き・Sent の閲覧や先読みで通知される可能性があります。これを「自動送信検知」と説明しないでください。

将来の Managed 版は、運営側が OAuth アプリ・接続サーバーを管理し、利用者の Google Cloud 設定を省く方向です。**現在提供している機能ではありません。** 料金、公開日、審査完了、通常の Gmail 作成メールへの自動挿入を約束するものでもありません。セルフホスト版は自分の認証情報・Worker を管理したい利用者向けに残します。

## エージェントの実行手順

### 1. 再開可能な設定を確認する

- 作業場所・現在のバージョン・無関係な変更を確認します。[デプロイ共通手順](agent-setup.ja.md)と、選んだ [cf](agent-setup-cf.ja.md) または [Wrangler](agent-setup-wrangler.ja.md) の手順を使います。
- `REDPIXELS_URL`、Worker トークンの保存場所、`REDPIXELS_GMAIL_HOME`、`REDPIXELS_GMAIL_TOKEN_STORE`、OAuth JSON の保存場所、以前の操作 ID を確認します。秘密の値を出力したり、コネクターの内部認証情報を取り出したりしません。
- `pnpm --silent gmail auth status` は**保存済み認証情報の有無**の確認です。Google への通信やトークン更新が成功した証明ではありません。接続済みなら、新しい試験下書き作成で実際の更新と API アクセスを確認します。
- 利用者がこの方式のセットアップを依頼済みなら、通常の各設定工程について同じ方式を選ぶか何度も尋ねません。アカウントやプロジェクトの所有者が判断できない、別アプリを変更する、権限・規約・環境の承認で本人操作が必要、という具体的な場面では対象と理由を示します。

### 2. 自分のプロジェクトと Gmail API を設定する

1. [Google Cloud Console](https://console.cloud.google.com/) のログイン先を確認します。利用者が所有する redpixels 用の既存プロジェクトがあれば再利用します。別用途の Branding・Audience・OAuth を変更せず、必要なら専用の `redpixels` プロジェクトを作ります。プロジェクト ID は実際に作られた値を使い、コードや公開例に個人設定を埋め込みません。
2. そのプロジェクトで [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) だけを有効にします。サービスアカウント、ドメイン全体の委任、Compute、Pub/Sub、Sent 監視はこの CLI に不要です。
3. 課金アカウントの紐付け、カード登録、無料トライアル、割当増加は実施しません。組織のプロジェクト作成権限がないなどの問題を、課金設定で解決しようとしないでください。
4. 本人確認や規約への明示的な同意が必要なら、その Google 画面を本人へ引き継ぎます。ログイン・同意できたことは画面や後続 API で確認し、操作待ちのまま成功扱いしません。

### 3. 同意画面と Desktop OAuth クライアントを作る

1. [Google Auth Platform](https://console.cloud.google.com/auth/overview) の Branding に用途を示す名前（例 `redpixels personal`）と、利用者が管理するサポート・連絡先メールを設定します。別アプリの公開情報や架空のドメイン・プライバシーポリシーを流用しません。
2. 個人 Gmail などは **External**。Testing を使う場合は、この CLI で下書きを作る Google アカウントを **Test users** に追加します。対象 Workspace 組織内だけの利用なら、その組織に属するプロジェクトで **Internal** を選べます。外部の宛先へメールを送ることと、外部利用者に OAuth を許可することは別です。
3. Data Access に `https://www.googleapis.com/auth/gmail.compose` を追加します。この制限付きスコープは**下書き管理に加えて送信権限も含みます**。CLI に送信コマンドがないからといって、トークンが下書き限定とは説明しません。受信箱・Sent を読むスコープは追加しません。
4. [Clients](https://console.cloud.google.com/auth/clients) → Create client → **Desktop app** を作り、JSON をダウンロードします。ローカル CLI が `127.0.0.1` でコールバックを受けるためです。スマホ Gmail から送る場合も Desktop を使います。**Web application** は将来の Managed サーバー向けの別方式で、現 CLI の代わりにはなりません。
5. JSON は Git・共有・同期フォルダー外の私有ディレクトリへ保存します。macOS / Linux はディレクトリ `0700`、ファイル `0600` にします。Windows は OS の ACL で所有者以外を制限します。クライアントシークレット、トークン、認可コードをログ・チャット・コミット・Worker の環境変数へ出しません。

[Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Gmail スコープ](https://developers.google.com/workspace/gmail/api/auth/scopes)、[個人・組織内利用等の審査の例外](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#exceptions-verification-requirements)を参照してください。例外は Google や組織の制限を解除する保証ではありません。未確認アプリの警告・ブロックが出た場合は内容と適用条件を説明し、本人や管理者の判断に引き継ぎます。警告の自動回避や、第三者の OAuth クライアント借用はしません。

External / Testing のリフレッシュトークンは、この Gmail スコープでは通常 **7 日で失効**します。Production へ変更しても Google の審査済みにはなりません。個人用の例外や組織ポリシーを確認して publishing 設定を選び、長期運用で再認証が必要になる条件を伝えます。[失効条件](https://developers.google.com/identity/protocols/oauth2#expiration)

### 4. ローカル CLI で認証する

Node.js 22.18 以降または 24 LTS、pnpm 10 を使います。リポジトリの固定された依存関係をインストールし、JSON の実際の保存パスを指定します。

```sh
pnpm install --frozen-lockfile
pnpm gmail auth login --client /absolute/private/path/client_secret.json
pnpm --silent gmail auth status
```

Google 公式 `google-auth-library` が PKCE とトークン交換・更新を処理し、CLI が state 検証と loopback 受付を行います。ブラウザーで本人が対象 Gmail と権限を確認・許可できる間は CLI を動かしておきます。期限切れのリンクを使い続けず、新しいログイン処理のリンクを開きます。パスキー・Touch ID・MFA は本人が操作します。

既定は macOS Keychain / Windows Credential Manager / Linux Secret Service です。アクセストークンはメモリだけに置き、リフレッシュトークンとクライアント情報を認証情報ストアへ保存します。ストアが利用不可でも勝手に平文へ切り替えません。ヘッドレス環境などで利用者がファイル保存を選ぶ場合だけ、次を使います。

```sh
export REDPIXELS_GMAIL_TOKEN_STORE=file
export REDPIXELS_GMAIL_HOME=/absolute/private/path/redpixels-gmail
pnpm gmail auth login --client /absolute/private/path/client_secret.json --no-browser
```

**ファイル方式は暗号化されません。** POSIX では状態ディレクトリ `0700`、認証ファイル `0600` に制限します。OS の認証情報ストアを使える端末では既定を維持してください。エージェントにも同じ保存方式と状態ディレクトリを設定します。

`--no-browser` は認証リンクを表示するだけで、localhost の到達性を不要にはしません。SSH のリモート CLI なら、ブラウザー側の端末で `ssh -L 8765:127.0.0.1:8765 user@host` を使い、リモート側で次を実行できます。

```sh
pnpm gmail auth login \
  --client /absolute/private/path/client_secret.json \
  --port 8765 --no-browser
```

Gmail OAuth に Cloudflare CLI の device-code 手順を流用したり、廃止済みの OOB コード貼り付け方式を案内したりしません。

### 5. 実際のトークン更新と下書き作成を試す

Worker 用のトークンは環境のシークレット管理から渡すか、保護された JSON の `API_TOKEN` を参照します。Google の JSON・トークンとは分けます。

```sh
export REDPIXELS_URL='https://redpixels.<your-subdomain>.workers.dev'
export REDPIXELS_SECRETS_FILE='/absolute/private/path/.env.redpixels.json'

pnpm --silent gmail draft \
  --to recipient@example.com \
  --subject 'redpixels setup test' \
  --html examples/email.html \
  --operation setup-test-001
```

`recipient@example.com` は利用者が指定・管理する宛先へ置き換えます。指定がなければ認証済みの自分宛てを使い、他人へ勝手に試験メールを作りません。`setup-test-001` は新しい試験メールごとに未使用の操作 ID に置き換え、そのメールの再試行だけで再利用します。CLI はトークン更新、Gmail プロフィール照合、redpixels 登録、raw MIME の下書き作成、保存済み HTML の画像検証を行います。実行前に Worker URL・アカウント・用途が正しいことを確認します。

成功時は `state:"verified"`、`account`、`tracking_id`、`gmail_draft_id`、`gmail_message_id`、`pixel_verified_at` を記録します。`verified` はその時点の保存内容の確認であり、配信や人の開封の確認ではありません。Gmail で編集・保存した後は次を実行します。

```sh
pnpm --silent gmail verify --operation setup-test-001
```

人が Gmail で確認・送信したと申告したら、同じ操作を追跡開始します。

```sh
pnpm --silent gmail arm --operation setup-test-001 --confirm-sent
```

`--confirm-sent` は申告であり、Sent の自動確認ではありません。送信前の取得も `before_armed` として履歴に残り、追跡開始後も Gmail のキャッシュ・本人判定の限界があります。実開封の試験では、別アカウント宛ての新規メールを Web / iOS でそれぞれ用意し、受信者が開く前に追跡開始・基準値記録を行います。[手動受入テスト](gmail-cli.ja.md#手動の受入テスト)を使い、人工的な URL 取得と区別してください。

### 6. 次回以降のエージェント操作を保存する

利用環境の永続指示に、以下と、リポジトリ・Worker URL・シークレット参照・Gmail 状態ディレクトリの**場所**を保存します。値そのものは指示文へ含めません。永続設定ができなければ保存できたと報告せず、再利用できる指示として利用者へ渡します。

```text
追跡付き Gmail 下書きを依頼されたら:
1. redpixels の保存済み環境設定と Gmail のアカウントを確認する。
2. UTF-8 HTML ファイルを用意し、メールごとに一意で再試行時に安定した
   --operation を使って pnpm --silent gmail draft を実行する。
3. state:verified、各 ID、検証時刻を記録し、Gmail で確認できる下書きを案内する。
4. 編集後は verify する。送信は本人が行う。CLI に送信コマンドはない。
5. 本人から送信済みの申告が来たら同じ operation の arm --confirm-sent を実行する。
   申告がなければ送信済みと推測しない。即時 --armed は本人が選んだ場合だけ使う。
6. 状態不明の作成を別 operation で盲目的にやり直さず、記録と Gmail を確認する。
7. 履歴は認証付き API で読み、通知は署名とイベント ID を照合する。
   画像取得を人が読んだ証拠とは説明しない。
```

## 中断・エラー時の復旧

| 状況                                        | 確認・対応                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Cloud のプロジェクトを作れない       | ログイン先、組織・フォルダー、権限・組織の作成制限を確認。本人・管理者に必要な作業だけ引き継ぎ、課金や無関係な組織設定を変えない。                  |
| Web client の JSON を渡した                 | 専用プロジェクトで Desktop app を作成。既存 Web client は削除・変更しない。                                                                         |
| `access_denied` / テストユーザー対象外      | OAuth クライアントのプロジェクト、Audience、Test users と実際のログインアカウントを確認。拒否された権限を付与済みと扱わない。                       |
| 未確認アプリの警告・管理者ブロック          | 内容と個人・組織内の適用条件を示して本人・管理者に引き継ぐ。警告の自動回避や制限解除をしない。                                                      |
| localhost のページが開けない                | CLI がまだ待機中か、ブラウザーと CLI の端末が同じか、SSH 転送・固定ポート・有効期限を確認。新しいログインで再試行。                                 |
| Keychain / Secret Service が使えない        | OS のストアのロック・デスクトップセッションを確認。平文ファイル保存は利用者が選んだ場合だけ。                                                       |
| `auth status` は接続済みだが API が失敗     | 保存情報の存在と有効性は別。エラー、許可の取り消し、Testing の 7 日期限、組織ポリシーを調べ、必要なら再ログイン。                                   |
| Gmail API 未有効 / `insufficient scopes`    | 同じプロジェクトの Gmail API と実際の許可を確認。必要な compose の許可で再ログインし、受信箱全体の権限を追加しない。                                |
| `ambiguous` / 作成 POST のタイムアウト・5xx | `pnpm --silent gmail status --operation setup-test-001` で状態と ID を保持。Gmail で作成済みか調べ、同じメールを新しい操作 ID で複製しない。        |
| 既存の下書き ID を回収できた                | `pnpm --silent gmail verify --operation setup-test-001 --draft-id EXISTING_DRAFT_ID` で同じ画像・アカウントを検証。下書き ID とメッセージ ID は別。 |
| プロセス終了後に `.lock` が残った           | 実行中の操作がないこと、操作 JSON と Gmail 側を確認して、その操作のロックだけを除去。操作記録を消さない。                                           |
| `verification_failed` / 画像がない          | 下書き・追跡 ID を残し、保存済み MIME と編集内容を確認。送信や成功の扱いをせず、原因修正後に同じ操作を検証。                                        |
| 送信後、下書きを読めない                    | 送信・削除後に下書きがなくなるのは正常。404 だけで送信済みと判断しない。現在の CLI は Sent を読まない。                                             |
| 開いたのに履歴が増えない                    | 画像の保持・表示・プロキシ・キャッシュを別々に調べる。再開封を毎回記録できると約束しない。新規ピクセルで再試験する。                                |

同じ論理的なメールは同じ `--operation` を使います。登録の Idempotency-Key とローカルの操作ロックは、それぞれの処理の重複を抑えるもので、Gmail の不明な POST を安全に再送できる保証ではありません。本文・宛先・アカウント等が変わった場合は別のメールとして扱います。

## 完了報告

秘密を含めず、次を短く報告します。

- 利用するアカウント、専用 GCP プロジェクト、Audience / publishing 状態、Desktop client の設定有無。公開コミットへ個人設定は追加しない。
- Worker URL、cf / Wrangler の選択、認証 JSON・Worker シークレット・状態ディレクトリ・永続指示の保存場所、認証ストアの方式。
- 保存情報の存在、実際のトークン更新、下書きの `verified`、手動送信、受信 MIME、Web / iOS の新規履歴、署名付き Webhook をそれぞれ確認済み・未確認・阻害要因ありで分ける。
- テスト操作 ID・下書き ID・追跡 ID・検証時刻、Webhook の有効・無効、再認証の条件、費用の前提。
- 通常の Gmail 新規作成の自動追跡・自動送信検知は未実装であることと、手動 `arm` または明示的な即時追跡の運用。

デプロイや保存済み認証だけで Gmail 連携全体を完了扱いせず、アクセス待ちでも独立して確認できた工程を残してください。[既存 Gmail 接続](gmail-connectors.ja.md)は、対応する MIME 入出力が実際に検証できた場合の任意の短縮経路です。現在の直接 CLI の設定を置き換える前に、その経路自身の検証範囲を確認します。
