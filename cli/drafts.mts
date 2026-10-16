import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { createMime } from "../examples/mime.mts";
import {
  GMAIL_API,
  HttpFailure,
  email,
  object,
  operationName,
  requestJson,
  string,
  type CredentialStore,
  type DraftInput,
  type DraftOperation,
  type Fetcher,
  type TrackerSettings,
} from "./contracts.mts";
import { access } from "./oauth.mts";
import { OperationStore } from "./storage.mts";

export interface DraftServices {
  fetcher: Fetcher;
  credentials: CredentialStore;
  operations: OperationStore;
  tracker: TrackerSettings;
}

export function trackerOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "REDPIXELS_URL must be an HTTPS origin without path, credentials, query or fragment",
    );
  return url.origin;
}
export function validateInput(input: DraftInput): void {
  operationName(input.operation);
  email(input.to);
  if (
    !input.subject ||
    input.subject.length > 1000 ||
    /[\x00-\x1f\x7f]/.test(input.subject)
  )
    throw new Error(
      "Subject must be 1–1000 characters without control characters",
    );
  if (
    !input.html.trim() ||
    Buffer.byteLength(input.html) > 2 * 1024 * 1024 ||
    Buffer.byteLength(input.text) > 2 * 1024 * 1024
  )
    throw new Error(
      "Provide HTML; HTML and plain text must each be at most 2 MiB",
    );
}
export function hasPixel(html: string, expected: string): boolean {
  function visit(node: DefaultTreeAdapterMap["node"]): boolean {
    if ("tagName" in node) {
      // Template contents, comments, script text and escaped markup are not images.
      if (node.tagName === "template") return false;
      if (node.tagName === "img") {
        const src = node.attrs.find(
          (attribute) => attribute.name === "src",
        )?.value;
        if (src === expected) return true;
        if (src)
          try {
            const url = new URL(src);
            if (
              url.protocol === "https:" &&
              !url.username &&
              !url.password &&
              /(?:^|\.)googleusercontent\.com$/i.test(url.hostname) &&
              decodeURIComponent(url.hash.slice(1)) === expected
            )
              return true;
          } catch {
            /* An invalid URL is not the expected pixel. */
          }
      }
    }
    return "childNodes" in node && node.childNodes.some(visit);
  }
  return visit(parse(html));
}
function htmlParts(value: unknown, depth = 0): string[] {
  if (depth > 20) throw new Error("Gmail MIME nesting is too deep");
  const part = object(value);
  const result: string[] = [];
  if (part.mimeType === "text/html") {
    const data = object(part.body).data;
    if (typeof data !== "string" || !/^[a-zA-Z0-9_-]*={0,2}$/.test(data))
      throw new Error("Gmail did not return an inline HTML MIME body");
    result.push(Buffer.from(data, "base64url").toString("utf8"));
  }
  if (part.parts !== undefined) {
    if (!Array.isArray(part.parts) || part.parts.length > 100)
      throw new Error("Invalid Gmail MIME parts");
    for (const child of part.parts) result.push(...htmlParts(child, depth + 1));
  }
  return result;
}
export function verifyStoredDraft(
  value: unknown,
  operation: DraftOperation,
): string {
  const draft = object(value);
  if (draft.id !== operation.draftId)
    throw new Error("Gmail returned a different draft");
  const message = object(draft.message);
  const payload = object(message.payload);
  if (!Array.isArray(payload.headers))
    throw new Error("Gmail draft headers are missing");
  const from = payload.headers
    .map(object)
    .filter(
      (header) =>
        typeof header.name === "string" && header.name.toLowerCase() === "from",
    );
  if (from.length !== 1)
    throw new Error("Gmail draft has no unique From header");
  const header = string(from[0]!.value, "From header").trim();
  const address = /<([^<>\s]+)>$/.exec(header)?.[1] || header;
  if (email(address).toLowerCase() !== operation.account.toLowerCase())
    throw new Error(
      "Gmail draft sender does not match the authenticated account",
    );
  if (!htmlParts(payload).some((html) => hasPixel(html, operation.pixelUrl)))
    throw new Error(
      "Saved Gmail draft is missing the tracking image; do not send it",
    );
  return string(message.id, "Gmail message ID");
}
function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}
export function result(operation: DraftOperation) {
  return {
    operation: operation.operation,
    account: operation.account,
    tracking_id: operation.trackingId,
    pixel_url: operation.pixelUrl,
    gmail_draft_id: operation.draftId ?? null,
    gmail_message_id: operation.gmailMessageId ?? null,
    state: operation.state,
    pixel_verified_at: operation.verifiedAt ?? null,
    armed: operation.armed,
    gmail_url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(operation.account)}#drafts`,
    next_step: operation.armed
      ? "Review and send in Gmail. Draft/Sent previews may record fetches or fill proxy caches."
      : `Review and send in Gmail, then run: pnpm gmail arm --operation ${operation.operation} --confirm-sent`,
  };
}
async function checkDraft(
  services: DraftServices,
  operation: DraftOperation,
  accessToken: string,
  saveFailure = true,
): Promise<DraftOperation> {
  try {
    const saved = await requestJson(
      services.fetcher,
      `${GMAIL_API}/drafts/${encodeURIComponent(operation.draftId!)}?format=full`,
      { headers: headers(accessToken) },
      "Gmail draft verification",
    );
    operation.gmailMessageId = verifyStoredDraft(saved, operation);
    operation.state = "verified";
    operation.verifiedAt = new Date().toISOString();
    await services.operations.write(operation);
    return operation;
  } catch (error) {
    if (saveFailure) {
      operation.state = "verification_failed";
      delete operation.verifiedAt;
      await services.operations.write(operation);
    }
    throw error;
  }
}

