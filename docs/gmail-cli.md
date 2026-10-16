# Gmail raw MIME draft CLI

**English** | [日本語](gmail-cli.ja.md) · [README](../README.md)

**Optional advanced integration.** Start with your [existing Gmail connection](gmail-connectors.md). This direct CLI requires your own Google Cloud OAuth client and is a fallback when a compatible hosted connector is unavailable or you explicitly want independent credentials.

`pnpm gmail draft` registers a message, inserts its pixel, builds RFC 2822 / MIME, calls Gmail `users.drafts.create` with **`message.raw`**, and reads back the saved HTML MIME part to verify the image—all in one command. **It creates drafts and never sends email.** A human reviews the draft and presses Send in Gmail.

Some connectors remove `<img>` from an `htmlBody` parameter. Giving HTML to a connector does not establish pixel preservation. This CLI calls Gmail directly and checks the stored draft; it never fetches the pixel itself. Later editing/sending in Gmail is a separate preservation check.

## Decisions

- **A TypeScript CLI in this repository.** No changes to the Worker, API or SQL schema. Gmail credentials stay on the user's machine. No public mail endpoint, separate MCP server, authentication server or session database. Agents can consume JSON output.
- **Google's official `google-auth-library`.** It generates PKCE/authorization URLs and handles token exchange/refresh. The CLI implements the loopback listener and state validation. There is no application login/session layer to manage.
- **Bring your own Desktop OAuth client.** Each self-hosting user controls their Google Cloud project. No shared OAuth client, service account or domain-wide delegation.
- **Draft-only behavior.** Google's `gmail.compose` restricted scope also grants send access; the CLI's lack of a send command does not reduce the token's actual permissions. No additional inbox-reading scope is requested.
- **Manual post-send arming.** Drafts default to `armed:false` to suppress draft-time notifications. The user confirms sending before arming. No Sent-folder watcher or scheduled task.

