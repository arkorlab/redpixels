import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  stat,
  chmod,
  symlink,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GMAIL_API,
  GMAIL_SCOPE,
  type CredentialStore,
  type Fetcher,
  type GmailCredential,
  type DraftInput,
} from "../../cli/contracts.mts";
import {
  armDraft,
  createTrackedDraft,
  hasPixel,
  verifyDraft,
} from "../../cli/drafts.mts";
import { runCli } from "../../cli/gmail.mts";
import { FileCredentialStore, OperationStore } from "../../cli/storage.mts";

const origin = "https://pixels.example";
const id = "11111111-1111-4111-8111-111111111111";
const pixel = `${origin}/p/${id}.gif`;
const image = `<img src="${pixel}" width="1" height="1" alt="">`;
const fake: GmailCredential = {
  version: 1,
  clientId: "test.apps.googleusercontent.com",
  clientSecret: "fake-client-secret",
  refreshToken: "fake-refresh-token",
  email: "sender@example.com",
  scopes: [GMAIL_SCOPE],
};
class MemoryCredentials implements CredentialStore {
  value: GmailCredential | null = structuredClone(fake);
  async read() {
    return this.value ? structuredClone(this.value) : null;
  }
  async write(value: GmailCredential) {
    this.value = structuredClone(value);
  }
  async remove() {
    this.value = null;
  }
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function htmlFromMime(raw: string) {
  const mime = Buffer.from(raw, "base64url").toString();
  const boundary = /boundary="([^"]+)"/.exec(mime)![1]!;
  const html = mime.split(`--${boundary}`)[2]!.split("\r\n\r\n")[1]!.trim();
  return Buffer.from(html, "base64").toString();
}
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "redpixels-gmail-test-"));
  const credentials = new MemoryCredentials();
  const operations = new OperationStore(home);
  const calls: { url: string; init?: RequestInit }[] = [];
  const state = {
    stripImage: false,
    createFailure: 0,
    networkFailure: false,
    html: "",
    raw: "",
    created: 0,
    registered: 0,
    armed: 0,
    account: fake.email,
  };
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    assert.ok(
      !url.includes(fake.refreshToken) && !url.includes(fake.clientSecret),
    );
    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get("grant_type"), "refresh_token");
      assert.equal(params.get("refresh_token"), fake.refreshToken);
      return response({
        access_token: "fake-access-token",
        expires_in: 3600,
        scope: GMAIL_SCOPE,
      });
    }
    if (url === `${GMAIL_API}/profile`)
      return response({ emailAddress: state.account });
    if (url === `${origin}/v1/messages`) {
      state.registered++;
      return response({ id, pixel_url: pixel, pixel_html: image }, 201);
    }
    if (url === `${GMAIL_API}/drafts`) {
      state.created++;
      const body = JSON.parse(String(init?.body)) as {
        message: { raw: string };
      };
      assert.deepEqual(Object.keys(body), ["message"]);
      assert.deepEqual(Object.keys(body.message), ["raw"]);
      state.raw = body.message.raw;
      state.html = htmlFromMime(state.raw);
      if (state.networkFailure) throw new Error("network response lost");
      if (state.createFailure)
        return response(
          { error: "example Gmail rejection" },
          state.createFailure,
        );
      return response({ id: "draft-1", message: { id: "message-1" } });
    }
    if (url === `${GMAIL_API}/drafts/draft-1?format=full`) {
      const html = state.stripImage
        ? state.html.replace(/<img[^>]*>/g, "")
        : state.html;
      return response({
        id: "draft-1",
        message: {
          id: "message-1",
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "From", value: fake.email }],
            parts: [
              { mimeType: "text/plain", body: { data: "" } },
              {
                mimeType: "multipart/related",
                parts: [
                  {
                    mimeType: "text/html",
                    body: { data: Buffer.from(html).toString("base64url") },
                  },
                ],
              },
            ],
          },
        },
      });
    }
    if (url === `${origin}/v1/messages/${id}/arm`) {
      state.armed++;
      return response({ id, armed_at: new Date().toISOString() });
    }
    throw new Error(`Unexpected HTTP call: ${url}`);
  };
  const services = {
    fetcher,
    credentials,
    operations,
    tracker: { origin, token: "fake-redpixels-token-with-32-characters" },
  };
  const input: DraftInput = {
    operation: "email-001",
    to: "reader@example.com",
    subject: "日本語 👀",
    html: "<html><body><p>Hello 世界</p></body></html>",
    text: "Hello 世界",
    armed: false,
  };
  return {
    home,
    calls,
    state,
    services,
    input,
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

test("one CLI command registers, sends raw MIME, verifies saved pixel, and returns JSON without secrets", async () => {
  const f = await fixture();
  try {
    const path = join(f.home, "email.html");
    await writeFile(path, f.input.html);
    let output = "";
    const code = await runCli(
      [
        "draft",
        "--to",
        f.input.to,
        "--subject",
        f.input.subject,
        "--html",
        path,
        "--operation",
        f.input.operation,
      ],
      {
        env: {
          REDPIXELS_URL: origin,
          REDPIXELS_API_TOKEN: f.services.tracker.token,
          REDPIXELS_GMAIL_HOME: f.home,
        },
        fetcher: f.services.fetcher,
        credentials: f.services.credentials,
        stdout: (text) => {
          output += text;
        },
      },
    );
    assert.equal(code, 0, output);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    assert.equal(parsed.state, "verified");
    assert.equal(parsed.armed, false);
    assert.equal(parsed.gmail_draft_id, "draft-1");
    assert.equal(parsed.tracking_id, id);
    assert.ok(
      f.state.html.includes(image) && f.state.html.includes("Hello 世界"),
    );
    assert.ok(
      !output.includes(fake.refreshToken) &&
        !output.includes("fake-access-token") &&
        !output.includes(fake.clientSecret) &&
        !output.includes(f.services.tracker.token),
    );
    const registration = f.calls.find(
      (call) => call.url === `${origin}/v1/messages`,
    )!;
    assert.equal(
      (JSON.parse(String(registration.init?.body)) as { armed: boolean }).armed,
      false,
    );
    assert.equal(
      new Headers(registration.init?.headers).get("Idempotency-Key"),
      "gmail-email-001",
    );
    assert.ok(
      !f.calls.some((call) => call.url.includes("/send") || call.url === pixel),
    );
    if (process.platform !== "win32")
      assert.equal(
        (await stat(join(f.home, "operations", "email-001.json"))).mode & 0o777,
        0o600,
      );
  } finally {
    await f.cleanup();
  }
});

test("retries reuse a completed draft; changed input cannot reuse the operation", async () => {
  const f = await fixture();
  try {
    const first = await createTrackedDraft(f.services, f.input);
    assert.deepEqual(await createTrackedDraft(f.services, f.input), first);
    assert.equal(f.state.created, 1);
    assert.equal(f.state.registered, 1);
    await assert.rejects(
      createTrackedDraft(f.services, { ...f.input, html: "<p>Changed</p>" }),
      /different input/,
    );
    assert.equal(f.state.created, 1);
  } finally {
    await f.cleanup();
  }
});

test("connector-style stripping fails closed, retaining IDs for verification and recovery", async () => {
  const f = await fixture();
  try {
    f.state.stripImage = true;
    await assert.rejects(
      createTrackedDraft(f.services, f.input),
      /missing the tracking image/,
    );
    const saved = await f.services.operations.read(f.input.operation);
    assert.equal(saved?.state, "verification_failed");
    assert.equal(saved?.draftId, "draft-1");
    await assert.rejects(
      armDraft(f.services, f.input.operation, true),
      /verified draft/,
    );
    f.state.stripImage = false;
    assert.equal(
      (await verifyDraft(f.services, f.input.operation)).state,
      "verified",
    );
    assert.equal(f.state.created, 1);
    await assert.rejects(
      armDraft(f.services, f.input.operation, false),
      /confirm-sent/,
    );
    const armed = await armDraft(f.services, f.input.operation, true);
    assert.equal(armed.armed, true);
    assert.equal(armed.sent_status, "user_confirmed_not_verified");
    assert.match(armed.next_step, /Tracking is armed/);
    await armDraft(f.services, f.input.operation, true);
    assert.equal(f.state.armed, 1);
  } finally {
    await f.cleanup();
  }
});

for (const failure of ["network", "server"] as const) {
  test(`an ambiguous ${failure} failure never blindly repeats Gmail draft creation`, async () => {
    const f = await fixture();
    try {
      if (failure === "network") f.state.networkFailure = true;
      else f.state.createFailure = 503;
      await assert.rejects(createTrackedDraft(f.services, f.input));
      assert.equal(
        (await f.services.operations.read(f.input.operation))?.state,
        "ambiguous",
      );
      f.state.networkFailure = false;
      f.state.createFailure = 0;
      await assert.rejects(
        createTrackedDraft(f.services, f.input),
        /uncertain/,
      );
      assert.equal(f.state.created, 1);
      assert.equal(
        (await verifyDraft(f.services, f.input.operation, "draft-1")).state,
        "verified",
      );
      assert.equal(f.state.created, 1);
    } finally {
      await f.cleanup();
    }
  });
}
test("a definite Gmail rejection can retry without another tracker registration", async () => {
  const f = await fixture();
  try {
    f.state.createFailure = 400;
    await assert.rejects(createTrackedDraft(f.services, f.input), /HTTP 400/);
    assert.equal(
      (await f.services.operations.read(f.input.operation))?.state,
      "registered",
    );
    f.state.createFailure = 0;
    assert.equal(
      (await createTrackedDraft(f.services, f.input)).state,
      "verified",
    );
    assert.equal(f.state.registered, 1);
    assert.equal(f.state.created, 2);
  } finally {
    await f.cleanup();
  }
});
test("concurrent calls for one operation cannot create duplicate drafts", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([
      createTrackedDraft(f.services, f.input),
      createTrackedDraft(f.services, f.input),
    ]);
    assert.ok(results.some((item) => item.status === "fulfilled"));
    assert.equal(f.state.created, 1);
    assert.equal(f.state.registered, 1);
  } finally {
    await f.cleanup();
  }
});
test("invalid addresses, header injection and path traversal make no HTTP calls", async () => {
  const f = await fixture();
  try {
    for (const input of [
      { ...f.input, subject: "Hi\r\nBcc: attacker@example.com" },
      { ...f.input, to: "a@example.com,b@example.com" },
      { ...f.input, operation: "../escape" },
    ])
      await assert.rejects(createTrackedDraft(f.services, input));
    assert.equal(f.calls.length, 0);
  } finally {
    await f.cleanup();
  }
});
test("a refreshed token for another account is rejected before tracking or Gmail mutation", async () => {
  const f = await fixture();
  try {
    f.state.account = "other@example.com";
    await assert.rejects(
      createTrackedDraft(f.services, f.input),
      /account changed/,
    );
    assert.equal(f.state.registered, 0);
    assert.equal(f.state.created, 0);
  } finally {
    await f.cleanup();
  }
});
test("immediate tracking is an explicit option; malformed HTML cannot hide a missing pixel", async () => {
  const f = await fixture();
  try {
    const value = await createTrackedDraft(f.services, {
      ...f.input,
      armed: true,
    });
    assert.equal(value.armed, true);
    const registered = f.calls.find(
      (call) => call.url === `${origin}/v1/messages`,
    )!;
    assert.equal(
      (JSON.parse(String(registered.init?.body)) as { armed: boolean }).armed,
      true,
    );
    await assert.rejects(
      createTrackedDraft(f.services, {
        ...f.input,
        operation: "bad-html",
        html: "<!-- never closed",
      }),
      /prevents the tracking image/,
    );
    assert.equal(f.state.created, 1);
  } finally {
    await f.cleanup();
  }
});
test("pixel verification distinguishes real images from comments, templates, text and unrelated proxy fragments", () => {
  assert.ok(hasPixel(image, pixel));
  assert.ok(hasPixel(`<IMG SRC='${pixel}'>`, pixel));
  assert.ok(
    hasPixel(
      `<img src="https://ci3.googleusercontent.com/proxy/abc#${encodeURIComponent(pixel)}">`,
      pixel,
    ),
  );
  for (const html of [
    `<!-- ${image} -->`,
    `<script>${image}</script>`,
    `<template>${image}</template>`,
    `&lt;img src="${pixel}"&gt;`,
    `<img src="https://googleusercontent.com.evil.example/p#${pixel}">`,
    `<img src="https://ci3.googleusercontent.com/proxy/abc#${pixel}other">`,
    "<p>No image</p>",
  ])
    assert.equal(hasPixel(html, pixel), false, html);
});
test("file credential storage is private, rejects unsafe permissions/symlinks and removes only its entry", async () => {
  const f = await fixture();
  try {
    const store = new FileCredentialStore(f.home);
    assert.equal(await store.read(), null);
    await store.write(fake);
    assert.deepEqual(await store.read(), fake);
    if (process.platform !== "win32")
      assert.equal((await stat(store.path)).mode & 0o777, 0o600);
    const raw = await readFile(store.path, "utf8");
    assert.ok(!raw.includes("fake-access-token"));
    if (process.platform !== "win32") {
      await chmod(store.path, 0o644);
      await assert.rejects(store.read(), /0600/);
      await chmod(store.path, 0o600);
      await store.remove();
      await symlink(join(f.home, "unrelated.json"), store.path);
      await assert.rejects(store.read());
      await store.remove();
    } else await store.remove();
    assert.equal(await store.read(), null);
  } finally {
    await f.cleanup();
  }
});
test("CLI refuses send commands without accessing credentials or making HTTP calls", async () => {
  let output = "";
  let touched = false;
  const code = await runCli(["send", "--to", "recipient@example.com"], {
    fetcher: async () => {
      touched = true;
      throw new Error("Unexpected call");
    },
    stdout: (text) => {
      output += text;
    },
  });
  assert.equal(code, 1);
  assert.match(output, /no send command/);
  assert.equal(touched, false);
});

test("failed manual recovery preserves the previously verified draft mapping", async () => {
  const f = await fixture();
  try {
    await createTrackedDraft(f.services, f.input);
    const before = await f.services.operations.read(f.input.operation);
    await assert.rejects(
      verifyDraft(f.services, f.input.operation, "wrong-draft"),
    );
    assert.deepEqual(
      await f.services.operations.read(f.input.operation),
      before,
    );
    assert.equal(f.state.created, 1);
  } finally {
    await f.cleanup();
  }
});

test("a corrupt verified journal cannot report success without Gmail IDs and verification time", async () => {
  const f = await fixture();
  try {
    await createTrackedDraft(f.services, f.input);
    const path = join(f.home, "operations", `${f.input.operation}.json`);
    const saved = JSON.parse(await readFile(path, "utf8"));
    for (const field of ["draftId", "gmailMessageId", "verifiedAt"]) {
      const corrupt = { ...saved };
      delete corrupt[field];
      await writeFile(path, JSON.stringify(corrupt));
      await assert.rejects(
        f.services.operations.read(f.input.operation),
        /Invalid draft operation/,
      );
    }
  } finally {
    await f.cleanup();
  }
});
