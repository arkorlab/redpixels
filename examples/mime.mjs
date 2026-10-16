// Build an RFC-style multipart/alternative message; Gmail's API accepts raw MIME.
export function createMime({ from, to, subject, text = "", html, pixelHtml }) {
  for (const value of [from, to, subject])
    if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value))
      throw new Error("Invalid mail header");
  const tracked = /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, () => `${pixelHtml}</body>`)
    : html + pixelHtml;
  const boundary = `redpixels_${crypto.randomUUID()}`;
  // Each encoded word must decode independently, including multibyte subjects.
  const words = [];
  let chunk = "";
  for (const char of subject) {
    if (Buffer.byteLength(chunk + char) > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  const encodedSubject = words
    .map((s) => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`)
    .join("\r\n ");
  const base64 = (s) =>
    Buffer.from(s)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || "";
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(tracked),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