The Desktop client is for this local CLI, even when the resulting draft is sent from Gmail Web or mobile. A future managed Web integration would use a separate Web OAuth client and server-side token storage. Managed users would click Connect Google rather than create their own client. That hosted integration is outside this OSS release; see the [architecture notes](architecture.md#future-hosted-edition) and [Google's client types](https://developers.google.com/workspace/guides/create-credentials).

## 1. Create a Google Desktop OAuth client

1. Select or create a project you control in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) in that project.
3. Configure Branding / Audience in [Google Auth Platform](https://console.cloud.google.com/auth/overview), including the app's name, support email and contact email. For External / Testing, add the sending Google account to Test users. Choose Internal only for use within your Workspace organization.
4. Add `https://www.googleapis.com/auth/gmail.compose` under Data Access.
5. Open [Clients](https://console.cloud.google.com/auth/clients), create a **Desktop app** client, and download its JSON. A Web application client is not supported here.
6. Store it outside the checkout. On macOS/Linux, run `chmod 600 /absolute/path/client_secret.json`. Never paste its contents in chat, commit it, or upload it to the Worker.

See [Google's Desktop OAuth procedure](https://developers.google.com/identity/protocols/oauth2/native-app) and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes). `gmail.compose` is restricted and may require organization-admin approval. Distinguish Google's [verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#exceptions-verification-requirements) for personal/internal use from requirements for public apps. redpixels does not supply a shared, verified OAuth application.

External / Testing refresh tokens usually [expire after seven days](https://developers.google.com/identity/protocols/oauth2#expiration). Choose audience/publishing settings appropriate to your use and Google's requirements; switching to Production does not itself verify an app. Revocation, policy changes or password changes can also require login again.

## 2. Sign in once

Use Node.js 22.18+ or 24 LTS and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm gmail auth login --client /absolute/path/client_secret.json
pnpm gmail auth status
```

Choose the sending account in the browser and review consent. Gmail `users.getProfile` establishes the authenticated address used as From. Arbitrary From addresses/aliases are outside this CLI's scope. Results are JSON and never include secret values; use `pnpm --silent gmail ...` when an agent needs only JSON without pnpm's script banner.

The default token store is macOS Keychain / Windows Credential Manager / Linux Secret Service, under service `redpixels.gmail`, with an account identifier derived from the state-directory path. It stores the refresh token and client information; access tokens remain in memory. A locked or unavailable keychain never silently falls back to plaintext.

For headless machines without Secret Service, explicitly opt into a file:

```sh
export REDPIXELS_GMAIL_TOKEN_STORE=file
export REDPIXELS_GMAIL_HOME=/absolute/private/path/redpixels-gmail
pnpm gmail auth login --client /absolute/path/client_secret.json --no-browser
```

The file backend is **unencrypted**, with a 0700 state directory and 0600 `credentials.json`. On Windows, Unix modes are not a substitute for ACLs; prefer the default OS store. Keep state outside Git, shared folders and synced workspaces. Persist the selected environment settings in the agent's runtime too.

The OAuth callback listens on an available `127.0.0.1` port. `--no-browser` prints a link but still needs loopback reachability. For SSH, forward a port, for example `ssh -L 8765:127.0.0.1:8765 user@host`, and run login remotely with `--port 8765 --no-browser`. Deprecated OOB code-pasting and device-code authentication that cannot grant Gmail scopes are not used.

## 3. Create a draft in one command

Configure your existing Worker URL. Supply its token through the agent's secret manager as `REDPIXELS_API_TOKEN`, or use a protected JSON file containing `API_TOKEN`:

```sh
export REDPIXELS_URL='https://redpixels.<your-subdomain>.workers.dev'
export REDPIXELS_SECRETS_FILE='/absolute/path/.env.redpixels.json'

pnpm --silent gmail draft \
  --to recipient@example.com \
  --subject 'Hello' \
  --html examples/email.html \
  --operation hello-001
```

`REDPIXELS_SECRETS_FILE` defaults to `.env.redpixels.json` in the current directory. It supplies the Worker's `API_TOKEN`; do not put Google credentials in it. Input is a UTF-8 HTML file. Add `--text email.txt` for the plain-text alternative. This version accepts one bare recipient address, without display names/lists, attachments, or reply threads. HTML and text inputs are each limited to 2 MiB.

Success returns `operation`, `account`, `tracking_id`, `gmail_draft_id`, `gmail_message_id`, `state:"verified"`, `pixel_verified_at`, and `armed`. Missing images fail with exit code 1. The verification timestamp proves the saved draft at that time, not later edits. After editing, save/close Gmail and verify again before sending:

```sh
pnpm --silent gmail verify --operation hello-001
```

Review and **press Send in Gmail**, then arm:

```sh
pnpm --silent gmail arm --operation hello-001 --confirm-sent
```

`--confirm-sent` is the user's/agent's assertion; the CLI has not inspected Sent mail. Arming can miss an immediate recipient fetch, so arm before the controlled recipient-viewing step. Add `--armed` when creating a draft to choose immediate tracking instead, including possible draft-preview notifications.

## Retries and recovery

Choose a new `--operation` for each logical email, and reuse it only for retries of identical input. Changed recipient, subject, body, account, Worker or initial arming setting is rejected for the same ID. Journals contain hashes and draft/tracking identifiers, not message bodies or tokens.

Completed operations return their existing result. A timeout or 5xx can leave Gmail creation ambiguous; the CLI does not blindly repeat that POST:

```sh
pnpm --silent gmail status --operation hello-001
# After inspecting Gmail/API and finding the actual existing draft ID:
pnpm --silent gmail verify --operation hello-001 --draft-id EXISTING_DRAFT_ID
```

Draft IDs differ from their underlying message IDs. Draft disappearance after sending is normal. This CLI does not retrieve inbox or Sent MIME. After a process crash, inspect the operation's JSON journal and Gmail, and confirm the process stopped before removing that operation's stale `.lock`. Do not delete journals and recreate drafts blindly.

```sh
pnpm gmail auth logout
# Also revoke the Google grant (can affect other clients in the same project):
pnpm gmail auth logout --revoke
```

## Owner views and Gmail proxy limits

- Pre-arm fetches are retained with `before_armed` and included in `open_count`, preserving the API's audit history. They do not notify or increase `eligible_open_count`. Arming does not delete owner fetches.
- Gmail's image proxy does not carry the sender's cookies, API Authorization header or actual IP. Owner-cookie/IP signals help direct requests; they cannot reliably identify Gmail draft/Sent views.
- **An unarmed response can still fill a proxy cache.** Later arming cannot force another request. Sent-folder views after arming can still notify. Timing/UA heuristics do not establish readership.
- [Google describes](https://support.google.com/mail/answer/145919?hl=en) automatic images, safety checks and cookie restrictions. A new request for every Web/iOS view or repeat open is not guaranteed.

## Manual acceptance test

Use **a fresh email, operation ID and pixel for each platform**. Opening one message sequentially in Web and iOS may reuse a cache.

1. Complete OAuth setup and confirm the sender account.
2. Create a fresh draft to a **different Gmail account you can operate**. Retain the JSON's `state:"verified"` and IDs.
3. If editing in Gmail, save/close and run `verify`. Do not send after a missing-image error.
4. Send manually. Where existing access permits, inspect the sender's/recipient's original raw MIME or Gmail's Show original for the image. Draft verification alone is not recipient-MIME verification.
5. Run `arm --confirm-sent`, then capture history counts and the last event before recipient viewing.
6. Open once in the receiving account's Gmail Web. Compare new event IDs, UTC timestamps, flags and delivery status. When configured, check signatures and event IDs at the webhook receiver.
7. Repeat steps 2–6 with a fresh message, this time opening in the receiving account's iOS Gmail app. Record OS/app versions.
8. Test repeat openings separately. No new fetch does not prove unread status or image removal.

Automated CLI tests simulate Gmail/redpixels HTTP boundaries; they do not establish real consent, delivery or mobile viewing. A separate live trial on **2026-10-16** used this new CLI, a deployed tracking Worker and a signature-verifying webhook receiver:

- Desktop OAuth with an Internal Workspace app completed, credentials were saved to macOS Keychain, and separate CLI processes refreshed access and created two raw-MIME drafts. Gmail read-back verified each saved image. Each history started at zero.
- A human sent both drafts to a different Gmail account. During composition/sending, each pixel received one Google image proxy fetch before arming: it remained in history with `before_armed` and produced no notification.
- After manual arming, the tester reported opening the Web test in Gmail Web and the separate iOS test in Gmail for iOS. Each history increased **1 → 2**, each eligible count became **1**, and each new event matched a signature-verified webhook accepted with **HTTP 204**. Recorded request times were **11:24:43.849Z** (Web test) and **11:24:45.841Z** (iOS test).

Device attribution relies on the tester's report; both requests carried Google image proxy evidence, which does not identify the actual device or prove readership. Recipient raw MIME and exact iOS/Gmail versions were not collected for this trial. Windows/Linux credential backends, repeat opens, replies, post-arm owner views and real Apple MPP behavior remain unverified. The earlier [mobile preservation record](mobile-test.md) used a different drafting path.
