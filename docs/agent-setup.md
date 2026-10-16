# Set up redpixels with your agent

**English** | [日本語](agent-setup.ja.md) · [README](../README.md)

This guide is for an agent asked to deploy redpixels and connect an existing Gmail drafting workflow. Follow the user's request and your host's account-access and approval rules. This document does not itself authorize account access or sending mail.

Use the CLI selected in the user's prompt: [cf setup](agent-setup-cf.md) or [Wrangler setup](agent-setup-wrangler.md). Both configuration files are included. For a new installation without a preference, offer cf (currently beta); preserve an existing installation's CLI unless the user chooses to switch. Do not silently change CLIs or run a migration.

The default self-hosted Gmail path is the [local raw-MIME CLI](gmail-cli.md), with a Google Cloud Desktop OAuth client owned by the user. Follow the [Gmail agent setup instructions](agent-setup-gmail.md) to carry out the configuration and handle the user's login/consent handoffs. Use a dedicated project when no suitable one exists; do not link billing or enable unrelated Google Cloud products. A compatible existing Gmail connection is an optional shortcut when the user prefers it. The setup includes one clearly labeled self-test draft; a human reviews and presses Send. The CLI has no send command.

## What a working setup includes

- A Worker and SQLite Durable Object in the user's own Cloudflare account, with an authenticated history API.
- A persistent integration that adds a new pixel to HTML Gmail drafts created by the agent.
- A verified test, with observed image fetches distinguished from human reading.
- Signed webhook delivery when a receiver is configured; otherwise explicitly report **history enabled, webhooks disabled**.

redpixels is an API-based tool. Deploying it does not change Gmail or automatically track messages composed without its pixel. Gmail authorization belongs to the drafting agent or local client, not the Worker.

## 1. Inspect the environment and choose the target

1. Read the current [README](../README.md), `package.json`, and the selected CLI's configuration. Clone `https://github.com/arkorlab/redpixels.git` if needed; preserve an existing checkout and unrelated changes.
2. Check the required Node.js and pnpm versions, then run `pnpm install --frozen-lockfile`. Use the project's pinned CLI; cf requires Node.js 22.18+ and does not support Bun.
3. Reuse the selected CLI's existing credentials when suitable. cf and Wrangler do not share OAuth sign-ins. Verify the authenticated identity and target account. Ask for an account choice if several are available. Inspect an existing Worker named `redpixels` before changing it; resolve an unrelated name collision with the user.
4. Follow the selected CLI guide's official authentication flow if access is missing. Both guides cover a device flow when localhost callbacks are unavailable. Keep the active login process running while the user approves. Request access appropriate to Worker deployment, and follow the host's permission requirements.
5. Inspect the local Gmail CLI's saved credential state without printing secrets. Follow the [Gmail agent setup instructions](agent-setup-gmail.md) for the user's Google Cloud project, Gmail API, Desktop client, private download, and OS-keychain login. Reuse verified existing configuration and do not change an unrelated application's shared Branding/Audience. Keep deployment work moving while a personal login, terms review, or permission grant awaits the user. If the user prefers an existing Gmail connector, use the [connector guide](gmail-connectors.md) to verify its actual saved raw MIME image; an `htmlBody` field alone does not establish compatibility. Never extract private connector tokens or request tokens/passwords in chat.

## 2. Deploy and store configuration

Generate a cryptographically random `API_TOKEN` of at least 32 characters, such as 32 random bytes encoded as hex. Reuse an existing installation's secret when resuming setup. Store secrets in the user's supported secret store or a protected, Git-ignored local file; report its location, not its values.

`cloudflare.config.ts` declares the SQLite Durable Object export for cf; `wrangler.toml` declares the corresponding migration for Wrangler. Neither needs a manual database ID. No personal account ID or domain needs to be committed. Keep personal settings in environment bindings. Use the user's current Cloudflare plan; [SQLite-backed Durable Objects are available on Workers Free and Paid](https://developers.cloudflare.com/durable-objects/platform/pricing/), subject to their limits.

