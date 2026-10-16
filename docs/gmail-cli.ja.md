# Gmail の raw MIME 下書き CLI

[English](gmail-cli.md) | **日本語** · [README](../README.ja.md)

`pnpm gmail draft` は、メールの登録、ピクセルの挿入、RFC 2822 / MIME の構築、Gmail `users.drafts.create` への `message.raw` の送信、保存内容の読み戻し検証までを 1 コマンドで行います。**下書き専用で、メールは送信しません。** 人が Gmail で確認して Send を押します。

一部のコネクターは `htmlBody` の `<img>` を除去します。HTML をコネクターへ渡しただけでは画像保持を確認したことになりません。この CLI は Gmail API に直接アクセスし、保存済みの `text/html` MIME パートで画像を検証します。CLI 自体はピクセルを取得しません。保存後の Gmail 編集・送信時にも画像が保持されるかは別の確認です。

## 設計の選択

- **リポジトリ同梱の TypeScript CLI。** 既存の Worker・API・SQL スキーマを変えず、Gmail の認証情報を端末上に置きます。認証サーバー、MCP サーバー、公開 Gmail 送信 API は追加しません。エージェントはコマンドの JSON 出力を利用できます。
- **Google 公式 `google-auth-library`。** PKCE、認可 URL、トークン交換・更新を公式 SDK に任せます。localhost の受付と state 検証は CLI が行います。Web アプリ用のログイン・セッション DB は不要です。
- **自分の OAuth クライアント。** 各セルフホスト利用者が Google Cloud の Desktop app クライアントを作ります。共用クライアントやサービスアカウント、ドメイン全体の委任は使いません。
- **下書き専用。** 要求する `gmail.compose` は Google 側では下書き管理と送信を許可する制限付きスコープです。CLI に送信コマンドがないことと、トークンの権限が送信を含むことは別です。一般の受信箱を読む権限は追加要求しません。
- **送信後に手動で追跡開始。** 下書きは既定で `armed:false`。送信前の通知を抑え、送信した人が明示的に追跡開始します。送信済みの自動監視は追加しません。

