# Use your existing Gmail connection

**English** | [日本語](gmail-connectors.ja.md) · [README](../README.md)

Start with the Gmail connection your agent already has. A compatible connector can create tracked drafts without a separate Google Cloud project, client JSON or redpixels-specific Google sign-in. Its host manages Gmail authorization. The tracking Worker still runs in your own Cloudflare account and never receives Google credentials.

**Check the connector's actual capabilities.** Some `htmlBody` tools remove images. Other connectors support MIME trees or complete raw messages and preserve them. Neither the parameter name nor a successful creation response proves preservation: read the saved Gmail message back and check the image.

## Agent workflow

1. Confirm the connected Gmail identity and inspect the draft tool's input contract. Do not extract private connector tokens.
2. Register one message with redpixels using a stable `Idempotency-Key`, recipient, subject and `armed:false`. Keep the returned message ID, pixel URL and `pixel_html`.
3. Insert that HTML into the email's HTML body as a remote image. Use the connector's supported MIME-byte or raw-message input. Do not pass encoded text to a plain `htmlBody` field.
4. Create an unsent draft. Save both the Gmail draft ID and its underlying message ID. A timeout or uncertain result requires inspection before retrying; redpixels idempotency does not prevent duplicate Gmail drafts.
5. Read the saved message using Gmail `format:raw` if available. Decode the RFC 2822 message, its content-transfer encoding and the HTML MIME part. Require a real `<img>` with the returned pixel URL. Checking a snippet, plaintext body or connector-generated preview is insufficient. Do not fetch the pixel to verify its presence.
6. Return the draft only after that check succeeds. Preserve the pixel and repeat verification after editing. If the connector removes it or cannot expose stored MIME, report the compatibility gap; do not silently send or claim tracking works.
7. Let the human review and press Send in Gmail. After confirmation, call `POST /v1/messages/<id>/arm` with the Worker's API token. The agent must retain the mapping; CLI `gmail arm --operation` only works for operations created by that CLI.

The existing API defaults to immediate tracking; this workflow deliberately opts into `armed:false`. Pre-arm fetches stay in history with `before_armed` and do not notify. A proxy can still cache a draft preview, and owner Sent views after arming can still record events. Arming does not establish readership or eliminate caching.

## Verified connector input

The Codex Gmail connector available during the 2026-10-16 trial accepted this shape:

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

This is a **schema example**, not a literal request. Replace the placeholder with the base64url-encoded UTF-8 HTML body, including the returned image. This field holds one HTML MIME part; a raw Gmail REST request instead encodes the **whole** RFC 2822 message in `message.raw`. Follow the specific connector's documented schema.

The trial used the existing connector to create one unsent draft, then read `format:raw` through the same connection. The decoded HTML matched the submitted HTML, including the real image. The optional CLI's OAuth and keychain credentials were not used. No additional Google Cloud setup was performed for this path. **This fresh draft was not sent or opened by a recipient**, so this trial establishes stored-image preservation only. Earlier [mobile trials](mobile-test.md) and the separate [CLI acceptance trial](gmail-cli.md#manual-acceptance-test) have different scopes.

The result does not establish compatibility with another host's `htmlBody` connector. Connector capabilities can change. Include a fresh saved-MIME check during setup and a controlled separate-account delivery/open/webhook test before declaring end-to-end compatibility.

## When the existing connector cannot preserve images

Keep the tracker deployment usable and report draft integration as pending. A host-supported Gmail connection with MIME support is the lowest-setup alternative. The [direct Gmail CLI](gmail-cli.md) is an optional advanced fallback for users who explicitly choose their own Desktop OAuth client; it currently requires Google Cloud setup. Do not start that setup automatically merely because a user asks to deploy redpixels.

See Google's [draft MIME procedure](https://developers.google.com/workspace/gmail/api/guides/drafts) and [raw message representation](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get).