Both pinned CLIs support uploading a protected secrets file with deployment. Run **one** path:

```sh
# cf
pnpm run deploy:cf --secrets-file .env.redpixels.json
# Or Wrangler
pnpm run deploy:wrangler --secrets-file .env.redpixels.json
```

Here `.env.redpixels.json` is a file **you create securely**, containing Worker settings such as `API_TOKEN` and optional webhook settings. For a new installation, `node --experimental-strip-types examples/create-secrets.mts` generates a key without printing it, creates the file with mode 0600, and refuses to overwrite an existing file. Confirm it is ignored by Git. It must not contain Cloudflare API or Gmail credentials. See the selected CLI guide for updating secrets. Avoid printing secret values or passing them as command-line arguments.

Save `REDPIXELS_URL` and `REDPIXELS_API_TOKEN` in the drafting agent's secret configuration. The latter is the same secret as the Worker's `API_TOKEN`. Keep the Worker secrets file separate from Gmail credentials and local-only agent settings.

Verify that `/` identifies redpixels, unauthenticated `/v1/messages` returns `401`, and the authenticated request returns `200`.

## 3. Connect the agent's Gmail draft workflow

Use the [local raw-MIME CLI](gmail-cli.md) as the supported self-hosted path. The [Gmail setup recipe for agents](agent-setup-gmail.md) covers prerequisites, personal versus Workspace audiences, Desktop OAuth, private credentials, retries, current Google costs, and manual acceptance. The CLI performs registration, image insertion, raw-MIME creation, and saved-draft verification; do not register another pixel outside it.

Persist this behavior in the user's drafting workflow or agent-supported instructions, with secret references:

```text
When creating a tracked Gmail draft:
1. Use redpixels' local Gmail CLI with its existing private credential
   store and configured REDPIXELS_URL/API token secret reference.
2. Save the intended HTML to a UTF-8 file and choose a stable --operation
   unique to this logical email. Run:
   pnpm --silent gmail draft --to RECIPIENT --subject SUBJECT \
     --html HTML_FILE --operation OPERATION
3. Require state:"verified" and retain the account, tracking_id,
   gmail_draft_id, gmail_message_id, pixel_verified_at, and armed result.
   Do not fetch the pixel as a preservation check. On an uncertain
   creation result, inspect the journal and existing Gmail draft before
   retrying; use verify --operation OPERATION --draft-id EXISTING_ID
   for a known existing draft rather than creating another blindly.
4. Let the human review and press Send in Gmail. After a saved edit,
   run pnpm --silent gmail verify --operation OPERATION before sending.
5. Once the human confirms Send, run:
   pnpm --silent gmail arm --operation OPERATION --confirm-sent
   The CLI does not inspect Sent mail. If no confirmation is available,
   leave it unarmed and report that the arming step is pending.
6. Reuse the operation only for retries of identical input; use a fresh
   operation and pixel for a different email or recipient.
```

A compatible existing Gmail connection is an optional shortcut, not a prerequisite for self-hosting. Follow the [connector guide](gmail-connectors.md) when the user chooses it. Require a raw MIME or MIME byte path and actual saved-source verification. For example, one tested connector accepted `mime_type:"text/html"` with `body.base64_url_content`; this does not establish compatibility for other connectors or `htmlBody` fields. Keep a stable registration idempotency key, preserve the exact image and Gmail identifiers, and fail closed if the saved image cannot be verified. A connector's private credentials must not be extracted for the CLI. The [low-level MIME example](../examples/gmail-draft.mts) remains available for custom integrations; it does not manage refresh tokens or verify saved drafts.

Use separate messages/pixels when per-recipient tracking matters. Gmail draft IDs are stable, but underlying message IDs change when a draft is replaced. redpixels registration idempotency does not make Gmail draft creation or sending idempotent: investigate uncertain outcomes before retrying.

