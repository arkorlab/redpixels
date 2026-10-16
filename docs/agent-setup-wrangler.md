# Set up redpixels with Wrangler

**English** | [日本語](agent-setup-wrangler.ja.md) · [cf setup](agent-setup-cf.md)

Use this procedure when the user selects **Wrangler**. Also follow the [common agent setup guide](agent-setup.md) for authorization, secure configuration, persistent Gmail draft integration, and verification. This document alone does not authorize sending email.

## Install and sign in

1. Read the checkout's README, `package.json`, and `wrangler.toml`. Use the documented Node.js version and pnpm 10, then run `pnpm install --frozen-lockfile`. Use the project's pinned Wrangler.
2. Confirm `pnpm exec wrangler --version` and `pnpm exec wrangler whoami`. Reuse existing Wrangler credentials or an appropriately scoped `CLOUDFLARE_API_TOKEN`, verify the identity/account, and follow the host's access rules. cf credentials are separate and do not establish a Wrangler login.
3. When sign-in is needed, run `pnpm exec wrangler login`. Inspect `login --help`; if localhost callbacks are unavailable, the pinned CLI supports `pnpm exec wrangler login --device`. Keep the login process alive while the user approves.
4. Verify the target account and inspect an existing Worker before changing it. Keep personal account IDs in local environment settings, not committed source.

## Build and deploy

Wrangler uses **`wrangler.toml`**. The named scripts pass `--config wrangler.toml` explicitly; do the same for direct deployment and secret commands. `cloudflare.config.ts` and `wrangler.config.ts` are for the cf path and need no migration or deletion.

Create the protected, Git-ignored `.env.redpixels.json` described in the common guide, with `API_TOKEN` and optional webhook settings, then run:

```sh
pnpm run build:wrangler
pnpm run deploy:wrangler --secrets-file .env.redpixels.json
```

For individual settings, the existing interactive workflow remains available:

```sh
pnpm exec wrangler secret put API_TOKEN --config wrangler.toml
```

This secret command changes the deployed Worker. Do not expose values in command arguments or chat. Preserve existing values when resuming setup. For local development, use `pnpm run dev:wrangler`.

The existing `pnpm dev`, `pnpm run deploy`, and `pnpm build` commands remain Wrangler aliases. Keep the Worker name, entrypoint, compatibility date, binding, and SQLite class consistent with `cloudflare.config.ts` when maintaining both paths. Preserve existing namespace/history when updating an installation.

For the common guide's build check, use `pnpm run build:wrangler` after `pnpm check` and `pnpm test`. Then complete the common guide's Gmail workflow, authenticated API checks, authorized self-test, and webhook verification. Report the selected CLI/version and configuration alongside the results. A dry run alone is not live deployment evidence.
