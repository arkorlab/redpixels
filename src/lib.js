export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const encoder = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function config(env) {
  if (typeof env.API_TOKEN !== "string" || env.API_TOKEN.length < 32)
    throw new HttpError(503, "Set API_TOKEN to at least 32 characters");
  const mode = env.WEBHOOK_MODE || "every";
  const filter = env.WEBHOOK_FILTER || "all";
  const seconds = env.SELF_WINDOW_SECONDS ?? "30";
  if (!["first", "every"].includes(mode))
    throw new HttpError(503, "Invalid WEBHOOK_MODE");
  if (!["all", "unflagged"].includes(filter))
    throw new HttpError(503, "Invalid WEBHOOK_FILTER");
  if (!/^\d+$/.test(seconds) || Number(seconds) > 86400)
    throw new HttpError(503, "Invalid SELF_WINDOW_SECONDS");
  if (env.WEBHOOK_URL) {
    validateUrl(env.WEBHOOK_URL, "WEBHOOK_URL");
    if (
      typeof env.WEBHOOK_SECRET !== "string" ||
      env.WEBHOOK_SECRET.length < 32
    )
      throw new HttpError(503, "Set WEBHOOK_SECRET to at least 32 characters");
  }
  if (env.PUBLIC_BASE_URL) {
    const u = validateUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL");
    if (u.pathname !== "/" || u.search)
      throw new HttpError(503, "PUBLIC_BASE_URL must be an origin");
  }
  const selfIps = (env.SELF_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeIp);
  if (selfIps.includes(null))
    throw new HttpError(503, "Invalid SELF_IPS (use exact IP addresses)");
  return { mode, filter, windowMs: Number(seconds) * 1000, selfIps };
}

function validateUrl(value, name) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.hash)
      throw new Error();
    return u;
  } catch {
    throw new HttpError(
      503,
      `${name} must be an HTTPS URL without credentials or fragment`,
    );
  }
}

export function normalizeIp(ip) {
  if (!ip) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((n) => n <= 255) ? parts.join(".") : null;
  }
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(":")) return null;
  try {
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

export async function equalSecret(a, b) {
  const [x, y] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))),
  );
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function authenticate(request, env) {
  const header = request.headers.get("authorization") || "";
  return equalSecret(header, `Bearer ${env.API_TOKEN}`);
}

export async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function selfCookie(env) {
  const expires = Math.floor(Date.now() / 1000) + 365 * 86400;
  return `${expires}.${await hmac(env.API_TOKEN, `redpixels-self:${expires}`)}`;
}

export async function isSelf(request, env, cfg) {
  if (
    cfg.selfIps.includes(normalizeIp(request.headers.get("cf-connecting-ip")))
  )
    return "self_ip";
  if (
    request.headers.has("authorization") &&
    (await authenticate(request, env))
  )
    return "self_authenticated";
  const value = /(?:^|;\s*)redpixels_self=([^;]+)/.exec(
    request.headers.get("cookie") || "",
  )?.[1];
  if (!value) return null;
  const [expires, signature] = value.split(".");
  if (
    !/^\d{10,12}$/.test(expires || "") ||
    !/^[a-f0-9]{64}$/.test(signature || "") ||
    Number(expires) <= Date.now() / 1000
  )
    return null;
  return (await equalSecret(
    signature,
    await hmac(env.API_TOKEN, `redpixels-self:${expires}`),
  ))
    ? "self_cookie"
    : null;
}

// These describe request evidence, never a verified human read.
export function classify({ ua, purpose, self, armedAt, now }, cfg) {
  const flags = [];
  if (/GoogleImageProxy/i.test(ua)) flags.push("google_image_proxy");
  if (
    /^Mozilla\/5\.0\s*$/.test(ua) ||
    (/AppleWebKit/i.test(ua) && !/(Safari|Chrome|Chromium|Mobile\/)/i.test(ua))
  )
    flags.push("possible_apple_mpp");
  if (
    /bot|crawler|spider|preview|prefetch|YahooMailProxy|HeadlessChrome/i.test(
      ua,
    ) ||
    /prefetch|preview/i.test(purpose)
  )
    flags.push("automation_or_prefetch");
  if (self) flags.push(self);
  if (!armedAt) flags.push("before_armed");
  else if (now - armedAt < cfg.windowMs) flags.push("early_fetch");
  return flags;
}

export function eligible(flags, filter) {
  if (flags.some((f) => f.startsWith("self_") || f === "before_armed"))
    return false;
  return filter === "all" || flags.every((f) => f === "google_image_proxy");
}

export function relTime(fromMs, nowMs = Date.now()) {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  for (const [unit, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]) {
    const count = Math.floor(seconds / size);
    if (count) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

export function pagination(url) {
  const limit = url.searchParams.get("limit") ?? "100";
  const after = url.searchParams.get("after") ?? "0";
  if (
    !/^\d+$/.test(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 500 ||
    !/^\d+$/.test(after) ||
    !Number.isSafeInteger(Number(after))
  )
    throw new HttpError(
      400,
      "Invalid pagination: limit 1..500, after a nonnegative integer",
    );
  return { limit: Number(limit), after: Number(after) };
}

export async function readJson(request) {
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    throw new HttpError(415, "Use Content-Type: application/json");
  if (!request.body) throw new HttpError(400, "Expected a JSON object");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new HttpError(413, "JSON body exceeds 16 KiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Expected a JSON object");
  }
}

export function registration(body, request) {
  for (const key of Object.keys(body))
    if (!["recipient", "subject", "external_id", "armed"].includes(key))
      throw new HttpError(400, `Unknown field: ${key}`);
  const result = {};
  for (const [key, max] of [
    ["recipient", 1000],
    ["subject", 1000],
    ["external_id", 256],
  ]) {
    const value = body[key] ?? null;
    if (value !== null && (typeof value !== "string" || value.length > max))
      throw new HttpError(400, `Invalid ${key} (max ${max} characters)`);
    result[key] = value;
  }
  if (body.armed !== undefined && typeof body.armed !== "boolean")
    throw new HttpError(400, "armed must be boolean");
  result.armed = body.armed ?? true;
  const key = request.headers.get("idempotency-key");
  if (key !== null && !/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new HttpError(
      400,
      "Idempotency-Key must be 8..128 URL-safe characters",
    );
  return { data: result, key };
}
