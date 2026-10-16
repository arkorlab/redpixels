import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  GMAIL_API,
  GMAIL_SCOPE,
  type Fetcher,
  type GmailCredential,
  type CredentialStore,
} from "../../cli/contracts.mts";
import { access, authorize, desktopClient } from "../../cli/oauth.mts";

const client = {
  clientId: "test.apps.googleusercontent.com",
  clientSecret: "fake-desktop-secret",
};
const credential: GmailCredential = {
  version: 1,
  ...client,
  email: "sender@example.com",
  refreshToken: "fake-refresh",
  scopes: [GMAIL_SCOPE],
};
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
test("Google SDK uses PKCE S256/offline consent, rejects incorrect state, and exchanges a valid loopback callback", async () => {
  let authorization!: URL;
  let exchanges = 0;
  const fetcher: Fetcher = async (url, init) => {
    if (url === `${GMAIL_API}/profile`)
      return response({ emailAddress: credential.email });
    assert.equal(url, "https://oauth2.googleapis.com/token");
    exchanges++;
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("client_id"), client.clientId);
    assert.equal(body.get("client_secret"), client.clientSecret);
    assert.equal(body.get("code"), "fake-code");
    assert.equal(
      body.get("redirect_uri"),
      authorization.searchParams.get("redirect_uri"),
    );
    assert.equal(
      createHash("sha256")
        .update(body.get("code_verifier")!)
        .digest("base64url"),
      authorization.searchParams.get("code_challenge"),
    );
    return response({
      access_token: "fake-access",
      refresh_token: "fake-refresh",
      expires_in: 3600,
      scope: GMAIL_SCOPE,
    });
  };
  const saved = await authorize({
    client,
    fetcher,
    timeoutMs: 5000,
    onAuthorize: async (url) => {
      authorization = new URL(url);
      assert.equal(authorization.origin, "https://accounts.google.com");
      assert.equal(authorization.searchParams.get("scope"), GMAIL_SCOPE);
      assert.equal(authorization.searchParams.get("access_type"), "offline");
      assert.equal(authorization.searchParams.get("prompt"), "consent");
      assert.equal(
        authorization.searchParams.get("code_challenge_method"),
        "S256",
      );
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      assert.equal(callback.hostname, "127.0.0.1");
      callback.search = new URLSearchParams({
        state: "wrong",
        code: "fake-code",
      }).toString();
      const rejected = await fetch(callback);
      assert.equal(rejected.status, 400);
      await rejected.text();
      assert.equal(exchanges, 0);
      callback.searchParams.set(
        "state",
        authorization.searchParams.get("state")!,
      );
      const accepted = await fetch(callback);
      assert.equal(accepted.status, 200);
      await accepted.text();
    },
  });
  assert.deepEqual(saved, credential);
  assert.ok(!JSON.stringify(saved).includes("fake-access"));
  assert.equal(exchanges, 1);
});
test("denied consent stops without exchanging a token", async () => {
  let called = false;
  await assert.rejects(
    authorize({
      client,
      fetcher: async () => {
        called = true;
        throw new Error("Unexpected token call");
      },
      onAuthorize: async (url) => {
        const authorization = new URL(url);
        const callback = new URL(
          authorization.searchParams.get("redirect_uri")!,
        );
        callback.search = new URLSearchParams({
          state: authorization.searchParams.get("state")!,
          error: "access_denied",
        }).toString();
        const denied = await fetch(callback);
        assert.equal(denied.status, 400);
        await denied.text();
      },
    }),
    /denied/,
  );
  assert.equal(called, false);
});
for (const missing of ["scope", "refresh"] as const) {
  test(`missing ${missing} prevents OAuth setup from being reported as connected`, async () => {
    let profiles = 0;
    await assert.rejects(
      authorize({
        client,
        fetcher: async (url) => {
          if (url.endsWith("/profile")) {
            profiles++;
            return response({ emailAddress: credential.email });
          }
          return response({
            access_token: "fake-access",
            expires_in: 3600,
            scope: missing === "scope" ? "openid" : GMAIL_SCOPE,
            ...(missing === "refresh" ? {} : { refresh_token: "fake-refresh" }),
          });
        },
        onAuthorize: async (url) => {
          const authorization = new URL(url);
          const callback = new URL(
            authorization.searchParams.get("redirect_uri")!,
          );
          callback.search = new URLSearchParams({
            state: authorization.searchParams.get("state")!,
            code: "fake",
          }).toString();
          await (await fetch(callback)).text();
        },
      }),
      missing === "scope" ? /permission was not granted/ : /refresh token/,
    );
    assert.equal(profiles, 0);
  });
}
test("OAuth callback timeout closes the local server without network requests", async () => {
  await assert.rejects(
    authorize({
      client,
      timeoutMs: 30,
      onAuthorize: () => {},
      fetcher: async () => {
        throw new Error("Should not be called");
      },
    }),
    /timed out/,
  );
});
test("SDK refresh persists rotated refresh tokens and checks the authenticated identity", async () => {
  let stored = structuredClone(credential);
  const vault: CredentialStore = {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
    remove: async () => {},
  };
  const refreshed = await access(vault, async (url, init) => {
    if (url === `${GMAIL_API}/profile`) {
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer fake-new-access",
      );
      return response({ emailAddress: credential.email });
    }
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("refresh_token"), credential.refreshToken);
    return response({
      access_token: "fake-new-access",
      refresh_token: "fake-rotated-refresh",
      scope: GMAIL_SCOPE,
      expires_in: 3600,
    });
  });
  assert.equal(refreshed.accessToken, "fake-new-access");
  assert.equal(stored.refreshToken, "fake-rotated-refresh");
  assert.ok(!JSON.stringify(stored).includes("fake-new-access"));
});
test("OAuth errors never reveal SDK request bodies, credentials or provider error content", async () => {
  const vault: CredentialStore = {
    read: async () => credential,
    write: async () => {},
    remove: async () => {},
  };
  await assert.rejects(
    access(vault, async () =>
      response(
        {
          error: "invalid_grant",
          error_description: `${client.clientSecret} ${credential.refreshToken}`,
        },
        400,
      ),
    ),
    (error: Error) => {
      assert.match(error.message, /refresh failed/);
      assert.ok(!error.message.includes(client.clientSecret));
      assert.ok(!error.message.includes(credential.refreshToken));
      return true;
    },
  );
});
test("only Desktop client JSON is accepted and downloaded endpoint overrides are ignored", () => {
  assert.throws(() =>
    desktopClient({
      web: { client_id: client.clientId, client_secret: client.clientSecret },
    }),
  );
  assert.deepEqual(
    desktopClient({
      installed: {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        auth_uri: "https://evil.example",
        token_uri: "https://evil.example",
      },
    }),
    client,
  );
});
