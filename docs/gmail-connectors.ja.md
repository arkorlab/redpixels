# 既存の Gmail 接続を使う

[English](gmail-connectors.md) | **日本語** · [README](../README.ja.md)

まず、エージェントがすでに持つ Gmail 接続を使います。対応するコネクターなら、別の Google Cloud プロジェクト・クライアント JSON・redpixels 専用の Google ログインを追加せずに追跡付き下書きを作れます。Gmail の認証は接続元のサービスが管理します。追跡 Worker は自分の Cloudflare に置き、Google の認証情報は渡しません。

**コネクターの実際の機能を確認してください。** `htmlBody` で画像を除去するものもあれば、MIME ツリーや raw メッセージを受け取り画像を保持するものもあります。引数の名前や作成成功の応答だけでは画像保持を確認できません。Gmail に保存されたメッセージを読み戻して確認します。

## エージェントの処理

1. 接続中の Gmail アカウントと、下書き作成ツールの入力仕様を確認します。コネクター内部のトークンは取り出しません。
2. redpixels に宛先・件名・`armed:false` を登録します。論理的なメールごとに固有の `Idempotency-Key` を使い、返された追跡 ID・画像 URL・`pixel_html` を保持します。
3. その HTML を本文内へ外部画像として追加します。コネクターが対応する MIME バイト列または raw メッセージの入力を使います。通常の `htmlBody` 欄へエンコード済み文字列をそのまま渡してはいけません。
4. 未送信の下書きを作り、Gmail の下書き ID と、その中のメッセージ ID を保存します。タイムアウトなどで結果が不明な場合は調べてから再試行します。redpixels の重複登録防止では Gmail 下書きの重複作成は防げません。
5. 可能なら Gmail の `format:raw` で保存済みメッセージを取得し、RFC 2822・転送エンコード・HTML MIME パートを復号します。返された画像 URL の実際の `<img>` が必要です。スニペット・プレーンテキスト・コネクターが生成したプレビューだけでは不十分です。画像の存在確認のためにピクセル URL へアクセスしてはいけません。
6. 検証に成功してから下書きを返します。編集時も画像を保持し、編集後は再検証します。画像が削除される場合や保存済み MIME を読めない場合は、互換性の不足を報告し、送信や追跡成功の扱いをしません。
7. 人が Gmail で確認して送信します。その申告後、Worker の API トークンで `POST /v1/messages/<id>/arm` を呼びます。ID の対応はエージェントが保持します。CLI の `gmail arm --operation` は、その CLI が作成した操作にだけ使えます。

従来の HTTP API の既定は即時追跡ですが、このフローでは明示的に `armed:false` を指定します。開始前の取得は `before_armed` として履歴に残り、通知しません。ただし下書きの画像がプロキシにキャッシュされることや、開始後の自分の送信済み閲覧が記録されることはあります。追跡開始だけでキャッシュや読了判定の問題は解消しません。

## 確認できたコネクターの入力

2026-10-16 の試験時に使えた Codex の Gmail コネクターは、次の形式を受け付けました。

```json
{
  "to": "recipient@example.com",
  "subject": "Hello",
  "payload": {
    "mime_type": "text/html",
    "charset": "UTF-8",
    "body": {
      "base64_url_content": "BASE64URL_OF_HTML_WITH_PIXEL"
    }
  }
}
```

これは**入力仕様の例**です。仮の値をそのまま送らず、画像入りの UTF-8 HTML 本文を base64url エンコードした値へ置き換えます。この欄に入るのは1つの HTML MIME パートです。Gmail REST API の raw 経路では、RFC 2822 メッセージ**全体**をエンコードして `message.raw` に入れます。使用するコネクターの実際の仕様に従ってください。

実試験では既存の接続で未送信の下書きを1通作り、同じ接続の `format:raw` で読み戻しました。復号した HTML は実際の画像タグを含めて送信した HTML と一致しました。任意の CLI 用に作った OAuth・キーチェーンの認証情報は使っていません。この経路のための追加の Google Cloud 設定もありません。**この新しい下書きは送信・受信者閲覧を行っていないため、今回確認したのは保存時の画像保持までです。** 従来の[モバイル試験](mobile-test.md)や、別経路の [CLI の受入試験](gmail-cli.ja.md#手動の受入テスト)とは範囲が異なります。

他サービスの `htmlBody` コネクターが同じように動くという意味ではありません。コネクターの機能は変わり得るため、セットアップ時に新しい下書きの保存済み MIME を確認し、全体の互換性を判断する際は別アカウントでの配信・開封・Webhook も試してください。

## 画像を保持できる接続がない場合

追跡 Worker のデプロイは完了させ、下書き連携は未完了と報告します。MIME に対応した、利用環境で正式に使える Gmail 接続が設定の少ない代案です。[直接接続する CLI](gmail-cli.ja.md) は、自分の Desktop OAuth クライアントを使うと明示的に選んだ場合の上級者向け代替です。現状は Google Cloud 設定が必要なので、redpixels のデプロイを頼まれただけで自動的にその設定を始めないでください。

Google の[下書きの MIME 手順](https://developers.google.com/workspace/gmail/api/guides/drafts)と [raw メッセージの表現](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)も参照してください。
