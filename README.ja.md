# メールが読まれた瞬間に、通知を受け取る。

[English](README.md) | **日本語**

**redpixels** は、Gmail 向けの開封履歴と署名付き Webhook を自分の Cloudflare で運用する OSS です。

- **Gmail をそのまま使える。** Chrome 拡張も別のメールアプリも不要です。AI アシスタントが Gmail API で作る HTML 下書きに小さな画像を追加し、Gmail から確認・送信します。モバイルアプリでも、編集後に画像が保持されれば利用できます。
- **観測できた開封履歴をすべて確認できる。** Worker に届いた画像リクエストを、時刻・回数・相対時刻・判定フラグとともに記録します。
- **Webhook で通知できる。** 通知対象の初回だけ、または毎回通知し、署名と永続的な再試行に対応します。
- **自分の Cloudflare にホストできる。** Worker と組み込みの SQLite ストレージだけで動作し、MIT ライセンスで公開しています。追跡サーバーに Gmail の認証情報は渡しません。

**画像の取得は、実際に読まれたことの証明ではありません。** キャッシュによって再開封が記録されないことがあり、Apple Mail Privacy Protection やプレビューは人が読む前に画像を取得します。記録するのは観測できた画像取得であり、実際の全既読ではありません。モバイルの挙動は端末によって異なります。[実機確認結果と未確認の範囲](#gmail-モバイルとの互換性)を確認してください。

名前は「read pixels」との掛け言葉です。read の過去形は red と同じ発音になります。

## エージェントにセットアップしてもらう

ターミナルを操作でき、自分の Cloudflare アカウントを利用できるエージェントへ、以下の**どちらか一方**を渡してください。新規導入には Cloudflare の [cf CLI](https://developers.cloudflare.com/cf/get-started/)（現在ベータ）を使えます。Wrangler の手順も維持しており、同じ Worker コードと SQLite を使います。Gmail が未接続の場合は別途ログインします。

### cf CLI

```text
以下の手順に従って、cf を使って redpixels をセットアップしてください。
https://raw.githubusercontent.com/arkorlab/redpixels/main/docs/agent-setup-cf.ja.md

自分の Cloudflare アカウントへデプロイし、エージェントが作る HTML Gmail
下書きのフローに接続してください。cf の既存の認証を使い、秘密の値は
安全に生成・保存し、無関係な設定を保持してください。作業は直接進め、
必要なログイン・アカウント選択・不足情報だけを確認してください。

認証済みの自分の Gmail アドレスに、用途を明記したセットアップ確認メールを
ちょうど 1 通送って構いません。使用した CLI、Worker の URL、下書き作成の
永続設定の保存場所、検証結果、Webhook の設定状態を報告してください。
```

### Wrangler

```text
以下の手順に従って、Wrangler を使って redpixels をセットアップしてください。
https://raw.githubusercontent.com/arkorlab/redpixels/main/docs/agent-setup-wrangler.ja.md

自分の Cloudflare アカウントへデプロイし、エージェントが作る HTML Gmail
下書きのフローに接続してください。Wrangler の既存の認証を使い、秘密の値は
安全に生成・保存し、無関係な設定を保持してください。作業は直接進め、
必要なログイン・アカウント選択・不足情報だけを確認してください。

認証済みの自分の Gmail アドレスに、用途を明記したセットアップ確認メールを
ちょうど 1 通送って構いません。使用した CLI、Worker の URL、下書き作成の
永続設定の保存場所、検証結果、Webhook の設定状態を報告してください。
```

対応する HTTPS Webhook 受信先がある場合は、その URL と、通知を `first`（初回）か `every`（毎回）のどちらにするかを追記してください。受信先がなければ、履歴の追跡まで設定し、Webhook は無効と報告します。API キーはプロンプトへ貼らず、エージェントのシークレット管理機能に保存します。

[エージェント向けセットアップガイド](docs/agent-setup.ja.md)に、デプロイ、秘密の設定、下書き作成フローへの永続的な組み込み、実環境での確認をまとめています。redpixels のデプロイだけで通常の Gmail 作成メールが追跡されるわけではなく、下書き作成フローで返されたピクセルを埋め込む必要があります。手動で進める場合は、以下の手順を使えます。

## 数分でデプロイ

Cloudflare アカウント、Node.js **22.18 以降または 24 LTS**、[pnpm](https://pnpm.io/installation) 10 が必要です。両 CLI はプロジェクト内にバージョンを固定しており、グローバルインストールは不要です。SQLite Durable Object は設定から準備されるため、手動のデータベース ID、KV 名前空間、外部データベースは不要です。Cloudflare の利用上限・料金は適用されます。[Durable Objects の料金](https://developers.cloudflare.com/durable-objects/platform/pricing/)を確認してください。

```sh
git clone https://github.com/arkorlab/redpixels.git
cd redpixels
pnpm install --frozen-lockfile
node --experimental-strip-types examples/create-secrets.mts
```

最後のコマンドは、ランダムな API トークンを `.env.redpixels.json` に権限 0600 で保存し、値を表示しません。既存ファイルは上書きしないため、更新時は既存の秘密の値を使ってください。ファイルは Git 除外対象です。中の `API_TOKEN` をパスワードマネージャーとアシスタントのシークレット設定に保存します。

**どちらか一方**の手順でデプロイします。

### cf でデプロイ

```sh
pnpm exec cf auth login
pnpm run deploy:cf --secrets-file .env.redpixels.json
```

cf は `cloudflare.config.ts` と、バンドラー用の `wrangler.config.ts` を読みます。認証は Wrangler と別です。ローカルでブラウザーを開けなければ `pnpm exec cf auth login --no-browser` を使い、表示されたリンクとコードで許可します。このリポジトリは設定済みなので `cf init` や `cf migrate` は実行しません。現状、この cf 経路でもバンドラーには Wrangler を使うため、ビルド依存には残っています。

### Wrangler でデプロイ

```sh
pnpm exec wrangler login
pnpm run deploy:wrangler --secrets-file .env.redpixels.json
```

Wrangler は `wrangler.toml` を使い、専用スクリプトで明示的に指定しています。localhost のコールバックが使えなければ、固定版は `pnpm exec wrangler login --device` に対応しています。従来の `pnpm dev`、`pnpm run deploy`、`pnpm build` は Wrangler の別名として維持します。

どちらも、通常は `https://redpixels.<your-subdomain>.workers.dev` という Worker URL を出力します。`API_TOKEN` がなければ API は利用できません。既存環境の更新では同じアカウント・Worker 名・バインディング・SQLite クラスを使い、名前空間と履歴を維持してください。cf の設定はベータで、このプロジェクトで記録した検証には cf 経由の実デプロイはまだ含まれません。詳しくは [cf](docs/agent-setup-cf.ja.md) / [Wrangler](docs/agent-setup-wrangler.ja.md) のガイドを参照してください。

以降の例で使う値を、手元のシェルに設定します。

```sh
export REDPIXELS_URL='https://redpixels.<your-subdomain>.workers.dev'
export REDPIXELS_API_TOKEN='<設定した API_TOKEN>'
```

メールを登録すると、ランダムで一意の画像 URL が生成されます。

```sh
curl --fail-with-body "$REDPIXELS_URL/v1/messages" \
  -H "Authorization: Bearer $REDPIXELS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: draft-operation-123' \
  --data '{"recipient":"alice@example.com","subject":"Hello"}'
```

レスポンスには `id`、`pixel_url`、埋め込み用の `pixel_html` が含まれます。

```html
<img
  src="https://YOUR-WORKER/p/GENERATED-UUID.gif"
  width="1"
  height="1"
  alt=""
  style="display:block;border:0;width:1px;height:1px"
/>
```

上の仮の URL ではなく、**API が返した HTML** を使ってください。下書きの HTML 本文内、できれば `</body>` の直前に追加します。外部画像のまま保持し、CID 添付、data URL、単なる文字列に変換しないでください。過去のメールや、画像を埋め込まずに作成したメールを後から追跡することはできません。

`Idempotency-Key` はメールごとに新しい値を使います。同じキーと本文で再試行すると同じ画像が返り、メタデータが変わっていれば `409` になります。ヘッダーは任意ですが、AI のワークフローでは指定を推奨します。複数人宛ての 1 通は画像を共有するため、誰が取得したかは区別できません。区別したい場合は個別のメールと画像を使います。

## Gmail 下書きへの組み込み

1. redpixels にメールを登録します。
2. HTML MIME パートに `pixel_html` を追加します。
3. 完成した MIME メッセージを base64url でエンコードし、Gmail の `users.drafts.create` を呼びます。
4. Gmail で確認して送信します。下書きを置き換える際も画像を保持してください。

MIME と base64url の形式は [Google の下書きガイド](https://developers.google.com/workspace/gmail/api/guides/drafts)に記載されています。redpixels 本体は受信箱を読まず、Gmail OAuth 権限を取得せず、メールを送信しません。

依存ライブラリ不要の [Node サンプル](examples/gmail-draft.mts)で、送信せずに下書きを作成できます。

```sh
export GMAIL_ACCESS_TOKEN='<gmail.compose 権限のある OAuth アクセストークン>'
export GMAIL_FROM='you@example.com'
export GMAIL_TO='alice@example.com'
export GMAIL_SUBJECT='Hello'
export GMAIL_TEXT='Hello Alice!'
node --experimental-strip-types examples/gmail-draft.mts examples/email.html
```

実際に使う際は [examples/email.html](examples/email.html) を自分の HTML ファイルに置き換えてください。既存の AI アシスタントの Gmail 認証を利用します。未取得の場合は [Google の権限ガイド](https://developers.google.com/workspace/gmail/api/auth/scopes)を確認して先に Gmail API の OAuth を設定してください。redpixels のデプロイでは Gmail 認証は提供されません。Gmail の認証情報を使うのは手元のサンプルだけです。Worker の環境変数には入れません。Gmail のエラーやタイムアウト時には、復旧のため redpixels の ID を表示・保持します。サンプルを再実行すると Gmail 下書きが重複する場合があります。`REDPIXELS_IDEMPOTENCY_KEY` が重複を防ぐのは redpixels の登録だけであり、Gmail 下書きの作成ではありません。

### 下書きプレビューと追跡開始

初期設定では、登録直後から追跡します。送信前のプレビューでも画像が取得される可能性があります。送信後に処理を実行できる場合は `"armed":false` で登録し、送信後に次を呼びます。

```sh
curl --fail-with-body -X POST "$REDPIXELS_URL/v1/messages/<id>/arm" \
  -H "Authorization: Bearer $REDPIXELS_API_TOKEN"
```

開始前の取得も `before_armed` として履歴に残りますが、通知しません。繰り返し開始しても、最初の開始時刻を維持します。スマホから手動送信する場合は、アシスタント側に送信後の確認処理が必要です。redpixels は Gmail の送信済みフォルダーを監視しません。送信後の開始では即時の開封を取り逃がす場合があり、プレビュー取得でプロキシのキャッシュが埋まっている場合もあります。自分の開封を完全に除外する仕組みではありません。

## 観測した開封をすべて確認

```sh
curl --fail-with-body "$REDPIXELS_URL/v1/messages/<id>/opens?limit=100" \
  -H "Authorization: Bearer $REDPIXELS_API_TOKEN"

# 全ページを取得して時系列で表示
node --experimental-strip-types examples/history.mts <id>
```

出力例です。相対時刻の文字列は英語で返ります。

```text
Hello: 2 observed fetches
#1  2026-10-14T09:00:00.000Z  2 days ago  [google_image_proxy]
#2  2026-10-16T04:00:00.000Z  5 hours ago  [google_image_proxy]
```

JSON は `message` にメタデータと合計、`opens` に履歴、`next_after` に次ページのカーソルを返します。各取得には、一意の `event_id`、UTC の `timestamp`、相対時刻 `ago`、通し番号 `open_number`、`ua`、`country`、`flags`、`notification_eligible`、`webhook` の配信状態が含まれます。

- `open_count`：自動取得の疑いや自分の取得も含む、記録した GET の総数。
- `eligible_open_count`：記録時のフィルターで通知対象となった取得数。**人間の既読数の推定ではありません。**
- `webhook_count`：通知キューに追加した数。配信成功数ではありません。
- `webhook`：通知がなければ `null`。それ以外は `status`（`pending`、`delivered`、`failed`）、`attempts`、`last_status`、`last_error`、`delivered_at`。

履歴は同時刻の取得も含め、古い順に安定した数値カーソルで返します。`next_after` が `null` になるまで取得してください。履歴を黙って切り捨てることはありません。ページサイズは既定 100、最大 500 です。メール一覧には取得回数が 0 のメールも含まれます。フラグと通知対象判定は記録時の値を保存し、設定変更後に再計算しません。

## 署名付き Webhook

cf を使う場合は、保護された `.env.redpixels.json` に別のランダムな 32 文字以上の `WEBHOOK_SECRET` と `WEBHOOK_URL`、必要なら `WEBHOOK_MODE` / `WEBHOOK_FILTER` を追加し、`API_TOKEN` は保持します。`pnpm run deploy:cf --secrets-file .env.redpixels.json` で反映してください。cf は単一シークレットの `put` コマンドにはまだ対応していません。

Wrangler では `deploy:wrangler` による同じファイルの反映か、以下の対話形式を使えます。

```sh
pnpm exec wrangler secret put WEBHOOK_SECRET --config wrangler.toml
pnpm exec wrangler secret put WEBHOOK_URL --config wrangler.toml

# 任意：既定の every の代わりに first を入力
pnpm exec wrangler secret put WEBHOOK_MODE --config wrangler.toml

# 任意：既定の all の代わりに unflagged を入力
pnpm exec wrangler secret put WEBHOOK_FILTER --config wrangler.toml
```

個人設定はすべて Worker の環境変数です。両方の手順で秘密の値をソースの外に保存します。再デプロイ時は既存の値を再利用してください。有効な署名シークレットなしで URL を指定すると設定エラーになり、未署名の通知は送信しません。

| 設定                   | 動作                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `every`                | 通知対象の取得ごとに通知します。                                                                                                                               |
| `first`                | Webhook 有効時の最初の通知対象だけ通知します。自分の取得と開始前の取得では消費しません。配信失敗は同じイベントを再試行し、後の開封で別の初回通知を作りません。 |
| フィルター `all`       | MPP、自動取得、早い取得の疑いもフラグ付きで通知します。明示的な自分の取得と開始前の取得は常に除外します。                                                      |
| フィルター `unflagged` | MPP、自動取得、早い取得の疑いも除外します。Gmail プロキシのフラグだけなら通知対象です。実際の既読を除外する場合があり、人間の閲覧だけになる保証はありません。  |

ペイロードは `type: "email.open"`、`version: 1`、固定の `event_id`、`message_id`、`recipient`、`subject`、`external_id`、UTC の `timestamp`、その取得時点の `open_count` / `eligible_open_count`、`ua`、`country`、`flags` です。

```text
X-Redpixels-Event-Id: <再試行しても同じイベント UUID>
X-Redpixels-Timestamp: <今回の配信試行の Unix 秒>
X-Redpixels-Signature: v1=<HMAC-SHA256 の 16 進数>
```

共有シークレットで **`timestamp + "." + 未加工のリクエスト本文`** に署名します。定時間比較で検証し、過去・未来に 5 分を超える時刻は拒否してください。`event_id` で重複排除を永続化し、JSON の解析は署名検証後に行います。テスト済みの [Node 検証関数](examples/verify-webhook.mts)を参照してください。通知にはメールのメタデータを含むため、自分で管理する受信先を使います。

履歴・回数・通知キュー・アラームは同じストレージトランザクションで確定します。Webhook の HTTP は画像応答とは別に実行し、1 試行のタイムアウトは 10 秒です。`2xx` で受信確認済みとします。通信エラー、`408`、`429`、`5xx` は指数バックオフで最大 8 回まで試行します（約 11 分＋通信時間）。その他のステータスやリダイレクトは永続失敗とし、リダイレクトには追従しません。アラームはプラットフォームの事情で遅れる場合があります。

**重複を許容する配信方式と、回数を制限した再試行**であり、厳密な 1 回配信や最終的な到達を保証するものではありません。結果不明のタイムアウトや、受信先が受け付けた後のクラッシュで重複する場合があります。イベント ID と本文は維持し、署名用時刻だけ更新します。配信失敗は履歴 API に表示します。`delivered` は HTTP 受信先の受け付けを意味し、その先の通知を人が見たことではありません。上限到達後の自動再投入はありません。キューには登録時の受信先 URL を保持し、署名には現在のシークレットを使います。`WEBHOOK_URL` を解除しても既存キューは動き、新規追加だけ止まります。メール削除で待機中の通知を削除しますが、送信中の HTTP リクエストは取り消せません。

## 自分の閲覧と自動取得の区別

どのフラグも履歴に残ります。実際の閲覧者を証明するものではありません。

| フラグ                   | 根拠と限界                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self_ip`                | 直接のリクエスト元が `SELF_IPS` と完全一致。共有ネットワークの他人も該当する可能性があり、プロキシ経由ではスマホの IP は見えません。生の IP は保存しません。                                       |
| `self_cookie`            | 有効な署名付き所有者 Cookie。Worker の `/self` で API トークンを入力して、そのブラウザを登録します。Gmail / Apple のプロキシは転送せず、サードパーティー Cookie の制限でも使えない場合があります。 |
| `self_authenticated`     | 画像 GET に正しい Bearer トークンが付いている場合。自分の検証用です。トークンをメールや URL に埋め込まないでください。                                                                             |
| `before_armed`           | `armed:false` で登録され、まだ追跡開始していません。                                                                                                                                               |
| `early_fetch`            | 登録・開始から `SELF_WINDOW_SECONDS` 以内（既定 30 秒）。プレビュー、スキャナー、素早い受信者の可能性があり、**自分の開封と確定したわけではありません。**                                          |
| `google_image_proxy`     | UA に `GoogleImageProxy`。通常の Gmail 閲覧でも使われるため、このフラグだけで誤開封とは扱いません。キャッシュや閲覧者の識別はできません。                                                          |
| `possible_apple_mpp`     | 単独の `Mozilla/5.0` または通常のブラウザ・モバイル表記を欠く WebKit UA。大まかで不完全な推定であり、他のクライアントが一致する場合も、Apple の通信が一致しない場合もあります。                    |
| `automation_or_prefetch` | ボット・クローラー・プレビュー・プロキシの UA 表記や、`Purpose` / `Sec-Purpose` の先読み指定。表記がない場合や偽装もあります。                                                                     |

選んだ CLI のシークレット設定で、`SELF_IPS` に自分の IPv4 / IPv6 をカンマ区切りで渡せます。完全一致のみで、CIDR には対応しません。共有の Google / Apple プロキシの IP を登録しないでください。`SELF_WINDOW_SECONDS=0` で時刻による推定を無効にできます。時間が経った自分の閲覧、特に Gmail プロキシ経由の取得は、受信者の閲覧と区別できない場合があります。

## Gmail モバイルとの互換性

**2026 年 10 月 16 日に、iOS 26 の iPhone 実機 1 台で確認しました**（Gmail アプリのバージョンは未記録）。Gmail API で作成した HTML 下書きは、Gmail アプリで本文を編集・保存し、送信した後も 1px 画像を保持していました。受信メールの raw MIME を復号して、変更した本文と、画像の `src` に元のトラッキング URL があることを確認しました。保存後の下書きでは、Gmail が `src` を Google プロキシの URL に変更し、元の URL をフラグメントに保持していましたが、送信時に元の `src` に戻りました。

Android 16 の Pixel 8a でも、別の Gmail API 下書きを編集・保存・送信した後に、1px 画像と元の `src` が残ることを確認しました。受信した raw MIME に、変更済みの本文と元の画像 URL が含まれていました。受信メールを開くと、記録と署名検証済み Webhook が 1 件ずつ増えました（6 → 7 件）。両端末とも Gmail アプリのバージョンは未記録です。

画像保持の試験は、各プラットフォームで 1 台ずつ、自分宛てのメール 1 通を使いました。その後、別の Gmail アカウントへの送信も確認しました。受信者が Gmail for iOS で開いたと報告した後、取得件数が 0 → 1 に増え、同じイベント ID の署名検証済み Webhook が HTTP 204 で受理されました。この別アカウントの受信 raw MIME は確認していません。受信メールの再開封、返信、書式変更は未確認です。Google の MIME 下書き API は、すべてのモバイルエディターでの画像保持を保証するものではありません。詳しい範囲は[実機の記録](docs/mobile-test.md)を確認してください。

**受信メールを開く前の取得も確認しました。** ユーザーが受信メールを開く前に、Google 画像プロキシ経由の取得 4 件と、その署名付き Webhook が届いていました。`google_image_proxy` は付きますが、プロキシ越しに自分の操作と判別できませんでした。通知が受信者の閲覧より先に届く場合があります。

その後、受信メールを開くと、記録と署名検証済み Webhook が 1 件ずつ増えました（4 → 5 件）。この 1 通では Gmail 下書きから通知受信まで確認できましたが、再開封のたびに取得が発生する保証はありません。

Android の下書きでも、編集・保存までに取得と署名検証済み Webhook が 3 件発生し、判定フラグは付いていませんでした。送信後、受信メールの閲覧前には計 6 件となり、5 件はフラグなし、1 件は `google_image_proxy` でした。`flags` が空でも受信者が読んだ証明にはなりません。

利用前に次を確認してください。

1. 新しい下書きと画像を作り、`users.drafts.get?format=raw` の MIME HTML をデコードして、URL があることを確認します。
2. iOS / Android の Gmail で開き、編集・保存します。生の下書きを再度確認し、OS と Gmail のバージョンを記録します。
3. 自分で管理する別アカウントに送信します。受信側の原文 MIME（`users.messages.get?format=raw` または Gmail Web の「メッセージのソースを表示」）で画像を確認します。作成画面のスクリーンショットだけでは不十分です。
4. 受信者が見る前の取得を記録し、受信端末で開いて時刻を照合します。再度開いてキャッシュの影響も確認します。未編集での送信・返信・形式変更は別々に試します。
5. 使用する各プラットフォームで繰り返します。画像が消える場合は HTML 下書きを再生成するか Gmail API で送信し、モバイル編集を安全と決めつけないでください。

[互換性の記録表](docs/mobile-test.md)を使ってください。CI はメールを送信せず、モバイルや実際の MPP 判定精度を検証したとは扱いません。

## 精度と運用上の限界

- **既読や閲覧者の証明ではありません。** リクエストから、注意を向けたか、読んだ時間、閲覧者、転送されたかはわかりません。URL を知っている人は画像を取得してイベントを作れます。
- **Gmail のプロキシとキャッシュ。** [Google は画像のプロキシ配信を説明しています](https://gmail.googleblog.com/2013/12/images-now-showing.html)。キャッシュで再開封が見えなくなり、送信前の取得が再利用される場合もあります。キャッシュ禁止ヘッダーでもクライアントに再取得を強制できません。1 回の取得も既読の証明にはならず、取得がないことも未読の証明にはなりません。
- **Apple のバックグラウンド取得。** [Apple は閲覧時ではなく受信時の外部コンテンツ取得を説明しています](https://support.apple.com/guide/mail/change-privacy-settings-mlhlae4a4fe6/mac)。これが誤った開封を生むことがあります。この実装のサーバー側 MPP 推定は確実ではなく、誤検知・見逃しがあります。
- **画像のブロック。** プレーンテキスト、HTML の削除、追跡ブロック、画像非表示では記録が欠けます。セキュリティースキャナーは余分な取得を生みます。[Gmail も疑わしい画像を非表示にする場合があります](https://support.google.com/mail/answer/145919?hl=en)。
- **オリジンに届いたリクエストだけを記録します。** 時刻は画像取得時刻で、国はプロキシの所在地である場合があります。UA は信頼できる識別情報ではなく、生の IP は保存しません。
- **可用性と不正利用。** 記録・設定エラーでも GIF は返しますが、そのイベントは失われます。ログはメタデータを含まない汎用エラーです。公開画像には人間確認を設けていないため、既知の URL の大量取得でプラットフォームのリソースを消費される可能性があります。
- **保存期間。** 自動期限切れはなく、利用に応じてデータが増えます。1 インストールにつき SQLite Durable Object を 1 つ使い、プラットフォーム上限が適用されます。全ページを取得してエクスポートし、必要に応じてメールを DELETE してください。アップグレード時は Worker 名前空間とマイグレーション履歴を維持します。途中実装の KV データを自動移行する機能はありません。
- **プライバシー。** 任意の宛先・件名、UA、国、時刻、フラグ、配信診断を保存します。URL に含めるのはランダムな ID だけです。メタデータは最小限にし、利用場面に合った説明・同意を用意してください。秘密の値を下書き、URL、Git に含めないでください。

## API

`/v1/*` はすべて `Authorization: Bearer <API_TOKEN>` が必要です。API 応答は `Cache-Control: no-store` です。メタデータや履歴の公開、広い CORS 許可、クエリ文字列のトークン認証はありません。

| メソッド | パス                                       | 内容                                                                                                                             |
| -------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/v1/messages`                             | 任意の `recipient`、`subject`、`external_id`（文字列 / null）、`armed`（真偽値、既定 true）。任意の `Idempotency-Key` ヘッダー。 |
| GET      | `/v1/messages?limit=100&after=0`           | 未取得のメールも含む全一覧。`next_after` で次へ。                                                                                |
| GET      | `/v1/messages/:id`                         | メタデータ、合計、画像 HTML。                                                                                                    |
| GET      | `/v1/messages/:id/opens?limit=100&after=0` | フラグと通知状態を含む履歴。全ページ取得で全履歴。                                                                               |
| POST     | `/v1/messages/:id/arm`                     | 追跡開始。最初の開始時刻を維持。                                                                                                 |
| DELETE   | `/v1/messages/:id`                         | メタデータ、履歴、待機通知を削除し、その画像の記録を停止。                                                                       |
| POST     | `/v1/self`                                 | 所有者 Cookie を設定。`/self` のフォームからも利用可能。                                                                         |
| GET      | `/p/:id.gif`                               | 公開の透明 GIF。登録済み UUID だけ記録し、未知の ID は同じ画像を返して履歴を作らない。                                           |
| HEAD     | `/p/:id.gif`                               | 画像ヘッダーのみ。記録しない。                                                                                                   |

登録本文は最大 16 KiB、宛先と件名は各 1,000 文字、外部 ID は 256 文字です。未知の項目は拒否します。ID はサーバー生成の UUIDv4 です。ページサイズは 1〜500、`after` には前の `next_after` の数値を渡します。`external_id` はワークフローの紐付け用です。Gmail 下書きのメッセージ ID は、下書きの置き換えで変わります。

## 環境変数

個人設定は Cloudflare Worker の環境変数に渡します。cf 用の `cloudflare.config.ts` と Wrangler 用の `wrangler.toml` はインフラ設定だけで、個人の URL、アカウント ID、メールアドレス、キーを含みません。

| 変数                  | 既定                 | 用途                                                                                   |
| --------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `API_TOKEN`           | 必須                 | Bearer トークンと Cookie の署名鍵。32 文字以上。変更すると所有者 Cookie は無効になる。 |
| `WEBHOOK_URL`         | 未設定               | HTTPS 受信先。認証情報・フラグメント・リダイレクトなし。未設定なら新規通知停止。       |
| `WEBHOOK_SECRET`      | URL 使用時に必須     | 別の 32 文字以上の署名鍵。                                                             |
| `WEBHOOK_MODE`        | `every`              | `first` / `every`。                                                                    |
| `WEBHOOK_FILTER`      | `all`                | `all` / `unflagged`。                                                                  |
| `SELF_IPS`            | 未設定               | 自分の IPv4 / IPv6 をカンマ区切りで完全一致比較。保存しない。                          |
| `SELF_WINDOW_SECONDS` | `30`                 | 早い取得の推定期間。0〜86400 秒。                                                      |
| `PUBLIC_BASE_URL`     | リクエストのオリジン | 任意の固定 HTTPS オリジン。パス・クエリなし。独自ドメイン向け。                        |

## 開発

```sh
cp .dev.vars.example .dev.vars
# API_TOKEN を置き換え、必要ならその他のローカル設定を追加
# ローカル開発サーバーはどちらか一方を使う:
pnpm run dev:cf
# または: pnpm run dev:wrangler
pnpm check
pnpm test
pnpm run build:wrangler
pnpm run build:cf
pnpm run check:cli-builds
```

ローカル開発はローカルストレージを使い、デプロイしません。所有者 Cookie には HTTPS が必要なため、`/self` は HTTPS のデプロイ先で試してください。メールクライアントから localhost の画像は取得できません。ローカル変数、依存ファイル、ビルド出力は Git の対象外です。

`pnpm check` は Worker、テスト、Node サンプル、両 CLI の設定を strict な TypeScript で検査します。ランタイムの型は固定版の Wrangler で生成し、生成ファイルは Git 管理しません。`src/types.ts` に開封記録・フラグ・API 応答・Webhook の型を、`src/storage-types.ts` に SQLite の行の型を分けています。型は既存の実行時入力検証の代わりにはなりません。

テストは Workers ランタイムと実際のローカル SQLite Durable Objects で、同時アクセス時の回数・初回通知、認証、重複登録、ページ分割、判定、所有者情報、再起動、削除、署名、再試行上限を確認します。Node のテストは受信署名検証と MIME 構築を確認します。CI では両 CLI のデプロイ dry run と、Worker の識別子・SQLite バインディング・実行コードの一致を確認します。これらで本番デプロイ、Gmail 配信、モバイル編集、実際の MPP 精度を検証したことにはなりません。

[構成の説明](docs/architecture.md)も参照してください。この版は 1 人向けのセルフホスト OSS です。認証・保存・判定・通知配信を分離し、将来のテナント・API キー解決や利用量計測を追加しやすくしています。課金や複数ユーザー管理は含みません。

## ライセンス

[MIT](LICENSE) · Copyright 2026 Arkor
