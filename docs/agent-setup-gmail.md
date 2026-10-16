# Set up self-hosted Gmail drafting with your agent

**English** | [日本語](agent-setup-gmail.ja.md) · [Gmail CLI](gmail-cli.md) · [Agent setup](agent-setup.md)

Give an agent this guide together with the request below. It covers the supported bring-your-own-client Gmail integration for self-hosted redpixels. Follow the user's actual authorization and the agent host's access rules; reading this document does not authorize account access, accepting terms, granting permissions, or sending email.

```text
Set up redpixels' local Gmail draft CLI using docs/agent-setup-gmail.md.
Use my own Google Cloud project and Desktop OAuth client. Reuse verified
existing configuration where suitable; otherwise use a dedicated redpixels
project. Enable only the Gmail API. Do not link billing, add a payment card,
enable paid products, or request a quota increase.
Keep credentials outside Git and chat, with the OS keychain as the token
store. Guide me through login, terms, or Gmail consent when I need to act.
Create one clearly labeled test draft, verify its saved pixel, and leave
the actual Send action to me. Explain the manual post-send arming step and
the limits of owner-open detection. Report what you verified and what is
still pending. Do not promise automatic tracking of ordinary Gmail compose.
```

For full deployment, also follow the [common setup guide](agent-setup.md) and the user's choice of [cf](agent-setup-cf.md) or [Wrangler](agent-setup-wrangler.md). Gmail OAuth is separate from Cloudflare authentication.

## What this setup provides

- An agent can create a tracked Gmail draft with one CLI command, using Gmail's raw MIME API rather than an HTML-sanitizing connector.
- Each saved draft is read back to check that its image exists. A human then reviews, optionally edits, and sends in Gmail Web or mobile.
- Google refresh tokens remain on the user's machine. The tracking Worker receives no Gmail credentials.

**It does not track every email composed directly in Gmail.** Such a message has no redpixels image unless an integration inserts one. The current CLI also has no automatic send detection: its default unarmed draft needs `arm --confirm-sent` after the user sends. Creating with `--armed` avoids that later step but allows draft/Sent previews to trigger notifications. Google Cloud setup does not solve either limitation.

Users who want to avoid managing Google Cloud can choose a compatible [existing Gmail connection](gmail-connectors.md). A future Managed edition could supply an operator-owned Web OAuth application and a Connect Google flow; it is **not shipped by this OSS setup**, and a shared OAuth application still has Google's review and policy requirements. It would not, by itself, insert pixels into ordinary Gmail composition or make proxy requests identify the sender.

## 1. Inspect before creating anything

1. Read the current CLI guide and run `pnpm --silent gmail --help`. Use Node.js 22.18+ or 24 LTS and pnpm 10, with the repository's pinned dependencies.
2. Identify the intended sending Google account, local runtime machine, and existing redpixels Worker. Ask only for missing choices; do not guess between unrelated accounts or projects.
3. Use the existing `REDPIXELS_GMAIL_HOME` and `REDPIXELS_GMAIL_TOKEN_STORE` settings, if any. Run `pnpm --silent gmail auth status` without printing environment variables or credential files. Its `connected` field means a saved credential exists, **not that Google has accepted a refresh today**.
4. If credentials already exist for the intended account, do not replace them just to repeat setup. The controlled draft below performs a real token refresh and Gmail profile check. If it fails, diagnose the returned safe error before asking for login again.
5. Inspect the signed-in Google Cloud identity and selected project through the authorized browser or documented API. Prefer an existing dedicated redpixels project the user owns. Otherwise create a dedicated project with no billing link. Do not repurpose another application's shared OAuth Branding/Audience or change an organization's security policies.
6. Reuse a Desktop client only after verifying its ownership, project, audience, and suitability. Do not extract a hosted connector's private tokens or client credentials. A connector's authorization does not log the local CLI in.

Do not output secrets through `cat`, a shell environment dump, debug HTTP logs, screenshots of credential dialogs, or chat. Report paths, configured account names, scopes, and client type instead. Inspect Git ignore rules before saving configuration. Do not add real Google project identifiers or downloaded credentials to examples, code, issues, or commits.

