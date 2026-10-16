import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhook } from "../../examples/verify-webhook.mjs";

const secret = "receiver-test-secret";
const now = 1792137600000;
const body = Buffer.from(
  JSON.stringify({ event_id: "event-123", subject: "Hello 世界" }),
);
function headers(time = now / 1000) {
  return new Headers({
    "x-redpixels-event-id": "event-123",
    "x-redpixels-timestamp": String(time),
    "x-redpixels-signature": `v1=${createHmac("sha256", secret).update(`${time}.`).update(body).digest("hex")}`,
  });
}
test("verifies original UTF-8 body and timestamp", () =>
  assert.equal(
    verifyWebhook(body, headers(), secret, now).subject,
    "Hello 世界",
  ));
test("rejects tampering, wrong secrets and changed whitespace", () => {
  assert.throws(() =>
    verifyWebhook(Buffer.from('{"event_id":"other"}'), headers(), secret, now),
  );
  assert.throws(() => verifyWebhook(body, headers(), "wrong", now));
  assert.throws(() =>
    verifyWebhook(
      Buffer.concat([body, Buffer.from(" ")]),
      headers(),
      secret,
      now,
    ),
  );
});
test("rejects expired and future replays and malformed signatures", () => {
  assert.throws(() =>
    verifyWebhook(body, headers(now / 1000 - 301), secret, now),
  );
  assert.throws(() =>
    verifyWebhook(body, headers(now / 1000 + 301), secret, now),
  );
  const bad = headers();
  bad.set("x-redpixels-signature", "v1=abc");
  assert.throws(() => verifyWebhook(body, bad, secret, now));
  const other = headers();
  other.set("x-redpixels-event-id", "other");
  assert.throws(() => verifyWebhook(body, other, secret, now));
});
