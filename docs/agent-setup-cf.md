# Set up redpixels with cf

**English** | [日本語](agent-setup-cf.ja.md) · [Wrangler setup](agent-setup-wrangler.md)

Use this procedure when the user selects Cloudflare's **cf CLI**. Also follow the [common agent setup guide](agent-setup.md) for authorization, secure configuration, persistent Gmail draft integration, and verification. This document alone does not authorize sending email.

## Install and sign in

1. Read the checkout's README and configuration. Use Node.js **22.18+** or 24 LTS and pnpm 10, then run `pnpm install --frozen-lockfile`. The repository pins `cf`; no global installation is required. `pnpm exec cloudflare` is the equivalent binary if another tool uses the name `cf`.
2. Confirm `pnpm exec cf --version` and `pnpm exec cf auth whoami`. cf has its own credentials and does **not** reuse a Wrangler login. Reuse existing cf credentials or an appropriately scoped `CLOUDFLARE_API_TOKEN`, verify the identity/account, and follow the host's access rules.
3. When sign-in is needed, run `pnpm exec cf auth login`. If a browser cannot open locally, use `pnpm exec cf auth login --no-browser` and let the user approve the printed link/code. Keep the process alive. This device flow does not need a localhost callback.
4. Use the verified target account. With several accounts, ask the user to choose and set `CLOUDFLARE_ACCOUNT_ID` locally if needed; never commit a personal account ID. Inspect an existing Worker before changing it.

cf and its TypeScript configuration are currently **beta**. Commands are checked against the pinned version; consult [official cf documentation](https://developers.cloudflare.com/cf/get-started/) when upgrading. Find commands with `cf cli search` using only an anonymous action/resource description, then inspect their help.

## Build and deploy

This checkout already includes `cloudflare.config.ts` and `wrangler.config.ts`. Do **not** run `cf init` or `cf migrate`: no generated configuration or manual Durable Object conversion is needed. cf uses the pinned Wrangler as its bundler; that does not require a Wrangler login.

The cf configuration declares the same `redpixels` Worker, `src/index.ts` entrypoint, compatibility date, `TRACKER` binding, and SQLite `Tracker` export as `wrangler.toml`. Its export lifecycle declaration replaces Wrangler's `v1` creation migration. Keep these identities consistent. For an existing deployment, preserve its actual name/class/storage and history; do not recreate or delete the namespace. Changing a personal Worker name requires updating both `worker.name` and the binding's `worker` reference in the cf configuration, plus the Wrangler name if that path is used.

Create the protected, Git-ignored `.env.redpixels.json` described in the common guide. Include `API_TOKEN` and any optional webhook settings. Do not include Cloudflare API credentials or Gmail credentials in this Worker secrets file.

```sh
pnpm run build:cf
pnpm run deploy:cf --secrets-file .env.redpixels.json
```

`build:cf` is `cf deploy --dry-run`: it builds and validates without uploading or requiring login. `deploy:cf` performs the real deployment. For local development, use `pnpm run dev:cf`. Upload optional settings and webhook changes with `--secrets-file` as well. cf currently has no single-secret `put` command; do not invent one. Keep the existing secret values when resuming or updating.

For the common guide's build check, use `pnpm run build:cf` after `pnpm check` and `pnpm test`. Then complete the common guide's Gmail workflow, authenticated API checks, authorized self-test, and webhook verification. Report the selected CLI/version and configuration alongside the results. A dry run alone is not live deployment evidence.
