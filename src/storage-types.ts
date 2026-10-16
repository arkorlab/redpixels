import type { DeliveryError, DeliveryStatus } from "./types.ts";

/** SQLite rows use epoch milliseconds and serialized flags, unlike public JSON. */
export type MessageRow = {
  seq: number;
  id: string;
  recipient: string | null;
  subject: string | null;
  external_id: string | null;
  created_at: number;
  armed_at: number | null;
  idempotency_key: string | null;
  fingerprint: string;
  open_count: number;
  eligible_open_count: number;
  webhook_count: number;
  last_open_at: number | null;
};

export type OpenRow = {
  seq: number;
  event_id: string;
  message_id: string;
  timestamp: number;
  open_number: number;
  ua: string;
  country: string | null;
  flags: string;
  notification_eligible: 0 | 1;
};

export type OutboxRow = {
  event_id: string;
  message_id: string;
  url: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt: number;
  delivered_at: number | null;
  last_status: number | null;
  last_error: DeliveryError | null;
};

/** Nullable fields reflect the LEFT JOIN when no notification was enqueued. */
export type OpenWithDeliveryRow = OpenRow & {
  webhook_status: DeliveryStatus | null;
  attempts: number | null;
  last_status: number | null;
  last_error: DeliveryError | null;
  delivered_at: number | null;
};

export type DeliveryJob =
  | (OutboxRow & { exhausted?: false })
  | { exhausted: true };
