/** Public data contracts. Dates are ISO 8601 UTC strings; counters are observed requests. */
export type WebhookMode = "first" | "every";
export type WebhookFilter = "all" | "unflagged";
export type SelfSignal = "self_ip" | "self_cookie" | "self_authenticated";
export type OpenFlag =
  | SelfSignal
  | "before_armed"
  | "early_fetch"
  | "google_image_proxy"
  | "possible_apple_mpp"
  | "automation_or_prefetch";
export type DeliveryStatus = "pending" | "delivered" | "failed";
export type DeliveryError = "attempt_limit" | "network_or_configuration_error";

/** Raw string environment bindings, validated at runtime by config(). */
export interface Settings {
  API_TOKEN: string;
  WEBHOOK_URL?: string;
  WEBHOOK_SECRET?: string;
  WEBHOOK_MODE?: string;
  WEBHOOK_FILTER?: string;
  SELF_IPS?: string;
  SELF_WINDOW_SECONDS?: string;
  PUBLIC_BASE_URL?: string;
}

export interface TrackerConfig {
  mode: WebhookMode;
  filter: WebhookFilter;
  windowMs: number;
  selfIps: string[];
}

export interface OpenEvidence {
  ua: string;
  purpose: string;
  country: string | null;
  self: SelfSignal | null;
}

export interface ClassificationInput
  extends Pick<OpenEvidence, "ua" | "purpose" | "self"> {
  armedAt: number | null;
  now: number;
}

export interface RegisterMessageRequest {
  recipient?: string | null;
  subject?: string | null;
  external_id?: string | null;
  armed?: boolean;
}

/** Normalized after validating the untrusted registration JSON. */
export interface RegistrationData {
  recipient: string | null;
  subject: string | null;
  external_id: string | null;
  armed: boolean;
}

export interface Pagination {
  limit: number;
  after: number;
}

export interface MessageSummary {
  seq: number;
  id: string;
  recipient: string | null;
  subject: string | null;
  external_id: string | null;
  created_at: string;
  armed_at: string | null;
  open_count: number;
  eligible_open_count: number;
  webhook_count: number;
  last_open_at: string | null;
}

export interface MessageResponse extends MessageSummary {
  pixel_url: string;
  pixel_html: string;
}

export interface MessagePage<T extends MessageSummary = MessageSummary> {
  messages: T[];
  next_after: number | null;
}

export interface RegistrationResult {
  created: boolean;
  message: MessageSummary;
}

export interface WebhookDelivery {
  status: DeliveryStatus;
  attempts: number;
  last_status: number | null;
  last_error: DeliveryError | null;
  delivered_at: string | null;
}

/** One recorded origin GET. This is not proof that a person read the email. */
export interface OpenRecord {
  seq: number;
  event_id: string;
  timestamp: string;
  ago: string;
  open_number: number;
  ua: string;
  country: string | null;
  flags: OpenFlag[];
  notification_eligible: boolean;
  webhook: WebhookDelivery | null;
}

export interface OpenHistoryResponse {
  message: MessageSummary;
  opens: OpenRecord[];
  next_after: number | null;
}

/** Exact v1 JSON payload; serialized once and kept unchanged across retries. */
export interface WebhookPayload {
  type: "email.open";
  version: 1;
  event_id: string;
  message_id: string;
  recipient: string | null;
  subject: string | null;
  external_id: string | null;
  timestamp: string;
  open_count: number;
  eligible_open_count: number;
  ua: string;
  country: string | null;
  flags: OpenFlag[];
}

export interface WebhookHeaders {
  "content-type": "application/json";
  "user-agent": "redpixels/0.1";
  "x-redpixels-event-id": string;
  "x-redpixels-timestamp": string;
  "x-redpixels-signature": `v1=${string}`;
}