デスクトップ型はローカル CLI の認証方式です。作成した下書きを Gmail の Web やスマホから送る場合も変わりません。将来の Managed Web 版では、別の Web OAuth クライアントとサーバー側のトークン保存を使います。Managed 版の利用者は接続ボタンで許可するだけで、自分のクライアント作成は不要にする想定です。この OSS 版には Managed 版の実装は含みません。[設計メモ](architecture.md#future-hosted-edition)と [Google のクライアント種別](https://developers.google.com/workspace/guides/create-credentials)も参照してください。

## 1. Google Cloud で OAuth クライアントを作る

1. [Google Cloud Console](https://console.cloud.google.com/) で自分が管理するプロジェクトを選ぶか、新規作成します。
2. そのプロジェクトで [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) を有効にします。
3. [Google Auth Platform](https://console.cloud.google.com/auth/overview) の Branding / Audience を設定します。個人用途のアプリ名、サポート・連絡先メールを設定。External の Testing を使う場合は、下書きを作る自分の Google アカウントを Test users に追加します。Internal は対象 Workspace 組織内だけで使う場合に選びます。
4. Data Access に `https://www.googleapis.com/auth/gmail.compose` を追加します。
5. [Clients](https://console.cloud.google.com/auth/clients) → Create client → **Desktop app** を選択し、JSON をダウンロードします。Web application の JSON は使えません。
6. JSON はリポジトリの外に保存します。macOS / Linux では `chmod 600 /absolute/path/client_secret.json` で所有者だけが読めるようにします。値をチャット・Git・Worker の環境変数に入れないでください。

Google の [Desktop OAuth 手順](https://developers.google.com/identity/protocols/oauth2/native-app)と [Gmail スコープ](https://developers.google.com/workspace/gmail/api/auth/scopes)も参照してください。`gmail.compose` は制限付きスコープで、組織管理者の許可が必要な場合があります。個人・組織内利用などの[審査の例外](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#exceptions-verification-requirements)と、不特定多数向けアプリの審査要件は区別してください。redpixels が審査済みの共通 OAuth アプリを提供するわけではありません。

External / Testing のリフレッシュトークンは通常 [7 日で失効します](https://developers.google.com/identity/protocols/oauth2#expiration)。長期運用の Audience / publishing 設定は自分の用途と Google の要件に合わせて選びます。Production への変更だけで審査済みにはなりません。取り消し・ポリシー・パスワード変更でも再認証が必要になる場合があります。

## 2. 一度ログインする

Node.js 22.18 以降または 24 LTS、pnpm 10 を使います。

```sh
pnpm install --frozen-lockfile
pnpm gmail auth login --client /absolute/path/client_secret.json
pnpm gmail auth status
```

ブラウザーで対象の Gmail アカウントを選び、権限を確認します。CLI は Gmail `users.getProfile` で本人のメールアドレスを確認し、そのアドレスを From にします。任意の From や送信エイリアスは今回の CLI では扱いません。ログイン結果・下書き結果は JSON で返り、秘密の値は表示しません。スクリプトで純粋な JSON だけが必要な場合は `pnpm --silent gmail ...` を使えます。

既定の保存先は macOS Keychain / Windows Credential Manager / Linux Secret Service。サービス名は `redpixels.gmail` で、ローカル状態ディレクトリから導いたアカウント名を使います。リフレッシュトークンとクライアント情報を保存し、アクセストークンは実行中のメモリだけに置きます。ロック中・利用不可の認証ストアを平文ファイルへ自動で切り替えることはしません。

Secret Service のないヘッドレス環境では、以下を**明示的に選択**できます。

```sh
export REDPIXELS_GMAIL_TOKEN_STORE=file
export REDPIXELS_GMAIL_HOME=/absolute/private/path/redpixels-gmail
pnpm gmail auth login --client /absolute/path/client_secret.json --no-browser
```

ファイル方式は暗号化されません。状態ディレクトリは 0700、`credentials.json` は 0600 に制限します。Windows では Unix のモードだけでは ACL の代わりにならないため、既定の認証ストアを推奨します。状態ディレクトリは Git 同期・共有フォルダーの外に置きます。エージェントの実行環境でも同じ環境設定を保持してください。

OAuth のコールバックは `127.0.0.1` の空いているポートで受けます。`--no-browser` はリンクを表示するだけで、localhost の到達性は必要です。SSH 上なら、例として `ssh -L 8765:127.0.0.1:8765 user@host` で転送し、リモートで `--port 8765 --no-browser` を指定します。廃止済みの OOB コード貼り付けや、Gmail スコープに使えない device-code 認証は使いません。

## 3. 1 コマンドで下書きを作る

既存の Worker URL を設定します。Worker のトークンはエージェントのシークレット管理から `REDPIXELS_API_TOKEN` に渡すか、所有者だけが読める JSON の `API_TOKEN` を使います。

```sh
export REDPIXELS_URL='https://redpixels.<your-subdomain>.workers.dev'
export REDPIXELS_SECRETS_FILE='/absolute/path/.env.redpixels.json'

pnpm --silent gmail draft \
  --to recipient@example.com \
  --subject 'Hello' \
  --html examples/email.html \
  --operation hello-001
```

`REDPIXELS_SECRETS_FILE` の既定値は現在のディレクトリの `.env.redpixels.json`。Worker 用の `API_TOKEN` を読み、Google の認証情報はそこへ追加しません。本文は UTF-8 HTML ファイルで、`--text email.txt` を追加すると plain text パートも設定できます。宛先は 1 つの通常のメールアドレスに限定し、宛先リスト・表示名・添付・返信スレッドは今回の CLI の対象外です。HTML・テキストはそれぞれ最大 2 MiB。

成功時は `operation`、`account`、`tracking_id`、`gmail_draft_id`、`gmail_message_id`、`state:"verified"`、`pixel_verified_at`、`armed` を返します。保存した MIME に画像がなければ終了コード 1 になります。`pixel_verified_at` は確認した時点であり、その後の編集まで保証しません。編集後は送信前に再確認できます。

```sh
pnpm --silent gmail verify --operation hello-001
```

人が Gmail で確認して Send を押したら、追跡を開始します。

```sh
pnpm --silent gmail arm --operation hello-001 --confirm-sent
```

`--confirm-sent` は人・エージェントからの申告です。CLI が送信済みフォルダーで確認したという意味ではありません。送信直後の取得を逃す場合があるため、受信者のテスト閲覧前に追跡開始します。

従来と同じ即時追跡が必要なら、下書き作成時に `--armed` を指定します。この場合は送信前のプレビューでも通知され得ます。

## 再試行と復旧

論理的なメールごとに異なる `--operation` を使い、同じメールの再試行だけで再利用します。宛先・件名・本文・アカウント・Worker・初期 armed 設定が変われば同じ操作IDでは拒否します。本文そのものやトークンは操作記録へ保存せず、入力のハッシュと下書き・追跡IDなどを保存します。

正常に完了した同じ操作は既存の結果を返します。Gmail のタイムアウト・5xxなどでは、作成された可能性があるため自動で POST をやり直しません。

```sh
pnpm --silent gmail status --operation hello-001
# Gmail / Gmail API で既存下書きを調べ、実際の draft ID がわかった場合:
pnpm --silent gmail verify --operation hello-001 --draft-id EXISTING_DRAFT_ID
```

下書きIDと、その中のメッセージIDは異なります。送信後に下書きがなくなるのは正常です。この CLI は受信箱や送信済みの MIME を取得しません。処理が強制終了して `.lock` が残った場合は、操作が動いていないことと JSON 記録・Gmail 側を調べてから、その操作のロックだけを除去します。操作記録を消して盲目的に再作成しないでください。

```sh
pnpm gmail auth logout
# Google 側の許可も取り消す場合（同プロジェクトの他クライアントにも影響し得る）:
pnpm gmail auth logout --revoke
```

## 自分の閲覧と Gmail プロキシの限界

- 追跡開始前の取得も、既存 API の仕様どおり `before_armed` として保存され、`open_count` に含まれます。通知は発生せず、`eligible_open_count` は増えません。履歴から自分の取得を消したという意味ではありません。
- Google の画像プロキシは送信者の Cookie・認証ヘッダー・実 IP を渡さないため、Gmail の下書き・Sent の閲覧を確実に本人判定できません。`SELF_IPS` や所有者 Cookie は直接取得の補助に限られます。
- **未追跡中の画像応答もプロキシにキャッシュされる場合があります。** 送信後に arm しても、キャッシュに残った画像を再取得させることはできません。Sent を開くと、その後も通知され得ます。時刻・UAによる人間判定も保証しません。
- [Google の説明](https://support.google.com/mail/answer/145919?hl=en)も、画像の自動表示・安全確認・Cookie の制限を記載しています。各 Web / iOS 閲覧や再開封が毎回 origin に届くことは保証できません。

## 手動の受入テスト

Web と iOS は**別々の新しいメール・操作ID・ピクセル**で試します。同じメールを順番に開くとキャッシュにより 2 回目の判定ができない場合があります。

1. 上の OAuth 手順を完了し、送信者のアカウントが正しいことを確認します。
2. 自分が操作できる**別の Gmail アカウント**宛てに `draft` で新規下書きを作ります。JSON の `state:"verified"` と各 ID を保存します。
3. Gmail で下書きを編集した場合は、閉じて保存し、CLI の `verify` を実行。画像がないエラーなら送信しません。
4. 人が送信します。既存の閲覧権限があれば送信済み／受信メールの「メッセージのソースを表示」や raw MIME でも元の画像 URL を確認します。下書きの検証だけで受信 MIME を検証したとは報告しません。
5. `arm --confirm-sent` を実行し、受信メールを開く前の履歴件数・最終イベントを記録します。
6. 別アカウントの Gmail Web で 1 回開き、履歴APIを再取得して新規イベント・UTC時刻・フラグ・通知の状態を比較します。Webhook は受信先で署名とイベントIDを照合します。
7. 新しいメールで 2〜6 を繰り返し、今回は受信側の iOS Gmail で開きます。OS・アプリのバージョンを記録します。
8. 同じメールの再開封は別項目として調べます。記録が増えないことを「未読」や「画像消失」と断定しません。

CLI の自動テストは Gmail / redpixels の HTTP 境界を模擬しており、本物の OAuth 同意・Gmail 配信・実機閲覧の確認ではありません。別途 **2026-10-16** に、新 CLI・デプロイ済み Worker・署名検証する Webhook 受信先を使い、以下を確認しました。

- Workspace 内部アプリの Desktop OAuth が完了し、macOS キーチェーンに認証情報を保存。別々の CLI プロセスでトークンを更新して raw MIME の下書きを2通作成し、Gmail から保存済み本文を読み戻して両方の画像を確認。履歴は各0件でした。
- 人が別の Gmail アカウントへ手動送信。編集・送信の操作中に各1件の Google 画像プロキシ取得がありましたが、開始前のため `before_armed` として履歴に残り、通知は出ませんでした。
- 手動で追跡開始後、利用者が Web 用メールを Gmail Web で、別の iOS 用メールを iOS の Gmail で開いたと報告。各履歴は **1 → 2**、通知対象の回数は各 **1** になり、新しいイベント ID と一致する署名検証済み Webhook を **HTTP 204** で受信しました。記録時刻は Web 用 **11:24:43.849Z**、iOS 用 **11:24:45.841Z** です。

端末の区別は利用者の操作報告によります。どちらも Google 画像プロキシ経由のため、リクエスト単体では実際の端末や読了を確定できません。受信側の raw MIME と今回の正確な iOS / Gmail バージョンは取得していません。Windows / Linux の認証情報ストア、繰り返し開封、返信、開始後の自分の閲覧、Apple MPP の実挙動は未検証です。従来の [モバイル保存確認](mobile-test.md)は別の下書き作成経路で行っています。
