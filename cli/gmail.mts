import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  object,
  string,
  type CredentialStore,
  type Fetcher,
} from "./contracts.mts";
import {
  armDraft,
  createTrackedDraft,
  result,
  trackerOrigin,
  verifyDraft,
  type DraftServices,
} from "./drafts.mts";
import { authorize, desktopClient } from "./oauth.mts";
import {
  FileCredentialStore,
  KeychainCredentialStore,
  OperationStore,
  gmailHome,
  privateDirectory,
  readPrivateJson,
} from "./storage.mts";

const HELP = `redpixels Gmail CLI — creates drafts, never sends email

pnpm gmail auth login --client /path/to/desktop-oauth-client.json [--no-browser] [--port 8765]
pnpm gmail auth status
pnpm gmail auth logout [--revoke]
pnpm gmail draft --to recipient@example.com --subject 'Hello' --html email.html [--text email.txt] [--operation logical-email-id] [--armed]
pnpm gmail verify --operation ID [--draft-id GMAIL_DRAFT_ID]
pnpm gmail status --operation ID
pnpm gmail arm --operation ID --confirm-sent

Drafts default to unarmed. Review and press Send in Gmail, then arm the operation.
--armed opts into immediate tracking, including draft/Sent preview fetches.
Use a stable --operation for retries; uncertain Gmail writes are never retried blindly.

Environment:
  REDPIXELS_URL              HTTPS origin of your tracking Worker
  REDPIXELS_API_TOKEN        Worker token, or use REDPIXELS_SECRETS_FILE
  REDPIXELS_SECRETS_FILE     Protected JSON with API_TOKEN (default .env.redpixels.json)
  REDPIXELS_GMAIL_HOME       Private local state directory (default OS user-data directory)
  REDPIXELS_GMAIL_TOKEN_STORE  keychain (default), or file (explicit, unencrypted 0600)

Setup and manual tests: docs/gmail-cli.md / docs/gmail-cli.ja.md
`;

interface CliRuntime {
  env?: NodeJS.ProcessEnv;
  fetcher?: Fetcher;
  credentials?: CredentialStore;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}
