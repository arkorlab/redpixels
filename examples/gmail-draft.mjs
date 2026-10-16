// Creates a Gmail draft; never sends an email. Node.js 22+, no dependencies.
import { readFile } from "node:fs/promises";
import { createMime } from "./mime.mjs";

for (const name of [
  "REDPIXELS_URL",
  "REDPIXELS_API_TOKEN",
  "GMAIL_ACCESS_TOKEN",
  "GMAIL_FROM",
  "GMAIL_TO",
  "GMAIL_SUBJECT",
])
  if (!process.env[name]) throw new Error(`Set ${name}`);
if (!process.argv[2])
  throw new Error("Usage: node examples/gmail-draft.mjs path/to/email.html");
for (const name of ["GMAIL_FROM", "GMAIL_TO", "GMAIL_SUBJECT"])
  if (/[\r\n]/.test(process.env[name])) throw new Error(`Newline in ${name}`);

const base = new URL(process.env.REDPIXELS_URL);
if (base.protocol !== "https:" || base.username || base.password)
  throw new Error("REDPIXELS_URL must be HTTPS");
const html = await readFile(process.argv[2], "utf8");
const registered = await fetch(new URL("/v1/messages", base), {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.REDPIXELS_API_TOKEN}`,
    "Content-Type": "application/json",
    "Idempotency-Key":
      process.env.REDPIXELS_IDEMPOTENCY_KEY || crypto.randomUUID(),
  },
  body: JSON.stringify({
    recipient: process.env.GMAIL_TO,
    subject: process.env.GMAIL_SUBJECT,
  }),
});
if (!registered.ok)
  throw new Error(`redpixels registration failed (${registered.status})`);
const message = await registered.json();
console.log(`redpixels message: ${message.id}`);
const mime = createMime({
  from: process.env.GMAIL_FROM,
  to: process.env.GMAIL_TO,
  subject: process.env.GMAIL_SUBJECT,
  text: process.env.GMAIL_TEXT || "",
  html,
  pixelHtml: message.pixel_html,
});
const response = await fetch(
  "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GMAIL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { raw: Buffer.from(mime).toString("base64url") },
    }),
  },
);
if (!response.ok)
  throw new Error(
    `Gmail draft creation failed (${response.status}); redpixels id above is retained for recovery`,
  );
const draft = await response.json();
console.log(`Gmail draft: ${draft.id}`);
console.log(
  "Open Gmail Drafts to review and send. Mobile HTML preservation must be tested on your device.",
);
