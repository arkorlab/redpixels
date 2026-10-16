# cf で redpixels をセットアップする

[English](agent-setup-cf.md) | **日本語** · [Wrangler の手順](agent-setup-wrangler.ja.md)

ユーザーが Cloudflare の **cf CLI** を選んだ場合の手順です。承認、秘密の設定、Gmail 下書きフローへの永続的な組み込み、動作確認は[共通ガイド](agent-setup.ja.md)にも従ってください。この文書だけでメール送信が許可されるわけではありません。

## インストールとログイン

1. 手元の README と設定を読みます。Node.js **22.18 以降**または 24 LTS、pnpm 10 を使い、`pnpm install --frozen-lockfile` を実行します。cf はリポジトリにバージョンを固定してあり、グローバルインストールは不要です。別のツールが `cf` という名前を使う場合は、同等の `pnpm exec cloudflare` も使えます。
2. `pnpm exec cf --version` と `pnpm exec cf auth whoami` を確認します。cf の認証は独立しており、Wrangler のログインは引き継ぎません。既存の cf 認証か、適切な権限の `CLOUDFLARE_API_TOKEN` を利用し、ユーザー・アカウントと実行環境のアクセスルールを確認します。
3. 認証が必要なら `pnpm exec cf auth login` を実行します。ローカルでブラウザーを開けない場合は `pnpm exec cf auth login --no-browser` を使い、表示されたリンクとコードでユーザーに許可してもらいます。処理は動かしたままにしてください。このデバイス認証には localhost のコールバックは不要です。
4. 確認した対象アカウントを使います。複数あればユーザーに選んでもらい、必要なら手元の `CLOUDFLARE_ACCOUNT_ID` に設定します。個人のアカウント ID はコミットしません。既存の Worker を変更する前に内容を確認します。

cf と TypeScript 設定は現在 **ベータ** です。コマンドは固定版で検証し、更新時は[公式ドキュメント](https://developers.cloudflare.com/cf/get-started/)を確認します。コマンドの検索は、個人情報を含まない操作・リソースの説明で `cf cli search` を使い、その結果の help を確認してください。

## ビルドとデプロイ

このリポジトリには `cloudflare.config.ts` と `wrangler.config.ts` が既にあります。`cf init` や `cf migrate` は実行しません。設定の生成や Durable Object の手動変換は不要です。cf は固定版の Wrangler をバンドラーとして使いますが、Wrangler のログインは必要ありません。

cf の設定は、`wrangler.toml` と同じ `redpixels` Worker、`src/index.ts`、互換日付、`TRACKER` バインディング、SQLite の `Tracker` export を宣言します。export のライフサイクル宣言が Wrangler の `v1` 作成マイグレーションに対応します。これらの識別子は揃えてください。既存のデプロイでは実際の名前・クラス・ストレージと履歴を維持し、名前空間を作り直したり削除したりしません。個人用に Worker 名を変える場合は、cf 設定の `worker.name` とバインディングの `worker` 参照の両方を変更し、Wrangler も使う場合はそちらの名前も合わせます。

共通ガイドのとおり、保護された Git 除外対象の `.env.redpixels.json` を作成します。`API_TOKEN` と、必要なら Webhook 設定を含めます。Cloudflare API の認証情報や Gmail の認証情報は、Worker 用のこのファイルに入れません。

```sh
pnpm run build:cf
pnpm run deploy:cf --secrets-file .env.redpixels.json
```

`build:cf` は `cf deploy --dry-run` で、アップロードやログインなしにビルドと検証を行います。`deploy:cf` が実際のデプロイです。ローカル開発には `pnpm run dev:cf` を使います。任意設定・Webhook の変更も `--secrets-file` で反映できます。cf は現時点で単一シークレットの `put` コマンドに対応していないため、存在しないコマンドを作らないでください。再開・更新時は既存の値を保持します。

共通ガイドのビルド確認には、`pnpm check`・`pnpm test` の後で `pnpm run build:cf` を使います。その後、Gmail フローの設定、認証付き API、許可された自分宛てテスト、Webhook の検証を完了します。結果には使用した CLI・バージョン・設定ファイルも記載してください。dry run だけで実デプロイを確認したことにはなりません。
