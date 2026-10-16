import type { Env } from "./env.ts";
import type { MessageResponse, MessageSummary } from "./types.ts";
import {
  HttpError,
  ID_PATTERN,
  authenticate,
  config,
  isSelf,
  json,
  pagination,
  readJson,
  registration,
  selfCookie,
} from "./lib.ts";
export { Tracker } from "./store.ts";

const GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);
const pixelHeaders = {
  "content-type": "image/gif",
  "cache-control": "private, no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache",
  expires: "0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// Replace this boundary with a verified key -> tenant lookup in a hosted edition.
// Never accept a tenant id supplied by an unauthenticated caller.
function tracker(env: Env) {
  return env.TRACKER.get(env.TRACKER.idFromName("self-hosted:v1"));
}

function withPixel(message: MessageSummary, origin: string): MessageResponse {
  const pixelUrl = `${origin}/p/${message.id}.gif`;
  return {
    ...message,
    pixel_url: pixelUrl,
    pixel_html: `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/p/")) {
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, {
          status: 405,
          headers: { ...pixelHeaders, allow: "GET, HEAD" },
        });
      const id = /^\/p\/([^/]+)\.gif$/.exec(url.pathname)?.[1];
      if (request.method === "GET" && id && ID_PATTERN.test(id)) {
        try {
          const cfg = config(env);
          // Commit the request before returning the image; webhook I/O is separate.
          await tracker(env).record(id, {
            ua: (request.headers.get("user-agent") || "").slice(0, 1024),
            purpose: [
              request.headers.get("purpose"),
              request.headers.get("sec-purpose"),
            ]
              .filter(Boolean)
              .join(" ")
              .slice(0, 128),
            country: (request.cf?.country as string | undefined) || null,
            self: await isSelf(request, env, cfg),
          });
        } catch {
          // Never expose metadata or break the email image when storage is down.
          console.error("redpixels: pixel recording failed");
        }
      }
      // Unknown ids look identical but never allocate storage.
      return new Response(request.method === "HEAD" ? null : GIF, {
        headers: pixelHeaders,
      });
    }

    if (url.pathname === "/" && request.method === "GET")
      return json({
        name: "redpixels",
        version: "0.1.0",
        docs: "https://github.com/arkorlab/redpixels",
        self_setup: "/self",
      });
    if (url.pathname === "/self" && request.method === "GET")
      return ownerPage();

    try {
      config(env);
      if (!url.pathname.startsWith("/v1/"))
        return json({ error: "not_found" }, 404);
      if (!(await authenticate(request, env)))
        return json({ error: "unauthorized" }, 401, {
          "www-authenticate": "Bearer",
        });
      const db = tracker(env);
      const origin = env.PUBLIC_BASE_URL
        ? new URL(env.PUBLIC_BASE_URL).origin
        : url.origin;
      if (url.pathname === "/v1/self" && request.method === "POST")
        return json({ ok: true }, 200, {
          "set-cookie": `redpixels_self=${await selfCookie(env)}; Path=/p/; HttpOnly; Secure; SameSite=None; Max-Age=31536000`,
        });
      if (url.pathname === "/v1/messages" && request.method === "POST") {
        const { data, key } = registration(await readJson(request), request);
        const result = await db.register(data, key);
        return json(
          withPixel(result.message, origin),
          result.created ? 201 : 200,
        );
      }
      if (url.pathname === "/v1/messages" && request.method === "GET") {
        const page = await db.messages(pagination(url));
        return json({
          ...page,
          messages: page.messages.map((m) => withPixel(m, origin)),
        });
      }
      const match = /^\/v1\/messages\/([^/]+)(?:\/(opens|arm))?$/.exec(
        url.pathname,
      );
      if (match) {
        const [, id, action] = match;
        if (!ID_PATTERN.test(id!))
          throw new HttpError(400, "Invalid message id");
        if (!action && request.method === "GET")
          return json(withPixel(await db.message(id!), origin));
        if (!action && request.method === "DELETE") {
          await db.remove(id!);
          return new Response(null, {
            status: 204,
            headers: { "cache-control": "no-store" },
          });
        }
        if (action === "opens" && request.method === "GET")
          return json(await db.opens(id!, pagination(url)));
        if (action === "arm" && request.method === "POST")
          return json(await db.arm(id!));
        return json({ error: "method_not_allowed" }, 405);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      // RPC preserves Error messages but not custom properties; use a typed prefix.
      const remote = /^HTTP:(\d{3}):(.+)$/.exec((error as Error).message || "");
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status);
      if (remote) return json({ error: remote[2] }, Number(remote[1]));
      console.error("redpixels: API request failed");
      return json({ error: "internal_error" }, 500);
    }
  },
};

function ownerPage(): Response {
  const nonce = crypto.randomUUID();
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>redpixels · Owner browser</title><style nonce="${nonce}">body{font:17px system-ui;max-width:34rem;margin:12vh auto;padding:24px;line-height:1.6}input,button{font:inherit;padding:10px;box-sizing:border-box}input{width:100%}button{margin-top:12px}h1{color:#c52b30}</style><h1>redpixels</h1><h2>Mark this browser as yours</h2><p>Paste your API token to set a signed owner cookie. The token stays in memory and is cleared after use.</p><form><label>API token <input type="password" autocomplete="off" required minlength="32"></label><button>Mark this browser</button></form><p role="status"></p><p>This only identifies direct image requests carrying this cookie. Gmail and Apple proxies do not forward it. Third-party cookie blocking may also prevent it. Use SELF_IPS for direct mail clients, or create an unarmed pixel until sending.</p><script nonce="${nonce}">document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();const i=document.querySelector('input');const token=i.value;i.value='';try{const r=await fetch('/v1/self',{method:'POST',headers:{Authorization:'Bearer '+token}});document.querySelector('[role=status]').textContent=r.ok?'Owner cookie set.':'Could not set cookie ('+r.status+').';}catch{document.querySelector('[role=status]').textContent='Network error.';}};</script></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
