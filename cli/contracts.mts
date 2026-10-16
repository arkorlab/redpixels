export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}
export interface GmailCredential extends OAuthClient {
  version: 1;
  email: string;
  refreshToken: string;
  scopes: string[];
}
export interface CredentialStore {
  read(): Promise<GmailCredential | null>;
  write(value: GmailCredential): Promise<void>;
  remove(): Promise<void>;
}
export interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  headers?: { name: string; value: string }[];
  parts?: GmailPart[];
}
export interface GmailDraft {
  id: string;
  message: { id: string; payload?: GmailPart };
}
export type OperationState =
  | "registered"
  | "creating"
  | "created"
  | "verified"
  | "verification_failed"
  | "ambiguous";
export interface DraftOperation {
  version: 1;
  operation: string;
  fingerprint: string;
  account: string;
  trackerOrigin: string;
  trackingId: string;
  pixelUrl: string;
  pixelHtml: string;
  armed: boolean;
  state: OperationState;
  draftId?: string;
  gmailMessageId?: string;
  createdAt: string;
  verifiedAt?: string;
}
export interface DraftInput {
  operation: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  armed: boolean;
}
export interface TrackerSettings {
  origin: string;
  token: string;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid JSON object in service response or local state");
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 16384)
    throw new Error(`Invalid ${label}`);
  return value;
}
export function email(value: unknown): string {
  const address = string(value, "email address");
  if (
    address.length > 254 ||
    !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(
      address,
    )
  )
    throw new Error(
      "Use one bare email address, without display names or lists",
    );
  return address;
}
export function operationName(value: string): string {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(value))
    throw new Error(
      "Operation must be 1–128 letters, digits, dots, underscores or hyphens",
    );
  return value;
}
export class HttpFailure extends Error {
  readonly status: number;
  constructor(status: number, service: string) {
    super(`${service} returned HTTP ${status}`);
    this.status = status;
  }
}
export async function requestJson(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  service: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(`${service} request failed or timed out`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpFailure(response.status, service);
  }
  // Never include response bodies or credential values in errors.
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${service} returned an empty response`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 12 * 1024 * 1024) {
      await reader.cancel();
      throw new Error(`${service} response exceeds 12 MiB`);
    }
    chunks.push(value);
  }
  try {
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new Error(`${service} returned invalid JSON`);
  }
}
