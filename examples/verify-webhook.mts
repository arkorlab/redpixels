import type { WebhookPayload } from "../src/types.ts";
import { createHmac, timingSafeEqual } from "node:crypto";

// rawBody must be the original bytes, before any JSON middleware parses them.
// headers is a standard Headers instance. Persist event_id deduplication yourself.
export function verifyWebhook(
  rawBody: Buffer,
  headers: Headers,
  secret: string,
  now = Date.now(),
): WebhookPayload {
  const timestamp = headers.get("x-redpixels-timestamp") || "";
  const signature = headers.get("x-redpixels-signature") || "";
  if (
    !/^\d{10,12}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    throw new Error("Expired or invalid timestamp");
  if (!/^v1=[a-f0-9]{64}$/.test(signature))
    throw new Error("Invalid signature format");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  const actual = Buffer.from(signature.slice(3), "hex");
  if (!timingSafeEqual(expected, actual)) throw new Error("Invalid signature");
  const event = JSON.parse(rawBody.toString("utf8")) as WebhookPayload;
  if (event.event_id !== headers.get("x-redpixels-event-id"))
    throw new Error("Event id mismatch");
  return event;
}