Record the exact persistent integration path or setting. Environment variables alone do not modify an agent's future drafting behavior. If this environment cannot persist a workflow, provide the above instructions and clearly report **manual integration required**.

**Current UX limits remain:** emails composed directly in Gmail are not automatically tracked; the pixel must be inserted by this CLI or another integration. Drafts default to unarmed and need manual post-send arming. The existing HTTP API and low-level example retain immediate tracking by default; CLI `--armed` explicitly chooses immediate tracking, accepting possible draft/Sent owner-preview notifications. Pre-arm fetches remain in history, arming can miss a fast recipient fetch, and it cannot undo proxy caching. Explain these tradeoffs rather than claiming Google Cloud setup solves them. Do not silently add a Gmail Sent-folder watcher or scheduled job. A future Managed connection flow is not part of this shipped setup.

## 4. Configure webhooks when a receiver is provided

Configure `WEBHOOK_URL` and a separate random `WEBHOOK_SECRET` of at least 32 characters. Use the user's requested `WEBHOOK_MODE` (`first` or `every`) and `WEBHOOK_FILTER` (`all` or `unflagged`); otherwise retain the documented defaults.

The HTTPS receiver must accept redpixels' JSON payload and verify its raw-body HMAC, timestamp, and event ID. The [signature verifier](../examples/verify-webhook.mts) is reusable. An arbitrary notification-service URL may need an adapter for its payload format. Use a receiver the user controls.

If no receiver is available, finish history tracking and explain how to add webhooks later. Do not report notifications as configured or received without evidence.

## 5. Verify and report

1. Run `pnpm check`, `pnpm test`, and the selected CLI's build dry run (`pnpm run build:cf` or `pnpm run build:wrangler`). These do not send email and do not establish live Gmail compatibility. Maintainers can build both and run `pnpm run check:cli-builds` to compare the generated runtime and storage configuration.
2. Register a clearly labeled synthetic test. Fetch its public pixel without the API Authorization header or owner cookie, then inspect the authenticated history. HEAD alone does not create an event. Label this a synthetic fetch, not a read. If notifications are enabled, inspect eligibility and confirm signed receiver acceptance; filters can legitimately suppress a test event.
3. Create a fresh, clearly labeled setup draft with the local CLI, or the user's selected compatible connector, and verify its saved raw MIME image. The CLI draft operation performs a live token refresh and profile check; `auth status` alone does not. Use the authenticated address for a self-test draft unless the user specifies another test recipient. Let the human review and press Send, then arm after their confirmation. A separate recipient account is preferable for a controlled recipient-open trial. Sending acceptance is not proof of inbox delivery.
4. Record the fetch/webhook baseline, then ask the user to open the received message. Compare the new event IDs, timestamps, counts, flags, and delivery status. Verify the signature at the receiver when available. Inspect received MIME where existing access permits it, or mark that check unverified.
5. For Web/iOS acceptance, use fresh messages for each recipient app and follow the [CLI manual test](gmail-cli.md#manual-acceptance-test), or the [connector test steps](gmail-connectors.md) when that shortcut was selected. The connector MIME byte path was verified in an unsent draft on 2026-10-16; the separate CLI live trial and earlier [real-device test record](mobile-test.md) used other drafting paths. Do not present them as proof of this new connector path's sending or mobile behavior. State which path, device, and app were actually tested. A synthetic request or unit test is not a mobile test.

Return a concise status report containing the selected Cloudflare CLI/version/configuration, Worker URL and account/name, secret configuration location, Gmail sender and credential-store type, persistent drafting integration location, test message IDs/results, webhook status, and any missing access. Never include secret values. Report native Gmail composition and manual arming as current limitations, and distinguish future Managed plans from shipped features.

Explain the accuracy limits: draft previews and background requests can notify before recipient viewing; even an empty flags list does not prove reading. Proxies can hide identity and repeat opens. A valid signature authenticates a notification, not a human reader. Report each setup step as verified, pending, or unavailable rather than claiming everything is ready after deployment alone.
