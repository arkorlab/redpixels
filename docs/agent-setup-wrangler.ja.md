# Wrangler で redpixels をセットアップする

[English](agent-setup-wrangler.md) | **日本語** · [cf の手順](agent-setup-cf.ja.md)

ユーザーが **Wrangler** を選んだ場合の手順です。承認、秘密の設定、Gmail 下書きフローへの永続的な組み込み、動作確認は[共通ガイド](agent-setup.ja.md)にも従ってください。この文書だけでメール送信が許可されるわけではありません。

## インストールとログイン

1. 手元の README、`package.json`、`wrangler.toml` を読みます。記載された Node.js と pnpm 10 で `pnpm install --frozen-lockfile` を実行し、固定版の Wrangler を使います。
2. `pnpm exec wrangler --version` と `pnpm exec wrangler whoami` を確認します。既存の Wrangler 認証か適切な権限の `CLOUDFLARE_API_TOKEN` を利用し、ユーザー・アカウントと実行環境のアクセスルールを確認します。cf の認証は別管理で、Wrangler へのログイン確認にはなりません。
3. 認証が必要なら `pnpm exec wrangler login` を実行します。`login --help` を確認し、localhost のコールバックが使えない場合は、固定版が対応する `pnpm exec wrangler login --device` を使います。ユーザーが許可する間は処理を動かしたままにしてください。
4. 対象アカウントを確認し、既存の Worker を変更する前に内容を調べます。個人のアカウント ID は手元の環境設定に置き、ソースへコミットしません。

## ビルドとデプロイ

Wrangler は **`wrangler.toml`** を使います。専用スクリプトは `--config wrangler.toml` を明示します。直接のデプロイやシークレット操作でも同じ指定を使ってください。`cloudflare.config.ts` と `wrangler.config.ts` は cf 用であり、移行や削除は不要です。

共通ガイドのとおり、`API_TOKEN` と必要な Webhook 設定を含む、保護された Git 除外対象の `.env.redpixels.json` を作成し、実行します。

```sh
pnpm run build:wrangler
pnpm run deploy:wrangler --secrets-file .env.redpixels.json
```

個別の値を設定する従来の対話形式も使えます。

```sh
pnpm exec wrangler secret put API_TOKEN --config wrangler.toml
```

この操作はデプロイ済み Worker を変更します。秘密の値をコマンド引数やチャットに出さないでください。再開時は既存の値を維持します。ローカル開発には `pnpm run dev:wrangler` を使います。

既存の `pnpm dev`、`pnpm run deploy`、`pnpm build` は Wrangler の別名として維持します。両方の経路を保守する場合は、Worker 名・エントリーポイント・互換日付・バインディング・SQLite クラスを `cloudflare.config.ts` と揃えます。既存の名前空間や履歴は維持してください。

共通ガイドのビルド確認には、`pnpm check`・`pnpm test` の後で `pnpm run build:wrangler` を使います。その後、Gmail フローの設定、認証付き API、許可された自分宛てテスト、Webhook の検証を完了します。結果には使用した CLI・バージョン・設定ファイルも記載してください。dry run だけで実デプロイを確認したことにはなりません。
