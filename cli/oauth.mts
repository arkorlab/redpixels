import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import {
  GMAIL_API,
  GMAIL_SCOPE,
  email,
  object,
  requestJson,
  string,
  type CredentialStore,
  type Fetcher,
  type GmailCredential,
  type OAuthClient,
} from "./contracts.mts";

export function desktopClient(value: unknown): OAuthClient {
  const data = object(object(value).installed);
  const clientId = string(data.client_id, "Desktop OAuth client ID");
  if (!/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new Error("Use a Google Desktop app OAuth client JSON");
  return {
    clientId,
    clientSecret: string(data.client_secret, "OAuth client secret"),
  };
}
function scopes(value: unknown): string[] {
  const result = string(value, "granted OAuth scopes").split(/\s+/);
  if (!result.includes(GMAIL_SCOPE))
    throw new Error(
      "Gmail compose permission was not granted; authorize again",
    );
  return result;
}
function googleClient(
  client: OAuthClient,
  fetcher: Fetcher,
  redirectUri?: string,
) {
  return new OAuth2Client({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri,
    transporterOptions: {
      timeout: 30000,
      fetchImplementation: (input, init) =>
        fetcher(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          {
            ...init,
            redirect: "error",
            signal: init?.signal ?? AbortSignal.timeout(30000),
          },
        ),
    },
  });
}
export async function accountEmail(
  fetcher: Fetcher,
  accessToken: string,
): Promise<string> {
  const profile = await requestJson(
    fetcher,
    `${GMAIL_API}/profile`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    "Gmail profile",
  );
  return email(profile.emailAddress);
}
export interface LoginOptions {
  client: OAuthClient;
  fetcher: Fetcher;
  onAuthorize: (url: string) => void | Promise<void>;
  port?: number;
  timeoutMs?: number;
}

/** Desktop-only PKCE + state flow. No OOB code copy/paste or Gmail device-code flow. */
export async function authorize(
  options: LoginOptions,
): Promise<GmailCredential> {
  const pkce = await new OAuth2Client().generateCodeVerifierAsync();
  const state = randomBytes(32).toString("base64url");
  let redirectUri = "";
  let processing = false;
  let resolveCode!: (value: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Attach a handler immediately, including while the URL is being opened.
  void codePromise.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(request.url || "/", redirectUri);
    if (
      request.method !== "GET" ||
      url.pathname !== "/oauth/callback" ||
      request.headers.host !== new URL(redirectUri).host
    ) {
      response.writeHead(404).end("Not found");
      return;
    }
    const returnedState = url.searchParams.get("state") || "";
    if (
      url.searchParams.getAll("state").length !== 1 ||
      !timingSafeEqual(
        createHash("sha256").update(returnedState).digest(),
        createHash("sha256").update(state).digest(),
      )
    ) {
      response
        .writeHead(400)
        .end("Invalid OAuth state; return to the original login link.");
      return;
    }
    if (processing) {
      response.writeHead(409).end("Callback already received");
      return;
    }
    if (url.searchParams.has("error")) {
      processing = true;
      response
        .writeHead(400)
        .end("Authorization denied. Return to your terminal.");
      rejectCode(new Error("Gmail authorization was denied"));
      return;
    }
    const code = url.searchParams.get("code");
    if (
      !code ||
      code.length > 4096 ||
      url.searchParams.getAll("code").length !== 1
    ) {
      response.writeHead(400).end("Missing or invalid authorization code");
      return;
    }
    processing = true;
    response.end(
      "Authorization received. Return to your terminal to finish setup.",
    );
    resolveCode(code);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not bind OAuth callback");
    redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
    timer = setTimeout(
      () =>
        rejectCode(new Error("Gmail login timed out; run auth login again")),
      options.timeoutMs ?? 300000,
    );
    const client = googleClient(options.client, options.fetcher, redirectUri);
    const url = client.generateAuthUrl({
      scope: GMAIL_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    await options.onAuthorize(url);
    const code = await codePromise;
    let token;
    try {
      ({ tokens: token } = await client.getToken({
        code,
        codeVerifier: pkce.codeVerifier,
      }));
    } catch {
      throw new Error(
        "Google OAuth exchange failed; check the Desktop client, Gmail API enablement and consent",
      );
    }
    const accessToken = string(token.access_token, "OAuth access token");
    const granted = scopes(token.scope);
    const refreshToken = string(
      token.refresh_token,
      "refresh token; consent with offline access again",
    );
    return {
      version: 1,
      ...options.client,
      email: await accountEmail(options.fetcher, accessToken),
      refreshToken,
      scopes: granted,
    };
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Refresh only in memory. Tokens never enter Worker bindings, URLs, stdout or journals. */
export async function access(
  store: CredentialStore,
  fetcher: Fetcher,
): Promise<{ accessToken: string; credential: GmailCredential }> {
  const credential = await store.read();
  if (!credential)
    throw new Error(
      "Gmail is not connected; run pnpm gmail auth login --client PATH",
    );
  const client = googleClient(credential, fetcher);
  client.setCredentials({ refresh_token: credential.refreshToken });
  let rotatedRefresh = credential.refreshToken;
  client.on("tokens", (token) => {
    if (token.refresh_token) rotatedRefresh = token.refresh_token;
  });
  let result;
  try {
    ({ credentials: result } = await client.refreshAccessToken());
  } catch {
    throw new Error(
      "Google OAuth refresh failed; run auth login again if access was revoked or the testing grant expired",
    );
  }
  if (result.scope !== undefined) scopes(result.scope);
  const accessToken = string(result.access_token, "OAuth access token");
  const actualEmail = await accountEmail(fetcher, accessToken);
  if (actualEmail.toLowerCase() !== credential.email.toLowerCase())
    throw new Error(
      "Authenticated Gmail account changed; authorize the intended account again",
    );
  if (rotatedRefresh !== credential.refreshToken) {
    credential.refreshToken = rotatedRefresh;
    await store.write(credential);
  }
  return { accessToken, credential };
}