export async function createTrackedDraft(
  services: DraftServices,
  input: DraftInput,
) {
  validateInput(input);
  const origin = trackerOrigin(services.tracker.origin);
  const { accessToken, credential } = await access(
    services.credentials,
    services.fetcher,
  );
  return services.operations.lock(input.operation, async () => {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          origin,
          credential.email,
          input.operation,
          input.to,
          input.subject,
          input.html,
          input.text,
          input.armed,
        ]),
      )
      .digest("hex");
    let operation = await services.operations.read(input.operation);
    if (operation && operation.fingerprint !== fingerprint)
      throw new Error(
        "Operation was already used with different input or account; choose a new operation",
      );
    if (operation?.state === "verified") return result(operation);
    if (operation?.state === "creating" || operation?.state === "ambiguous")
      throw new Error(
        "Gmail creation outcome is uncertain; inspect Gmail and use verify --operation OP --draft-id ID, without creating another draft",
      );
    if (!operation) {
      const registered = await requestJson(
        services.fetcher,
        `${origin}/v1/messages`,
        {
          method: "POST",
          headers: {
            ...headers(services.tracker.token),
            "Idempotency-Key": `gmail-${input.operation}`,
          },
          body: JSON.stringify({
            recipient: input.to,
            subject: input.subject,
            external_id: `gmail-${input.operation}`,
            armed: input.armed,
          }),
        },
        "redpixels registration",
      );
      const id = string(registered.id, "redpixels message ID");
      const pixelUrl = string(registered.pixel_url, "pixel URL");
      const pixelHtml = string(registered.pixel_html, "pixel HTML");
      if (
        !/^[0-9a-f-]{36}$/i.test(id) ||
        pixelUrl !== `${origin}/p/${id}.gif` ||
        !hasPixel(pixelHtml, pixelUrl)
      )
        throw new Error("redpixels returned an invalid tracking image");
      operation = {
        version: 1,
        operation: input.operation,
        fingerprint,
        account: credential.email,
        trackerOrigin: origin,
        trackingId: id,
        pixelUrl,
        pixelHtml,
        armed: input.armed,
        state: "registered",
        createdAt: new Date().toISOString(),
      };
      await services.operations.write(operation);
    }
    if (!operation.draftId) {
      const mime = createMime({
        from: credential.email,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        pixelHtml: operation.pixelHtml,
      });
      // Catch malformed input HTML that would turn the inserted image into text/comment.
      const trackedHtml = /<\/body\s*>/i.test(input.html)
        ? input.html.replace(
            /<\/body\s*>/i,
            () => `${operation.pixelHtml}</body>`,
          )
        : input.html + operation.pixelHtml;
      if (!hasPixel(trackedHtml, operation.pixelUrl))
        throw new Error(
          "Input HTML prevents the tracking image from rendering; fix it before creating a draft",
        );
      operation.state = "creating";
      await services.operations.write(operation);
      try {
        const created = await requestJson(
          services.fetcher,
          `${GMAIL_API}/drafts`,
          {
            method: "POST",
            headers: headers(accessToken),
            body: JSON.stringify({
              message: { raw: Buffer.from(mime).toString("base64url") },
            }),
          },
          "Gmail draft creation",
        );
        operation.draftId = string(created.id, "Gmail draft ID");
        operation.gmailMessageId = string(
          object(created.message).id,
          "Gmail message ID",
        );
      } catch (error) {
        operation.state =
          error instanceof HttpFailure &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
            ? "registered"
            : "ambiguous";
        await services.operations.write(operation);
        throw error;
      }
      operation.state = "created";
      try {
        await services.operations.write(operation);
      } catch {
        throw new Error(
          `Draft created but journal write failed; retain Gmail draft ${operation.draftId} and redpixels ${operation.trackingId}; do not recreate it`,
        );
      }
    }
    return result(await checkDraft(services, operation, accessToken));
  });
}

export async function verifyDraft(
  services: DraftServices,
  name: string,
  draftId?: string,
) {
  operationName(name);
  const { accessToken, credential } = await access(
    services.credentials,
    services.fetcher,
  );
  return services.operations.lock(name, async () => {
    const operation = await services.operations.read(name);
    if (!operation) throw new Error("Unknown operation");
    if (operation.account.toLowerCase() !== credential.email.toLowerCase())
      throw new Error("Operation belongs to a different Gmail account");
    const candidate = draftId ? { ...operation, draftId } : operation;
    if (!candidate.draftId)
      throw new Error("Provide --draft-id after inspecting Gmail");
    return result(
      await checkDraft(
        services,
        candidate,
        accessToken,
        !draftId || draftId === operation.draftId,
      ),
    );
  });
}
export async function armDraft(
  services: DraftServices,
  name: string,
  confirmedSent: boolean,
) {
  if (!confirmedSent)
    throw new Error(
      "Press Send in Gmail first, then pass --confirm-sent; the CLI does not inspect Sent mail",
    );
  return services.operations.lock(name, async () => {
    const operation = await services.operations.read(name);
    if (!operation || operation.state !== "verified")
      throw new Error("A verified draft operation is required before arming");
    if (operation.trackerOrigin !== trackerOrigin(services.tracker.origin))
      throw new Error("Operation belongs to a different redpixels deployment");
    if (!operation.armed) {
      await requestJson(
        services.fetcher,
        `${operation.trackerOrigin}/v1/messages/${operation.trackingId}/arm`,
        {
          method: "POST",
          headers: headers(services.tracker.token),
        },
        "redpixels arming",
      );
      operation.armed = true;
      await services.operations.write(operation);
    }
    return {
      ...result(operation),
      sent_status: "user_confirmed_not_verified",
      next_step:
        "Tracking is armed. Recipient image fetches can now notify; opening your Sent copy may also record a fetch.",
    };
  });
}