## 2. Configure a dedicated Google Cloud project

Keep the selected project visible through each step so settings do not land in the wrong project.

1. In [Google Cloud Console](https://console.cloud.google.com/), select the verified project or create a dedicated redpixels project.
2. Enable **Gmail API** in [API Library](https://console.cloud.google.com/apis/library/gmail.googleapis.com). This CLI does not use Cloud Run, Cloud Functions, App Engine, Secret Manager, Cloud Storage, Pub/Sub, a service account, or domain-wide delegation. Do not enable them for this procedure.
3. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview). Configure **Branding** with the app name and the user's appropriate support/contact email addresses. If Google presents terms requiring the user's agreement, show the exact requirement and let the user review and act. Do not accept unseen terms on the user's behalf.
4. Choose **Audience** based on the intended accounts:
   - **Internal** is for a Workspace organization's own accounts, when the organization offers it. It does not let unrelated personal Gmail accounts authorize the application; it does not restrict the normal recipients of the sender's email.
   - **External** is the applicable choice for a personal Gmail account or accounts outside that organization. While in **Testing**, add the sending Google account to Test users.
5. Under **Data Access**, request only `https://www.googleapis.com/auth/gmail.compose`. This restricted scope permits draft management **and sending**, even though redpixels has no send command. Do not describe it as draft-only permission or add broad inbox access to work around a setup problem. `users.getProfile` accepts this scope and establishes the sender address without adding identity scopes.
6. In [Clients](https://console.cloud.google.com/auth/clients), create a **Desktop app** client. This is correct for a local CLI even when the user later sends the draft from Gmail Web or a phone. A **Web application** client is for a server-hosted callback and is not accepted by this CLI.
7. Download the client JSON to a private local directory outside the checkout and shared/synced folders. On macOS/Linux use `chmod 600 /absolute/private/path/client_secret.json`. The CLI also checks private file ownership and rejects symlinked files. On Windows, use appropriate ACLs; prefer the default credential store for tokens.

Do not link a billing account, add a payment card, request higher quotas, activate a free trial, or provision paid services. If a page unexpectedly makes one of these a prerequisite, stop that step, report the exact requirement, and inspect whether the correct product/project was selected. Continue independent Cloudflare or documentation work where possible.

Google's documentation covers [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), and [personal/internal verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#exceptions-verification-requirements). Personal use can qualify for an exception, but that does not guarantee a warning-free consent screen or override Workspace admin policy. Let the user review an unverified-app warning and Google's choices; do not bypass it automatically or claim verification.

For External apps in Testing, refresh tokens normally [expire after seven days](https://developers.google.com/identity/protocols/oauth2#expiration). Explain that before calling setup persistent. Publishing to Production does not itself complete verification. Do not change publishing status or broaden the app's audience just to hide a warning; choose settings appropriate to the user's actual use and Google's requirements. A public Managed application has separate obligations.

## 3. Authorize the local CLI

The CLI uses Google's official `google-auth-library` with PKCE, OAuth state validation, and a loopback callback. It is not a hosted application login system. Run on the machine whose private credential store should retain the grant:

```sh
pnpm gmail auth login --client /absolute/private/path/client_secret.json
pnpm --silent gmail auth status
```

Keep the login process alive while the browser flow runs. Use the intended sending account. The user handles passwords, passkeys, MFA, organization prompts, terms, and the final Gmail permission grant. After completion, verify the JSON account and token-store names without exposing token values. Do not declare success because a browser says consent was granted if the CLI timed out or failed to save the credential.

The default OS backend is macOS Keychain, Windows Credential Manager, or Linux Secret Service, service `redpixels.gmail`. Access tokens stay in memory; the refresh token and client information are stored in the OS backend. Keep the original client JSON private as well. A locked/unavailable keychain produces an error rather than silently writing plaintext.

If there is no usable OS backend, explain the tradeoff and let the user explicitly select the protected **unencrypted** file backend:

```sh
export REDPIXELS_GMAIL_TOKEN_STORE=file
export REDPIXELS_GMAIL_HOME=/absolute/private/path/redpixels-gmail
pnpm gmail auth login --client /absolute/private/path/client_secret.json --no-browser
```

The POSIX state directory is mode 0700 and `credentials.json` is mode 0600. Persist the selected backend/home in the agent runtime, outside committed files. Do not switch backends on retry without noticing which one holds the credential.

The callback is `127.0.0.1` on the machine running the CLI. `--no-browser` prints the authorization link; it does **not** move the callback to a cloud URL. For SSH, set up a loopback port forward, such as `ssh -L 8765:127.0.0.1:8765 user@host`, and run remotely with `--port 8765 --no-browser`. The browser's local machine and remote listener must be connected by that forward. Do not use deprecated OOB code-pasting or invent a device-code flow for Gmail scopes. If a callback expired, start a fresh login rather than reuse the stale URL.

## 4. Create and verify one controlled draft

Use the existing Worker's protected secret configuration. Keep Google credentials separate:

```sh
export REDPIXELS_URL='https://redpixels.<your-subdomain>.workers.dev'
export REDPIXELS_SECRETS_FILE='/absolute/private/path/.env.redpixels.json'

pnpm --silent gmail draft \
  --to recipient@example.com \
  --subject 'redpixels setup test' \
  --html /absolute/path/test-email.html \
  --operation setup-test-001
```

Use a recipient the user authorized. For the initial self-test, the sender's own account is acceptable; use a different account the tester can operate for the controlled recipient-open trial. The command accepts one bare address. Do not send to arbitrary real recipients or run the same test repeatedly.

Let the CLI perform registration, pixel insertion, raw-MIME draft creation, and saved HTML verification. Do not register another pixel separately. A successful result must contain `state:"verified"`, `tracking_id`, `gmail_draft_id`, `gmail_message_id`, `pixel_verified_at`, and the intended account. The CLI refreshes Google access and checks the authenticated profile, so this is also a live authorization check. Do not fetch the pixel to verify that it is in the draft; that would create a synthetic open.

Keep `--operation` stable for retries of the same email and reuse exactly the same input. The local journal is needed for recovery. A timeout or 5xx may mean Gmail created a draft even though the response was lost. Do not repeat an ambiguous creation or delete the journal to force it:

```sh
pnpm --silent gmail status --operation setup-test-001
# Only after finding the actual existing draft in Gmail/API:
pnpm --silent gmail verify --operation setup-test-001 --draft-id EXISTING_DRAFT_ID
```

`status` reports local saved state; it does not recheck Google or delivery. If no stored source can be verified, report that gap instead of claiming the pixel arrived.

## 5. Human Send, arming, and recipient trial

1. Show the draft subject, recipient, and Gmail draft identifier. The user reviews and presses Send. The CLI deliberately has no send command. If the user edits first, ask them to save/close and run `pnpm --silent gmail verify --operation setup-test-001` before sending.
2. The default is unarmed, which suppresses notifications from pre-arm fetches. After the user confirms Send, run:

   ```sh
   pnpm --silent gmail arm --operation setup-test-001 --confirm-sent
   ```

   This flag records a human assertion; the CLI does not inspect Sent mail. If no send confirmation is available, leave the message unarmed and report the pending step. Do not silently install a watcher or scheduled job.

3. Capture history counts and webhook baseline before the recipient opens the email. Where authorized access permits, inspect received original MIME; otherwise record that recipient-MIME preservation is unverified.
4. Have the receiving account open the email once, then compare event IDs, timestamps, flags, eligible count, and signed webhook acceptance. An image request is not proof a human read the text.
5. For Web and iOS testing, use a **fresh message, operation, and pixel for each app**. Follow the [manual acceptance test](gmail-cli.md#manual-acceptance-test), record app/OS versions where available, and distinguish user-reported device attribution from proxy evidence.

Arming does not erase history: pre-arm fetches remain as `before_armed` and count in `open_count`, but not `eligible_open_count`. They may also fill Gmail's image cache. A recipient fetch before arming can be missed as an eligible open, and a sender's Sent view after arming can still trigger one. `--armed` at draft creation removes manual arming **by accepting immediate tracking and those owner-preview risks**; offer it as an explicit tradeoff, never as reliable sender exclusion. No setting guarantees a fresh proxy fetch on every open.

## Costs and prerequisites to explain

Google Cloud is used to configure API access, not to host this CLI or the Worker. This setup requires no Google billing link or card, and it does not provision GCP compute, Pub/Sub, or storage. Cloudflare limits and any paid plan are a separate decision.

As of **2026-10-16**, [Google's Gmail API quota page](https://developers.google.com/workspace/gmail/api/reference/quota) says standard use remains available at no additional cost and announces over-quota charges planned for later in 2026 with at least 90 days' notice. Full billing details are not yet published there. Do not promise Gmail API access is free forever or that unrelated Google Cloud services are free. Recheck the current page if this guide is older than the setup date.

At current method rates, one successful new draft uses 31 Gmail API quota units (`getProfile` 1 + `drafts.create` 10 + `drafts.get` 20), excluding retries and extra verification. For example, 100 such drafts use 3,100 units. The quota page currently lists an 80,000,000-unit daily billing threshold; quota units are not messages and are not a charge estimate. Ordinary personal drafting is far below that threshold, but this is not a guarantee against costs from other enabled products or future pricing changes.

Most work is one-time browser configuration: project, API, app/audience, scope, client download, and consent. An authorized agent can do the configuration and local setup; the user's authentication, policy decisions, and permission approval remain personal steps. Workspace admin restrictions, Testing expiry, or a headless callback can make setup longer. Do not promise a fixed completion time.

## Common problems

| Symptom                                                      | Check and action                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client JSON is rejected                                      | Confirm a **Desktop app** client and its `installed` JSON were downloaded. Do not edit a Web client JSON to disguise its type.                                                                        |
| Personal Gmail account is blocked by an Internal app         | Internal only covers its Workspace organization. Use the appropriate External audience in a dedicated project; do not modify another app's shared audience.                                           |
| Test user cannot authorize                                   | Check the sending address is listed for External / Testing, the correct account was selected, and organization policy permits the scope. Do not add unrelated users or bypass warnings automatically. |
| Login works, then refresh fails a week later                 | Check External / Testing expiry and Google's revocation/publishing requirements. Reauthorize only when needed; Production is not the same as verified.                                                |
| Browser reaches an invalid or unreachable localhost callback | Check the original process is alive, has not timed out, and the browser can reach that machine or its SSH forward. Begin a new flow if the old one expired.                                           |
| Keychain is locked or missing                                | Unlock/configure the user's OS store. Use the unencrypted file backend only as an explicit fallback; do not silently persist tokens elsewhere.                                                        |
| `auth status` says connected but drafting fails              | Status only reads saved credentials. Inspect the safe error from the real refresh/profile/draft operation; check account, grant, scope, and project API enablement.                                   |
| Connector-created mail loses the image                       | Use this raw-MIME CLI or a verified MIME-capable connector. `htmlBody` success is not evidence the image survived.                                                                                    |
| Draft creation timed out or returned 5xx                     | Treat it as ambiguous; inspect Gmail and the operation journal, then recover the actual draft with `verify --draft-id`. Do not blindly POST again.                                                    |
| Ordinary Gmail compose is untracked                          | Expected: nothing inserted a pixel. GCP/OAuth setup alone does not modify Gmail composition.                                                                                                          |
| Recipient opening produces no new request                    | Check arming, prior fetches, cache/proxy behavior, and stored MIME. Do not call the message unread based on absent requests.                                                                          |
| Console asks for billing or a paid product                   | Stop that change and check the selected product/project. Billing and additional GCP infrastructure are outside this setup.                                                                            |

## Report the result

Return the sender account, local credential-store type, private client file location, Worker URL, persistent agent workflow location, test operation/draft/tracking IDs, and observed test results. Never include client secrets or tokens. List each stage as verified, pending, or unavailable: saved credentials, successful live refresh/profile, saved image, human Send, manual arming, recipient fetch, and signed webhook receipt.

Explicitly report remaining UX limits: agent/integration-created drafts rather than automatic native Gmail composition; manual post-send arming by default; proxy caching and imperfect sender exclusion. Keep future Managed ideas separate from shipped features. See the [CLI guide](gmail-cli.md) for logout/revocation and the current live-test evidence.