async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "linux"
        ? "xdg-open"
        : null;
  if (!command) return; // On Windows, use the displayed link in the system browser.
  await new Promise<void>((resolve) => {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" });
    child.once("error", () => resolve());
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
async function inputFile(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 2 * 1024 * 1024)
    throw new Error("Email input must be a regular file of at most 2 MiB");
  return readFile(path, "utf8");
}
async function settings(env: NodeJS.ProcessEnv) {
  const origin = trackerOrigin(string(env.REDPIXELS_URL, "REDPIXELS_URL"));
  let token = env.REDPIXELS_API_TOKEN;
  if (!token) {
    const data = object(
      await readPrivateJson(
        resolve(env.REDPIXELS_SECRETS_FILE || ".env.redpixels.json"),
      ),
    );
    token = string(data.API_TOKEN, "API_TOKEN in secrets JSON");
  }
  if (token.length < 32 || /[\x00-\x20\x7f]/.test(token))
    throw new Error(
      "REDPIXELS_API_TOKEN must be at least 32 characters without whitespace",
    );
  return { origin, token };
}

export async function runCli(
  argv: string[],
  runtime: CliRuntime = {},
): Promise<number> {
  const stdout =
    runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr =
    runtime.stderr ?? ((text: string) => process.stderr.write(text));
  const env = runtime.env ?? process.env;
  const fetcher = runtime.fetcher ?? fetch;
  let operation: string | undefined;
  try {
    if (!argv.length || argv[0] === "--help" || argv[0] === "help") {
      stdout(HELP);
      return 0;
    }
    const [command, ...args] = argv;
    const action = command === "auth" ? args.shift() : command;
    const key = command === "auth" ? `auth ${action}` : command!;
    const allowed: Record<string, string[]> = {
      "auth login": ["client", "no-browser", "port"],
      "auth status": [],
      "auth logout": ["revoke"],
      draft: ["to", "subject", "html", "text", "operation", "armed"],
      verify: ["operation", "draft-id"],
      status: ["operation"],
      arm: ["operation", "confirm-sent"],
    };
    if (!(key in allowed))
      throw new Error(
        "Unknown command. This CLI creates drafts and has no send command. Run pnpm gmail --help",
      );
    let values;
    try {
      ({ values } = parseArgs({
        args,
        allowPositionals: false,
        strict: true,
        options: {
          client: { type: "string" },
          "no-browser": { type: "boolean" },
          port: { type: "string" },
          revoke: { type: "boolean" },
          to: { type: "string" },
          subject: { type: "string" },
          html: { type: "string" },
          text: { type: "string" },
          operation: { type: "string" },
          armed: { type: "boolean" },
          "draft-id": { type: "string" },
          "confirm-sent": { type: "boolean" },
        },
      }));
    } catch {
      throw new Error("Invalid arguments. Run pnpm gmail --help");
    }
    if (Object.keys(values).some((flag) => !allowed[key]!.includes(flag)))
      throw new Error(
        "Option is not supported for this command. Run pnpm gmail --help",
      );
    const home = gmailHome(env);
    const backend = env.REDPIXELS_GMAIL_TOKEN_STORE || "keychain";
    if (!["keychain", "file"].includes(backend))
      throw new Error("REDPIXELS_GMAIL_TOKEN_STORE must be keychain or file");
    const credentials =
      runtime.credentials ??
      (backend === "file"
        ? new FileCredentialStore(home)
        : new KeychainCredentialStore(home));
    const operations = new OperationStore(home);
    const emit = (value: unknown) => stdout(`${JSON.stringify(value)}\n`);
    if (key === "auth login") {
      const client = desktopClient(
        await readPrivateJson(string(values.client, "--client")),
      );
      await privateDirectory(home);
      const port = values.port === undefined ? 0 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error("--port must be an integer from 0 to 65535");
      if (backend === "file")
        stderr(
          "Using an explicit unencrypted token file protected by OS permissions.\n",
        );
      const credential = await authorize({
        client,
        fetcher,
        port,
        onAuthorize: async (url) => {
          stderr(
            `Open this link in your system browser and approve Gmail draft access:\n${url}\n`,
          );
          if (!values["no-browser"]) await openBrowser(url);
        },
      });
      await credentials.write(credential);
      emit({
        connected: true,
        account: credential.email,
        token_store: backend,
        state_directory: home,
        scope: credential.scopes,
      });
      return 0;
    }
    if (key === "auth status") {
      const credential = await credentials.read();
      emit({
        connected: !!credential,
        account: credential?.email ?? null,
        token_store: backend,
        state_directory: home,
      });
      return 0;
    }
    if (key === "auth logout") {
      if (values.revoke) {
        const credential = await credentials.read();
        if (credential) {
          const response = await fetcher(
            "https://oauth2.googleapis.com/revoke",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token: credential.refreshToken,
              }).toString(),
              redirect: "error",
              signal: AbortSignal.timeout(30000),
            },
          ).catch(() => {
            throw new Error(
              "Google revocation failed; local credentials retained",
            );
          });
          await response.body?.cancel();
          if (!response.ok)
            throw new Error(
              "Google revocation was not accepted; local credentials retained",
            );
        }
      }
      await credentials.remove();
      emit({ connected: false, revoked: !!values.revoke });
      return 0;
    }
    operation =
      values.operation || (command === "draft" ? randomUUID() : undefined);
    if (!operation) throw new Error("Provide --operation");
    if (key === "status") {
      const saved = await operations.read(operation);
      if (!saved) throw new Error("Unknown operation");
      emit(result(saved));
      return 0;
    }
    const services: DraftServices = {
      fetcher,
      credentials,
      operations,
      tracker: await settings(env),
    };
    if (key === "draft") {
      emit(
        await createTrackedDraft(services, {
          operation,
          to: string(values.to, "--to"),
          subject: string(values.subject, "--subject"),
          html: await inputFile(string(values.html, "--html")),
          text: values.text ? await inputFile(values.text) : "",
          armed: values.armed === true,
        }),
      );
    } else if (key === "verify") {
      emit(await verifyDraft(services, operation, values["draft-id"]));
    } else if (key === "arm") {
      emit(
        await armDraft(services, operation, values["confirm-sent"] === true),
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail CLI failed";
    stdout(
      `${JSON.stringify({ error: message, ...(operation ? { operation } : {}) })}\n`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runCli(process.argv.slice(2));
