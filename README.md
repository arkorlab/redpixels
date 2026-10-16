# Get notified the moment your email is read.

**English** | [日本語](README.ja.md)

**redpixels** is self-hosted email open history and signed webhooks for Gmail.

- **Keep Gmail.** No Chrome extension or separate email app. Your AI assistant adds a tiny image when creating an HTML draft through the Gmail API. Review and send in Gmail, including its mobile apps, provided the image survives editing.
- **See the whole observed history.** Every image request reaching your Worker is saved, with a timestamp, count, relative time, and classification flags.
- **Get a webhook.** Notify on the first qualifying request or every qualifying request, with signatures and durable retries.
- **Host it on your own Cloudflare account.** One Worker, built-in SQLite storage, MIT licensed. No Gmail credentials on the tracking server.

**An image fetch is evidence, not a verified read.** Caches can hide repeat opens; Apple Mail Privacy Protection and previews can fetch without anyone reading. redpixels records every observed fetch, not every actual read. Mobile behavior varies; see the [tested iOS case and remaining gaps](#gmail-mobile-compatibility).

The name plays on “read pixels”: the past tense of “read” sounds like “red.”

## Deploy in a few minutes

You need a Cloudflare account, Node.js 22.12+ or 24 LTS, and [pnpm](https://pnpm.io/installation) 10. The SQLite Durable Object namespace is created automatically; no database ID, KV namespace, or external database to configure. Cloudflare usage limits and charges apply; see [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

```sh
git clone https://github.com/arkorlab/redpixels.git
cd redpixels
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm deploy
pnpm exec wrangler secret put API_TOKEN
```

Enter a random `API_TOKEN` of at least 32 characters (generate one with `openssl rand -hex 32`). Save it in your password manager and your assistant's secret configuration. The API fails closed until it is set. Deployment prints the Worker URL, usually `https://redpixels.<your-subdomain>.workers.dev`.

Set these locally for the examples:

```sh
export REDPIXELS_URL='https://redpixels.<your-subdomain>.workers.dev'
export REDPIXELS_API_TOKEN='<your API_TOKEN>'
```

Register an email; the server generates its random, unique pixel URL:

```sh
curl --fail-with-body "$REDPIXELS_URL/v1/messages" \
  -H "Authorization: Bearer $REDPIXELS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: draft-operation-123' \
  --data '{"recipient":"alice@example.com","subject":"Hello"}'
```

The response includes `id`, `pixel_url`, and ready-to-embed `pixel_html`:

```html
<img
  src="https://YOUR-WORKER/p/GENERATED-UUID.gif"
  width="1"
  height="1"
  alt=""
  style="display:block;border:0;width:1px;height:1px"
/>
```

Use the **returned** HTML, not these placeholders. Add it inside the draft's HTML body, ideally before `</body>`. Keep it as a remote image, not a CID attachment, data URL, or literal text. Existing messages and messages composed without the pixel cannot be tracked retroactively.

Use a new `Idempotency-Key` per email. Retrying the same key and body returns the same pixel; changed metadata returns `409`. The header is optional but recommended for AI workflows. One message to several people shares a pixel and cannot distinguish recipients; use separate messages/pixels when that matters.

## Gmail draft integration

1. Register the email with redpixels.
2. Insert `pixel_html` into the HTML MIME part.
3. Base64url-encode the complete MIME message and call Gmail `users.drafts.create`.
4. Review and send in Gmail. Preserve the pixel whenever replacing a draft.

[Google's draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts) documents MIME and base64url encoding. redpixels does not read your inbox, obtain Gmail OAuth access, or send mail.

The dependency-free [Node example](examples/gmail-draft.mts) creates a draft without sending it:

```sh
export GMAIL_ACCESS_TOKEN='<OAuth access token with gmail.compose permission>'
export GMAIL_FROM='you@example.com'
export GMAIL_TO='alice@example.com'
export GMAIL_SUBJECT='Hello'
export GMAIL_TEXT='Hello Alice!'
node --experimental-strip-types examples/gmail-draft.mts ./email.html
```

Use your assistant's existing Gmail authorization. Gmail credentials are used only by this local example; never put them in Worker variables. On Gmail failure/timeout, the example retains and prints the redpixels ID for recovery. Re-running can create another Gmail draft; `REDPIXELS_IDEMPOTENCY_KEY` deduplicates redpixels registration only, not Gmail draft creation.

### Draft previews and arming

By default tracking starts immediately. A preview can fetch before sending. If your workflow can act after sending, register with `"armed":false`, then call:

```sh
curl --fail-with-body -X POST "$REDPIXELS_URL/v1/messages/<id>/arm" \
  -H "Authorization: Bearer $REDPIXELS_API_TOKEN"
```

Pre-arm requests remain in history with `before_armed` and never notify. Repeated arming preserves the original start time. Manual mobile sending needs a later confirmation step in your assistant; redpixels does not watch Gmail's Sent folder. Arming after sending can miss an immediate recipient fetch, and a preview may already have filled a proxy cache. This is an optional tradeoff, not guaranteed self-open detection.

## View every observed open

```sh
curl --fail-with-body "$REDPIXELS_URL/v1/messages/<id>/opens?limit=100" \
  -H "Authorization: Bearer $REDPIXELS_API_TOKEN"

# Readable timeline, automatically following every page:
node --experimental-strip-types examples/history.mts <id>
```

Example output:

```text
Hello: 2 observed fetches
#1  2026-10-14T09:00:00.000Z  2 days ago  [google_image_proxy]
#2  2026-10-16T04:00:00.000Z  5 hours ago  [google_image_proxy]
```

JSON responses contain `message` metadata/totals, `opens`, and `next_after`. Each open includes a unique `event_id`, UTC `timestamp`, relative `ago`, monotonic `open_number`, `ua`, `country`, `flags`, `notification_eligible`, and `webhook` delivery status.

- `open_count`: all recorded GETs, including suspected automation and owner fetches.
- `eligible_open_count`: requests qualifying under the filter when recorded; **not** a human-read estimate.
- `webhook_count`: notifications enqueued, not successful deliveries.
- `webhook`: `null` if no event was queued; otherwise `status` (`pending`, `delivered`, `failed`), `attempts`, `last_status`, `last_error`, and `delivered_at`.

Histories are oldest first, including ties, with stable numeric cursors. Follow `next_after` until `null`; history is never silently truncated. Page size defaults to 100, maximum 500. Message listing includes emails with zero fetches. Classification and eligibility are stored snapshots, not recomputed after configuration changes.

## Signed webhooks

Enter a different random secret (at least 32 characters), then your HTTPS receiver URL:

```sh
pnpm exec wrangler secret put WEBHOOK_SECRET
pnpm exec wrangler secret put WEBHOOK_URL

# Optional: enter "first" instead of the default "every"
pnpm exec wrangler secret put WEBHOOK_MODE

# Optional: enter "unflagged" instead of the default "all"
pnpm exec wrangler secret put WEBHOOK_FILTER
```

These are environment bindings. Wrangler secrets keep personal settings outside the repository and preserve them on redeployment. A URL without a valid signing secret is a configuration error; unsigned notifications are never sent.

| Setting            | Behavior                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `every`            | Notify for each qualifying fetch.                                                                                                                                                 |
| `first`            | Notify for the first qualifying fetch while webhooks are enabled. Owner/pre-arm fetches do not consume it. Delivery failures retry the same event; later opens do not replace it. |
| Filter `all`       | Include suspected MPP, automation and early fetches with flags. Explicit owner/pre-arm fetches are always excluded.                                                               |
| Filter `unflagged` | Also exclude possible MPP, automation and early fetches. Gmail's proxy flag alone is still eligible. Can suppress real reads and cannot guarantee human activity.                 |

Payload: `type: "email.open"`, `version: 1`, stable `event_id`, `message_id`, `recipient`, `subject`, `external_id`, UTC `timestamp`, the event's `open_count` / `eligible_open_count`, `ua`, `country`, and `flags`.

```text
X-Redpixels-Event-Id: <stable event UUID>
X-Redpixels-Timestamp: <Unix seconds for this attempt>
X-Redpixels-Signature: v1=<hex HMAC-SHA256>
```

Sign **`timestamp + "." + raw_request_body`** with the shared secret. Verify in constant time; reject timestamps more than five minutes old or in the future. Persist deduplication by `event_id`. Parse JSON only after verification. See the tested [Node receiver verifier](examples/verify-webhook.mts). Payloads contain email metadata; choose a receiver you control.

Events, counts, outbox rows and alarms commit in one storage transaction. Webhook HTTP runs independently of serving the pixel, with a 10-second timeout per attempt. `2xx` acknowledges delivery. Network errors, `408`, `429` and `5xx` retry with exponential backoff up to eight attempts (roughly eleven minutes plus request time). Other statuses, including redirects, fail permanently. Redirects are never followed. Platform alarms can be delayed.

Delivery uses **at-least-once semantics with bounded retries**, not exactly once or guaranteed eventual delivery. Ambiguous timeouts or a crash after acceptance can duplicate delivery. Event IDs/payloads stay stable; signing timestamps refresh. The history API exposes delivery failures. `delivered` means HTTP receiver acceptance, not a person seeing a downstream notification. There is no automatic redrive after exhaustion. Queued jobs keep the original receiver URL and use the current signing secret. Unsetting `WEBHOOK_URL` stops new jobs; queued jobs still run. Deleting a message cancels queued jobs; a request already in flight cannot be recalled.

## Recognizing owner and automatic activity

Every flag remains visible. None proves who read an email.

| Flag                     | Evidence and limits                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self_ip`                | Direct request matches exact `SELF_IPS`. Shared networks may flag others. Proxies hide your phone's IP. Raw IPs are never stored.                                                         |
| `self_cookie`            | Valid signed owner cookie. Visit `/self` on your Worker and enter your API token to mark that browser. Gmail/Apple proxies do not forward it; third-party cookie blocking can prevent it. |
| `self_authenticated`     | Image GET has the valid owner Bearer token, useful for controlled tests. Never embed the token in an email or URL.                                                                        |
| `before_armed`           | Registered with `armed:false` and not yet armed.                                                                                                                                          |
| `early_fetch`            | Within `SELF_WINDOW_SECONDS` of registration/arming (default 30). Could be a preview, scanner, or fast recipient; **not** a confirmed self-open.                                          |
| `google_image_proxy`     | `GoogleImageProxy` UA. Gmail uses proxies for normal viewing too; this alone does not mean a false read. Caching and reader identity remain opaque.                                       |
| `possible_apple_mpp`     | Bare `Mozilla/5.0`, or generic WebKit without normal browser/mobile tokens. Broad, incomplete UA heuristic; other clients may match and Apple traffic may not.                            |
| `automation_or_prefetch` | Bot/crawler/preview/proxy UA hints or `Purpose`/`Sec-Purpose` prefetch/preview headers. Hints can be absent or spoofed.                                                                   |

Set comma-separated exact owner IPv4/IPv6 addresses with `wrangler secret put SELF_IPS`. CIDRs are unsupported. Do not add shared Google/Apple proxy networks. `SELF_WINDOW_SECONDS=0` disables the time heuristic. Later owner opens, especially through Gmail's proxy, can remain indistinguishable from recipient activity.

## Gmail mobile compatibility

**One real iPhone running iOS 26 was tested on October 16, 2026** (Gmail app version not recorded). A Gmail API HTML draft retained its 1px image after a text edit, saving, and sending from the Gmail app. Decoding the received raw MIME confirmed both the edited text and the original tracking URL in the image's `src`. In the saved draft, Gmail temporarily changed `src` to a Google proxy URL with the original URL in its fragment; sending restored the original `src`.

This was one self-addressed email on one device. Android, separate recipient accounts, replies, and format changes remain untested. Google's MIME draft API does not guarantee preservation in every mobile editor. See the [device record](docs/mobile-test.md) for the exact scope.

**Pre-view requests were observed:** four Google image proxy fetches and their signed webhooks arrived before the user opened the received message. They carried `google_image_proxy`, but could not be identified as self-opens through the proxy. A notification can therefore precede recipient viewing.

Before relying on your device:

1. Create a fresh draft/pixel. Retrieve `users.drafts.get?format=raw`, decode the MIME HTML, and confirm the exact URL.
2. Open, edit and save it in Gmail iOS/Android. Inspect the raw draft again. Record OS/Gmail versions.
3. Send to a separate account you control. Inspect the recipient's original MIME (`users.messages.get?format=raw` or Gmail web “Show original”) for the pixel. A composer screenshot is insufficient.
4. Note fetches before recipient viewing, then open on the recipient device and compare timestamps. Reopen to observe caching. Test sending without edits, replies, and format switches separately.
5. Repeat per platform. If the image disappears, regenerate the HTML draft or send via the Gmail API; do not assume mobile edits are safe.

Use the [compatibility record](docs/mobile-test.md). CI sends no mail and makes no live mobile or MPP accuracy claim.

## Accuracy and operational limits

- **No verified read or reader identity.** Requests do not establish attention, duration, reader, or forwarding. Anyone with a pixel URL can create events by fetching it.
- **Gmail proxy/cache.** [Google documents image proxying](https://gmail.googleblog.com/2013/12/images-now-showing.html). Caches can hide repeats and reuse pre-send fetches. No-cache headers cannot force clients to refetch. Even one fetch is not proof of reading; no fetch does not prove unread.
- **Apple background loading.** [Apple documents downloading remote content when received, instead of viewed](https://support.apple.com/guide/mail/change-privacy-settings-mlhlae4a4fe6/mac). This can produce false opens. Server-only MPP detection here is unreliable, with false positives and negatives.
- **Blocked images.** Plain text, sanitizers, tracking blockers, and disabled images cause missing events. Security scanners cause extra events. [Gmail can suppress suspicious images](https://support.google.com/mail/answer/145919?hl=en).
- **Observed origin requests only.** Timestamps are fetch times; `country` often describes a proxy. User-agents are untrusted. Raw IPs are not saved.
- **Availability and abuse.** Recording/configuration failures still return the GIF but lose that event. Generic errors are logged without metadata. Public pixels have no human challenge; a known URL can be abused to exhaust platform resources.
- **Retention.** No automatic expiry; storage grows with usage. One SQLite Durable Object per installation has platform limits. Export every page and DELETE messages when appropriate. Keep the Worker namespace/migration history on upgrades. No automatic import from the partial KV prototype.
- **Privacy.** Stored data includes optional recipient/subject, UA, country, timestamps, flags and delivery diagnostics. URLs contain random IDs only. Minimize metadata and use disclosure/consent suitable for your context. Never put API secrets in drafts, URLs or Git.

## API

All `/v1/*` routes require `Authorization: Bearer <API_TOKEN>`. API responses use `Cache-Control: no-store`. No public metadata/history, permissive CORS, or query-token authentication.

| Method | Path                                       | Description                                                                                                                             |
| ------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/messages`                             | JSON: optional `recipient`, `subject`, `external_id` (string/null), `armed` (boolean; default true). Optional `Idempotency-Key` header. |
| GET    | `/v1/messages?limit=100&after=0`           | All messages, including never-fetched ones. Follow `next_after`.                                                                        |
| GET    | `/v1/messages/:id`                         | Metadata, totals and pixel HTML.                                                                                                        |
| GET    | `/v1/messages/:id/opens?limit=100&after=0` | Complete timeline across pages with flags and webhook status.                                                                           |
| POST   | `/v1/messages/:id/arm`                     | Arm once; preserve the initial arm time.                                                                                                |
| DELETE | `/v1/messages/:id`                         | Delete metadata, history and queued jobs; pixel stops recording.                                                                        |
| POST   | `/v1/self`                                 | Set owner cookie, also available through the `/self` setup form.                                                                        |
| GET    | `/p/:id.gif`                               | Public transparent GIF; only registered UUIDs record. Unknown IDs return the same image and allocate no history.                        |
| HEAD   | `/p/:id.gif`                               | Image headers without recording.                                                                                                        |

Registration body: maximum 16 KiB; recipient/subject: 1,000 characters each; external ID: 256. Unknown fields are rejected. IDs are server-generated UUIDv4. Pagination: limit 1–500; `after` is the previous numeric `next_after`. `external_id` can link your workflow; Gmail draft message IDs change when drafts are replaced.

## Environment configuration

Personal settings belong in Cloudflare Worker environment bindings. `wrangler.toml` contains infrastructure only, without personal URLs, account IDs, emails or keys.

| Binding               | Default           | Purpose                                                                                        |
| --------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `API_TOKEN`           | required          | Bearer token and owner-cookie signing key; 32+ characters. Rotation invalidates owner cookies. |
| `WEBHOOK_URL`         | unset             | HTTPS receiver; no credentials/fragments/redirects. Unset disables new jobs.                   |
| `WEBHOOK_SECRET`      | required with URL | Separate 32+ character signing key.                                                            |
| `WEBHOOK_MODE`        | `every`           | `first` / `every`.                                                                             |
| `WEBHOOK_FILTER`      | `all`             | `all` / `unflagged`.                                                                           |
| `SELF_IPS`            | unset             | Comma-separated exact IPv4/IPv6 owner IPs; transient comparison only.                          |
| `SELF_WINDOW_SECONDS` | `30`              | Early-fetch heuristic: 0–86400 seconds.                                                        |
| `PUBLIC_BASE_URL`     | request origin    | Optional fixed HTTPS origin for pixel URLs; no path/query. Useful with a custom domain.        |

## Development

```sh
cp .dev.vars.example .dev.vars
# Replace the example API_TOKEN and configure optional local bindings.
pnpm dev
pnpm check
pnpm test
pnpm build
```

Local development uses local storage and does not deploy. Owner cookies require HTTPS; test `/self` on an HTTPS deployment. Email clients cannot fetch localhost. Local variables, dependencies and build output are ignored by Git.

`pnpm check` runs strict TypeScript checks for the Worker, tests, and Node examples. Runtime types are generated by the pinned Wrangler version; the generated file is ignored by Git. `src/types.ts` defines the public open records, flags, API responses, and webhook payload; `src/storage-types.ts` keeps SQLite row types separate. Types do not replace the existing runtime input validation.

Tests use the Workers runtime and real local SQLite Durable Objects: concurrent counts/first notifications, auth, idempotency, pagination, classification, owner signals, eviction, deletion, signatures and bounded retries. Node tests cover receiver verification and MIME construction. Build is a Wrangler deployment dry run. These do not verify production deployment, Gmail delivery, mobile editing or real MPP accuracy.

See [architecture](docs/architecture.md). This release is single-owner self-hosted OSS. Authentication, storage, classification and delivery have separate boundaries for later tenant/key resolution and metering. Billing and multi-user management are outside this release.

## License

[MIT](LICENSE) · Copyright 2026 Arkor
