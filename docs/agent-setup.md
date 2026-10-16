# Set up redpixels with your agent

**English** | [日本語](agent-setup.ja.md) · [README](../README.md)

This guide is for an agent asked to deploy redpixels and connect an existing Gmail drafting workflow. Follow the user's request and your host's account-access and approval rules. This document does not itself authorize account access or sending mail.

The copyable prompt in the README authorizes one clearly labeled test email to the authenticated Gmail user's own address. All other sending follows the user's existing review/send workflow.

## What a working setup includes

- A Worker and SQLite Durable Object in the user's own Cloudflare account, with an authenticated history API.
- A persistent integration that adds a new pixel to HTML Gmail drafts created by the agent.
- A verified test, with observed image fetches distinguished from human reading.
- Signed webhook delivery when a receiver is configured; otherwise explicitly report **history enabled, webhooks disabled**.

redpixels is an API-based tool. Deploying it does not change Gmail or automatically track messages composed without its pixel. Gmail authorization belongs to the drafting agent or local client, not the Worker.

## 1. Inspect the environment and choose the target

1. Read the current [README](../README.md), `package.json`, and `wrangler.toml`. Clone `https://github.com/arkorlab/redpixels.git` if needed; preserve an existing checkout and unrelated changes.
2. Check the required Node.js and pnpm versions, then run `pnpm install --frozen-lockfile`. Use the project's pinned Wrangler, not an unrelated global version.
3. Reuse an existing Cloudflare sign-in or connected MCP when suitable. Verify the authenticated identity and target account. Ask for an account choice if several are available. Inspect an existing Worker named `redpixels` before changing it; resolve an unrelated name collision with the user.
4. Use an official authentication flow if access is missing. Consult `pnpm exec wrangler login --help`; if localhost callbacks are unavailable and the installed CLI supports it, use `pnpm exec wrangler login --device`. Keep the active login process running while the user approves. Request access appropriate to Worker deployment, and follow the host's permission requirements.
5. Check whether the agent can create HTML Gmail drafts through its existing Gmail tools or API authorization. If not connected, use your host's supported Gmail connection flow and ask the user to complete its sign-in/consent, then resume integration. For direct API clients, Google's [scope guide](https://developers.google.com/workspace/gmail/api/auth/scopes) documents `gmail.compose` for managing drafts and sending. Never request tokens or passwords in chat. If the environment has no supported connection method or required access remains unavailable, complete independent deployment work and clearly report Gmail integration as pending.

## 2. Deploy and store configuration

Generate a cryptographically random `API_TOKEN` of at least 32 characters, such as 32 random bytes encoded as hex. Reuse an existing installation's secret when resuming setup. Store secrets in the user's supported secret store or a protected, Git-ignored local file; report its location, not its values.

The existing `wrangler.toml` creates the SQLite namespace through its migration. No personal account ID, database ID, or domain needs to be committed. Keep personal settings in environment bindings. Use the user's current Cloudflare plan; [SQLite-backed Durable Objects are available on Workers Free and Paid](https://developers.cloudflare.com/durable-objects/platform/pricing/), subject to their limits.

The pinned CLI supports [uploading secrets with deployment](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code):

```sh
pnpm exec wrangler deploy --secrets-file .env.redpixels.json
```

Here `.env.redpixels.json` is a file **you create securely**, containing Worker settings such as `API_TOKEN` and optional webhook settings. Confirm it is ignored by Git and restrict file permissions. It must not contain Gmail credentials. Alternatively, use the documented Wrangler secret commands or a capable connected Cloudflare tool. Avoid printing secret values or passing them as command-line arguments.

Save `REDPIXELS_URL` and `REDPIXELS_API_TOKEN` in the drafting agent's secret configuration. The latter is the same secret as the Worker's `API_TOKEN`. Keep the Worker secrets file separate from Gmail credentials and local-only agent settings.

Verify that `/` identifies redpixels, unauthenticated `/v1/messages` returns `401`, and the authenticated request returns `200`.

## 3. Connect the agent's Gmail draft workflow

Prefer the agent's existing HTML-capable Gmail tools. With a direct API client, use [Google's MIME draft procedure](https://developers.google.com/workspace/gmail/api/guides/drafts) and the working [Node example](../examples/gmail-draft.mts). A starter HTML body is included at [examples/email.html](../examples/email.html).

Persist the following behavior in the user's existing drafting workflow or agent-supported instructions, using secret references instead of embedding keys:

```text
When creating an HTML Gmail draft:
1. Read REDPIXELS_URL and REDPIXELS_API_TOKEN from the configured secret store.
2. POST /v1/messages with recipient and subject. Use a new Idempotency-Key
   for each logical email, and reuse that key only for retries of the same body.
3. Insert the returned pixel_html into the draft's HTML body as a remote image.
4. Preserve that pixel when updating the draft. Keep a mapping of the redpixels
   message ID and Gmail draft ID, and return those IDs to the user.
5. Follow the user's existing draft-review and sending instructions.
```

Use separate messages/pixels when per-recipient tracking matters. Gmail draft IDs are stable, but underlying message IDs change when a draft is replaced. redpixels registration idempotency does not make Gmail draft creation or sending idempotent: investigate uncertain outcomes before retrying.

Record the exact persistent integration path or setting. Environment variables alone do not modify an agent's future drafting behavior. If this environment cannot persist a workflow, provide the above instructions and clearly report **manual integration required**.

Keep the default immediate tracking behavior unless the user chooses otherwise. Optional `armed:false` followed by post-send arming can suppress draft notifications, but can miss a fast recipient fetch and cannot undo proxy caching. Do not silently add a Gmail Sent-folder watcher or scheduled job.

## 4. Configure webhooks when a receiver is provided

Configure `WEBHOOK_URL` and a separate random `WEBHOOK_SECRET` of at least 32 characters. Use the user's requested `WEBHOOK_MODE` (`first` or `every`) and `WEBHOOK_FILTER` (`all` or `unflagged`); otherwise retain the documented defaults.

The HTTPS receiver must accept redpixels' JSON payload and verify its raw-body HMAC, timestamp, and event ID. The [signature verifier](../examples/verify-webhook.mts) is reusable. An arbitrary notification-service URL may need an adapter for its payload format. Use a receiver the user controls.

If no receiver is available, finish history tracking and explain how to add webhooks later. Do not report notifications as configured or received without evidence.

## 5. Verify and report

1. Run `pnpm check`, `pnpm test`, and `pnpm build`. These do not send email and do not establish live Gmail compatibility.
2. Register a clearly labeled synthetic test. Fetch its public pixel without the API Authorization header or owner cookie, then inspect the authenticated history. HEAD alone does not create an event. Label this a synthetic fetch, not a read. If notifications are enabled, inspect eligibility and confirm signed receiver acceptance; filters can legitimately suppress a test event.
3. Create a fresh, clearly labeled Gmail setup test with the integrated workflow. Confirm its HTML contains the returned image. Send exactly one self-addressed test only when the user authorized it, as in the README prompt; otherwise leave a draft. Verify the authenticated Gmail address rather than guessing it. Sending acceptance is not proof of inbox delivery.
4. Record the fetch/webhook baseline, then ask the user to open the received message. Compare the new event IDs, timestamps, counts, flags, and delivery status. Verify the signature at the receiver when available. Inspect received MIME where existing access permits it, or mark that check unverified.
5. For mobile compatibility, use the [real-device test record](mobile-test.md). State which device/app was actually tested. A synthetic request or unit test is not a mobile test.

Return a concise status report containing the Worker URL and account/name, secret configuration location, persistent drafting integration location, test message IDs/results, webhook status, and any missing access. Never include secret values.

Explain the accuracy limits: draft previews and background requests can notify before recipient viewing; even an empty flags list does not prove reading. Proxies can hide identity and repeat opens. A valid signature authenticates a notification, not a human reader. Report each setup step as verified, pending, or unavailable rather than claiming everything is ready after deployment alone.
