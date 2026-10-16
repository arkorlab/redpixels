import { test } from "node:test";
import assert from "node:assert/strict";
import { createMime } from "../../examples/mime.mts";

const input = {
  from: "me@example.com",
  to: "alice@example.com",
  subject: "日本語の件名 👀".repeat(20),
  text: "Hello 世界",
  html: "<html><body><p>Hello 世界</p></body></html>",
  pixelHtml: '<img src="https://pixels.example/p/id.gif" width="1" height="1">',
};
test("MIME keeps the remote pixel inside the HTML part through base64url transport", () => {
  const mime = createMime(input);
  assert.equal(
    Buffer.from(
      Buffer.from(mime).toString("base64url"),
      "base64url",
    ).toString(),
    mime,
  );
  const boundary = /boundary="([^"]+)"/.exec(mime)![1]!;
  const parts = mime.split(`--${boundary}`);
  const html = Buffer.from(
    parts[2]!.split("\r\n\r\n")[1]!.trim(),
    "base64",
  ).toString("utf8");
  const plain = Buffer.from(
    parts[1]!.split("\r\n\r\n")[1]!.trim(),
    "base64",
  ).toString("utf8");
  assert.equal(plain, input.text);
  assert.equal(
    html,
    input.html.replace("</body>", `${input.pixelHtml}</body>`),
  );
  const words = [...mime.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)];
  assert.equal(
    words.map((m) => Buffer.from(m[1]!, "base64").toString()).join(""),
    input.subject,
  );
  assert.ok(words.every((m) => m[0].length <= 75));
  assert.ok(mime.split("\r\n").every((line) => line.length <= 998));
});
test("supports HTML fragments and rejects header injection", () => {
  const mime = createMime({ ...input, html: "<p>fragment</p>" });
  assert.ok(
    mime.includes(
      Buffer.from(`<p>fragment</p>${input.pixelHtml}`)
        .toString("base64")
        .slice(0, 60),
    ),
  );
  for (const field of ["from", "to", "subject"])
    assert.throws(() =>
      createMime({ ...input, [field]: "value\r\nBcc: attacker@example.com" }),
    );
});
