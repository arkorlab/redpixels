import { env } from "cloudflare:workers";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import {
  classify,
  config,
  eligible,
  hmac,
  normalizeIp,
  relTime,
} from "../src/lib.js";

const token = "test-only-token-with-at-least-32-characters";
const hookSecret = "a-different-webhook-secret-at-least-32-characters";
const db = () => env.TRACKER.get(env.TRACKER.idFromName("self-hosted:v1"));
function api(
  path,
  { method = "GET", body, auth = token, headers = {}, bindings = {} } = {},
) {
  return worker.fetch(
    new Request(`https://redpixels.example${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    }),
    { ...env, ...bindings },
  );
}
async function register(body = {}, headers = {}) {
  const response = await api("/v1/messages", { method: "POST", body, headers });
  expect([200, 201]).toContain(response.status);
  return response.json();
}
function pixel(id, headers = {}, method = "GET", bindings = {}) {
  return worker.fetch(
    new Request(`https://redpixels.example/p/${id}.gif`, { method, headers }),
    { ...env, ...bindings },
  );
}
async function history(id, query = "") {
  return (await api(`/v1/messages/${id}/opens${query}`)).json();
}
async function hookSettings(settings = {}) {
  await runInDurableObject(db(), (instance) => {
    instance.settings = {
      ...env,
      WEBHOOK_URL: "https://hooks.example/open",
      WEBHOOK_SECRET: hookSecret,
      ...settings,
    };
  });
}
async function drain() {
  await runInDurableObject(db(), async (instance, state) => {
    instance.sql.exec(
      "UPDATE outbox SET next_attempt = 0 WHERE status = 'pending'",
    );
    await state.storage.deleteAlarm();
    await instance.alarm();
  });
}

beforeEach(async () => {
  await reset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

describe("authenticated API and registration", () => {
  it("protects registration, lists, individual history, deletion, arming and self setup", async () => {
    const m = await register();
    for (const [path, method] of [
      ["/v1/messages", "GET"],
      ["/v1/messages", "POST"],
      [`/v1/messages/${m.id}`, "GET"],
      [`/v1/messages/${m.id}`, "DELETE"],
      [`/v1/messages/${m.id}/opens`, "GET"],
      [`/v1/messages/${m.id}/arm`, "POST"],
      ["/v1/self", "POST"],
    ]) {
      expect((await api(path, { method, auth: null })).status).toBe(401);
      expect((await api(path, { method, auth: "wrong" })).status).toBe(401);
    }
    expect(
      (await api("/v1/messages", { bindings: { API_TOKEN: "" } })).status,
    ).toBe(503);
  });
  it("issues unguessable unique ids and embeddable URLs without exposing metadata publicly", async () => {
    const first = await register({
      recipient: "alice@example.com",
      subject: "Hello 世界",
    });
    const second = await register();
    expect(first.id).not.toBe(second.id);
    expect(first.pixel_html).toContain(
      `https://redpixels.example/p/${first.id}.gif`,
    );
    expect(first.recipient).toBe("alice@example.com");
    expect(first.open_count).toBe(0);
    expect(
      (
        await api(`/v1/messages/${first.id}`, {
          bindings: { PUBLIC_BASE_URL: "https://pixels.example" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await (
          await api(`/v1/messages/${first.id}`, {
            bindings: { PUBLIC_BASE_URL: "https://pixels.example" },
          })
        ).json()
      ).pixel_url,
    ).toMatch(/^https:\/\/pixels.example\//);
  });
  it("makes registration retries idempotent and rejects changed metadata", async () => {
    const headers = { "idempotency-key": "draft-operation-123" };
    const [a, b] = await Promise.all([
      register({ subject: "Hi" }, headers),
      register({ subject: "Hi" }, headers),
    ]);
    expect(a.id).toBe(b.id);
    expect(
      (
        await api("/v1/messages", {
          method: "POST",
          body: { subject: "Changed" },
          headers,
        })
      ).status,
    ).toBe(409);
  });
  it("rejects malformed JSON, invalid fields, oversized bodies and wrong content types", async () => {
    for (const body of [
      "{",
      "null",
      "[]",
      { armed: "false" },
      { subject: 123 },
      { recipient: "x".repeat(1001) },
      { id: "chosen" },
    ])
      expect((await api("/v1/messages", { method: "POST", body })).status).toBe(
        400,
      );
    expect(
      (
        await api("/v1/messages", {
          method: "POST",
          body: { subject: "x".repeat(17000) },
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await api("/v1/messages", {
          method: "POST",
          body: {},
          headers: { "content-type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await api("/v1/messages", {
          method: "POST",
          body: {},
          headers: { "idempotency-key": "short" },
        })
      ).status,
    ).toBe(400);
  });
  it("paginates message lists including messages with no fetches", async () => {
    const a = await register();
    const b = await register();
    const c = await register();
    const page = await (await api("/v1/messages?limit=2")).json();
    expect(page.messages.map((m) => m.id)).toEqual([a.id, b.id]);
    const next = await (
      await api(`/v1/messages?after=${page.next_after}&limit=2`)
    ).json();
    expect(next.messages.map((m) => m.id)).toEqual([c.id]);
    expect(next.next_after).toBeNull();
    for (const query of [
      "limit=0",
      "limit=501",
      "after=-1",
      "after=nope",
      "after=9007199254740992",
    ])
      expect((await api(`/v1/messages?${query}`)).status).toBe(400);
  });
});

describe("durable open history", () => {
  it("returns a transparent GIF with no-cache headers; HEAD and unknown ids do not record", async () => {
    const m = await register();
    const r = await pixel(m.id);
    expect(r.headers.get("content-type")).toBe("image/gif");
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(new TextDecoder().decode((await r.arrayBuffer()).slice(0, 6))).toBe(
      "GIF89a",
    );
    expect((await pixel(m.id, {}, "HEAD")).body).toBeNull();
    await pixel(crypto.randomUUID());
    expect((await history(m.id)).message.open_count).toBe(1);
    expect(
      (await api("/v1/messages").then((r) => r.json())).messages,
    ).toHaveLength(1);
    expect((await pixel(m.id, {}, "POST")).status).toBe(405);
  });
  it("records every received GET and keeps counts exact under concurrency", async () => {
    const m = await register();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        pixel(m.id, { "user-agent": "GoogleImageProxy" }),
      ),
    );
    const page = await history(m.id, "?limit=7");
    expect(page.message.open_count).toBe(20);
    expect(page.opens).toHaveLength(7);
    const all = [...page.opens];
    let after = page.next_after;
    while (after !== null) {
      const next = await history(m.id, `?limit=7&after=${after}`);
      all.push(...next.opens);
      after = next.next_after;
    }
    expect(all.map((o) => o.open_number)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(new Set(all.map((o) => o.event_id)).size).toBe(20);
    expect(all.every((o) => o.flags.includes("google_image_proxy"))).toBe(true);
    expect(all[0].ago).toBe("just now");
  });
  it("preserves history across object eviction", async () => {
    const m = await register();
    await pixel(m.id);
    await evictDurableObject(db());
    await pixel(m.id);
    expect((await history(m.id)).message.open_count).toBe(2);
  });
  it("deletes metadata, fetches and pending webhooks and stops recording deleted ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    await hookSettings();
    const m = await register();
    await pixel(m.id);
    expect(
      (await api(`/v1/messages/${m.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    await pixel(m.id);
    expect((await api(`/v1/messages/${m.id}/opens`)).status).toBe(404);
    expect(
      await runInDurableObject(
        db(),
        (i) => i.sql.exec("SELECT COUNT(*) AS n FROM outbox").one().n,
      ),
    ).toBe(0);
  });
  it("keeps pre-send fetches, and arming is idempotent", async () => {
    const m = await register({ armed: false });
    await pixel(m.id);
    expect((await history(m.id)).opens[0].flags).toContain("before_armed");
    expect((await history(m.id)).message.eligible_open_count).toBe(0);
    const first = await (
      await api(`/v1/messages/${m.id}/arm`, { method: "POST" })
    ).json();
    const second = await (
      await api(`/v1/messages/${m.id}/arm`, { method: "POST" })
    ).json();
    expect(first.armed_at).toBe(second.armed_at);
    await pixel(m.id);
    expect((await history(m.id)).message.eligible_open_count).toBe(1);
  });
  it("flags exact owner IPs, signed cookies and authenticated owner requests", async () => {
    const m = await register();
    await pixel(m.id, { "cf-connecting-ip": "2001:0db8:0:0:0:0:0:1" }, "GET", {
      SELF_IPS: "2001:db8::1",
    });
    const owner = await api("/v1/self", { method: "POST" });
    const cookie = owner.headers.get("set-cookie").split(";")[0];
    expect(owner.headers.get("set-cookie")).toContain("HttpOnly; Secure");
    await pixel(m.id, { cookie });
    await pixel(m.id, { authorization: `Bearer ${token}` });
    await pixel(m.id, { cookie: "redpixels_self=1999999999.forged" });
    const page = await history(m.id);
    expect(page.opens.map((o) => o.flags)).toEqual([
      ["self_ip"],
      ["self_cookie"],
      ["self_authenticated"],
      [],
    ]);
    expect(page.message.open_count).toBe(4);
    expect(page.message.eligible_open_count).toBe(1);
  });
});

describe("signed durable webhooks", () => {
  it("recovers persisted notification jobs after object eviction", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 200 }));
    await hookSettings();
    const m = await register();
    await runInDurableObject(db(), async (instance, state) => {
      await instance.record(m.id, {
        ua: "",
        purpose: "",
        country: null,
        self: null,
      });
      instance.sql.exec(
        "UPDATE outbox SET next_attempt = ?",
        Date.now() + 60000,
      );
      await state.storage.setAlarm(Date.now() + 60000);
    });
    await evictDurableObject(db());
    await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await history(m.id)).opens[0].webhook.status).toBe("delivered");
  });

  it("rolls back the fetch, counts and outbox if scheduling cannot commit", async () => {
    await hookSettings();
    const m = await register();
    await runInDurableObject(db(), async (instance) => {
      const schedule = instance.schedule;
      instance.schedule = async () => {
        throw new Error("simulated storage failure");
      };
      try {
        await expect(
          instance.record(m.id, {
            ua: "",
            purpose: "",
            country: null,
            self: null,
          }),
        ).rejects.toThrow("simulated storage failure");
      } finally {
        instance.schedule = schedule;
      }
      expect(
        instance.sql.exec("SELECT COUNT(*) AS n FROM outbox").one().n,
      ).toBe(0);
    });
    const page = await history(m.id);
    expect(page.message.open_count).toBe(0);
    expect(page.message.webhook_count).toBe(0);
    expect(page.opens).toEqual([]);
  });

  it("atomically enqueues exactly one first notification during concurrent opens", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 200 }));
    await hookSettings({ WEBHOOK_MODE: "first" });
    const m = await register();
    await Promise.all(Array.from({ length: 12 }, () => pixel(m.id)));
    await drain();
    expect((await history(m.id)).message.open_count).toBe(12);
    expect((await history(m.id)).message.webhook_count).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://hooks.example/open");
    expect(init.redirect).toBe("manual");
    expect(init.headers["x-redpixels-signature"]).toBe(
      `v1=${await hmac(hookSecret, `${init.headers["x-redpixels-timestamp"]}.${init.body}`)}`,
    );
    expect(JSON.parse(init.body).event_id).toBe(
      init.headers["x-redpixels-event-id"],
    );
    expect((await history(m.id)).opens[0].webhook.status).toBe("delivered");
  });
  it("every mode retains and notifies every eligible fetch", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 204 }));
    await hookSettings();
    const m = await register();
    for (let i = 0; i < 3; i++) await pixel(m.id);
    await drain();
    expect(send).toHaveBeenCalledTimes(3);
    expect(
      new Set(send.mock.calls.map(([, init]) => JSON.parse(init.body).event_id))
        .size,
    ).toBe(3);
  });
  it("first means first qualifying fetch; before-send and owner requests do not consume it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
    await hookSettings({ WEBHOOK_MODE: "first", WEBHOOK_FILTER: "unflagged" });
    const m = await register({ armed: false });
    await pixel(m.id);
    await api(`/v1/messages/${m.id}/arm`, { method: "POST" });
    await pixel(m.id, { authorization: `Bearer ${token}` });
    await pixel(m.id, { "user-agent": "Mozilla/5.0" });
    await pixel(m.id, { "sec-purpose": "prefetch" });
    await pixel(m.id, { "user-agent": "GoogleImageProxy" });
    await drain();
    const page = await history(m.id);
    expect(page.message.open_count).toBe(5);
    expect(page.message.webhook_count).toBe(1);
    expect(page.opens.at(-1).webhook.status).toBe("delivered");
    expect(page.opens.slice(0, 4).every((o) => o.webhook === null)).toBe(true);
  });
  it.each([408, 429, 500, 503, "network"])(
    "retries %s with the same event id and body",
    async (failure) => {
      const send = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(async () => {
          if (failure === "network") throw new Error("connection lost");
          return new Response(null, { status: failure });
        })
        .mockImplementation(async () => new Response(null, { status: 200 }));
      await hookSettings();
      const m = await register();
      await pixel(m.id);
      await drain();
      await drain();
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1].body).toBe(send.mock.calls[1][1].body);
      expect(send.mock.calls[0][1].headers["x-redpixels-event-id"]).toBe(
        send.mock.calls[1][1].headers["x-redpixels-event-id"],
      );
      expect((await history(m.id)).opens[0].webhook.status).toBe("delivered");
    },
  );
  it.each([400, 401, 302])(
    "does not retry permanent status %s or follow redirects",
    async (status) => {
      const send = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => new Response(null, { status }));
      await hookSettings();
      const m = await register();
      await pixel(m.id);
      await drain();
      await drain();
      expect(send).toHaveBeenCalledTimes(1);
      expect((await history(m.id)).opens[0].webhook).toMatchObject({
        status: "failed",
        attempts: 1,
        last_status: status,
      });
    },
  );
  it("bounds retry attempts and clears the alarm when no work remains", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(null, { status: 503 }),
    );
    await hookSettings();
    const m = await register();
    await pixel(m.id);
    for (let i = 0; i < 9; i++) await drain();
    expect((await history(m.id)).opens[0].webhook).toMatchObject({
      status: "failed",
      attempts: 8,
    });
    expect(
      await runInDurableObject(db(), (_, state) => state.storage.getAlarm()),
    ).toBeNull();
  });
});

describe("classification is evidence, not proof of reading", () => {
  it("distinguishes Gmail proxies, possible MPP, early fetches and prefetch evidence", () => {
    const cfg = config({ API_TOKEN: token });
    const input = {
      ua: "GoogleImageProxy",
      purpose: "",
      self: null,
      armedAt: 1000,
      now: 1001,
    };
    expect(classify(input, cfg)).toEqual(["google_image_proxy", "early_fetch"]);
    expect(classify({ ...input, ua: "Mozilla/5.0", now: 100000 }, cfg)).toEqual(
      ["possible_apple_mpp"],
    );
    expect(
      classify(
        {
          ...input,
          ua: "Mozilla/5.0 AppleWebKit/605.1.15 Safari/605.1.15",
          now: 100000,
        },
        cfg,
      ),
    ).toEqual([]);
    expect(eligible(["google_image_proxy"], "unflagged")).toBe(true);
    expect(eligible(["possible_apple_mpp"], "unflagged")).toBe(false);
    expect(eligible(["early_fetch"], "all")).toBe(true);
    expect(eligible(["self_cookie"], "all")).toBe(false);
  });
  it("validates configuration instead of silently weakening auth or signatures", () => {
    for (const values of [
      { API_TOKEN: "short" },
      { WEBHOOK_URL: "http://insecure.example" },
      { WEBHOOK_URL: "https://hooks.example", WEBHOOK_SECRET: "" },
      { WEBHOOK_MODE: "once" },
      { WEBHOOK_FILTER: "human" },
      { SELF_WINDOW_SECONDS: "NaN" },
      { SELF_IPS: "1.2.3.999" },
      { PUBLIC_BASE_URL: "https://user:password@example.com" },
    ])
      expect(() => config({ API_TOKEN: token, ...values })).toThrow();
    expect(normalizeIp("2001:0db8::1")).toBe("2001:db8::1");
  });
  it("formats every event's relative time", () => {
    expect(relTime(0, 2 * 86400000)).toBe("2 days ago");
    expect(relTime(0, 5 * 3600000)).toBe("5 hours ago");
  });
});
