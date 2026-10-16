import type { OpenFlag, OpenRecord, WebhookPayload } from "../src/types.ts";

/** Compile-only checks: widening the public contracts makes these directives fail. */
function contracts(open: OpenRecord, payload: WebhookPayload): void {
  const flag: OpenFlag = "google_image_proxy";
  open.flags.push(flag);
  const timestamp: string = open.timestamp;
  const count: number = payload.open_count;
  const subject: string | null = payload.subject;
  void [timestamp, count, subject];

  // @ts-expect-error Only known evidence flags may be recorded.
  open.flags.push("confirmed_human");
  // @ts-expect-error Webhook event type is a literal contract.
  payload.type = "open";
  // @ts-expect-error The existing webhook version is exactly 1.
  payload.version = 2;
  // @ts-expect-error Public timestamps are ISO strings, not storage milliseconds.
  open.timestamp = Date.now();
  // @ts-expect-error The event id is required.
  const incomplete: WebhookPayload = { type: "email.open", version: 1 };
  void incomplete;
}

void contracts;
