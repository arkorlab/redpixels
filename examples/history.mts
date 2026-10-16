import type { OpenHistoryResponse } from "../src/types.ts";
// Prints every observed fetch, following every page. Node.js 22+.
const { REDPIXELS_URL, REDPIXELS_API_TOKEN } = process.env;
if (!REDPIXELS_URL || !REDPIXELS_API_TOKEN)
  throw new Error("Set REDPIXELS_URL and REDPIXELS_API_TOKEN");
const id = process.argv[2];
if (!id) throw new Error("Usage: node examples/history.mts <message-id>");
let after: number | null = 0;
do {
  const url = new URL(
    `/v1/messages/${encodeURIComponent(id)}/opens`,
    REDPIXELS_URL,
  );
  url.searchParams.set("after", String(after));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${REDPIXELS_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`History failed (${response.status})`);
  const page: OpenHistoryResponse =
    (await response.json()) as OpenHistoryResponse;
  if (after === 0)
    console.log(
      `${page.message.subject || "(no subject)"}: ${page.message.open_count} observed fetches`,
    );
  for (const open of page.opens)
    console.log(
      `#${open.open_number}  ${open.timestamp}  ${open.ago}  [${open.flags.join(", ")}]`,
    );
  after = page.next_after;
} while (after !== null);
